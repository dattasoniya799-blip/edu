/**
 * 规划 + 出剧本:一次 Qwen 调用(思考关、json_object)拿到 BoardScript v2,然后校验 → 一次修复轮 → salvage。
 *
 * protocol.md 允许 planning 与 scripting 合成一次模型调用,阶段事件仍各发一次;
 * 这里的分工是:planning 阶段 = 那次模型调用,scripting 阶段 = 校验 / 修复 / 兜底补全。
 */
import type { BoardScript } from '../../shared/schema'
import type { ChatMessage, ChatPort } from './ports'
import { buildBoardSystemPrompt, buildBoardUserMessage, buildRepairMessage } from './prompt-board'
import type { Keypoints } from './recognize'
import { ANIMATION_TEMPLATES, type BoardTemplateInfo } from './templates'
import { extractJson, normalizeBoardScript, type NormalizeContext } from './validate'

export interface PlanOptions {
  keypoints: Keypoints
  imageUrls: string[]
  templates?: BoardTemplateInfo[]
  timeoutMs?: number
  onCall?: (info: { label: string; ms: number; messages: ChatMessage[]; raw: string }) => void
}

export interface PlanResult {
  /** 模型原样吐出来的 JSON 文本(planning 阶段的产物) */
  raw: string
  parsed: unknown
  ms: number
}

/** planning:一次调用,拿到剧本草稿 */
export async function planBoardScript(port: ChatPort, o: PlanOptions): Promise<PlanResult & { messages: ChatMessage[] }> {
  const templates = o.templates ?? ANIMATION_TEMPLATES
  const messages: ChatMessage[] = [
    { role: 'system', content: buildBoardSystemPrompt(templates) },
    { role: 'user', content: buildBoardUserMessage({ keypoints: o.keypoints, imageUrls: o.imageUrls }) }
  ]
  const started = Date.now()
  const raw = (
    await port.complete(messages, {
      temperature: 0.2,
      timeoutMs: o.timeoutMs ?? 180_000,
      maxTokens: 16_000,
      thinking: false,
      jsonObject: true
    })
  ).trim()
  const ms = Date.now() - started
  o.onCall?.({ label: 'planning', ms, messages, raw })
  return { raw, parsed: extractJson(raw), ms, messages }
}

export interface ScriptResult {
  script: BoardScript
  errors: string[]
  warnings: string[]
  /** 走了几次模型调用(1 = 一轮过,2 = 用了修复轮) */
  attempts: number
  repairRaw?: string
}

/**
 * scripting:校验草稿;有错就带着错误清单回一次模型(这轮开思考,让它算清楚再写),
 * 还有错就进 salvage —— 把引用断裂的项就地删掉、降级成告警,保证剧本能播。
 */
export async function finalizeBoardScript(
  port: ChatPort,
  draft: unknown,
  ctx: NormalizeContext,
  o: { messages: ChatMessage[]; timeoutMs?: number; onCall?: PlanOptions['onCall'] }
): Promise<ScriptResult> {
  const first = normalizeBoardScript(draft, ctx)
  if (!first.errors.length) return { script: first.script, errors: [], warnings: first.warnings, attempts: 1 }

  const messages: ChatMessage[] = [...o.messages, { role: 'assistant', content: JSON.stringify(draft) }, { role: 'user', content: buildRepairMessage(first.errors) }]
  // 只有算错/说错这类错误才值得再开一次思考(慢 2–3 倍);引用断了、动作名写错这种纯结构问题关思考改得又快又准。
  const needsThinking = first.errors.some((e) => /数字|数值|与答案|120 字|草稿|子串/.test(e))
  let repairRaw = ''
  try {
    const started = Date.now()
    repairRaw = (
      await port.complete(messages, { temperature: 0.2, timeoutMs: o.timeoutMs ?? 180_000, maxTokens: 16_000, thinking: needsThinking, jsonObject: true })
    ).trim()
    o.onCall?.({ label: 'scripting-repair', ms: Date.now() - started, messages, raw: repairRaw })
    const second = normalizeBoardScript(extractJson(repairRaw), ctx)
    if (!second.errors.length) {
      return {
        script: second.script,
        errors: [],
        warnings: [...second.warnings, `第一轮有 ${first.errors.length} 处错误,修复轮已改好:${first.errors.slice(0, 3).join(';')}`],
        attempts: 2,
        repairRaw
      }
    }
    // 修复轮也没全过:对修好的那份做 salvage
    const salvaged = normalizeBoardScript(extractJson(repairRaw), { ...ctx, salvage: true })
    return {
      script: salvaged.script,
      errors: salvaged.errors,
      warnings: [...salvaged.warnings, `修复轮后仍有 ${second.errors.length} 处问题,已就地降级处理`],
      attempts: 2,
      repairRaw
    }
  } catch (error) {
    // 修复轮本身失败(超时 / 坏 JSON):退回第一轮草稿做 salvage,别让整道题挂掉
    const salvaged = normalizeBoardScript(draft, { ...ctx, salvage: true })
    return {
      script: salvaged.script,
      errors: salvaged.errors,
      warnings: [...salvaged.warnings, `修复轮失败(${(error as Error).message.slice(0, 120)}),已用第一轮草稿降级处理`],
      attempts: 2,
      repairRaw
    }
  }
}
