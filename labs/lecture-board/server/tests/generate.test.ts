import { describe, expect, it } from 'vitest'
import { finalizeBoardScript, planBoardScript } from '../src/generate'
import type { ChatMessage, ChatPort } from '../src/ports'
import { ANIMATION_TEMPLATES } from '../src/templates'
import type { Keypoints } from '../src/recognize'

/**
 * 运行问题复查(2026-09-17)· 错误路径:Qwen 返回非 JSON / 超时,不打真接口,用假 ChatPort 注入。
 * 覆盖 protocol.md「scripting:校验草稿…还有错就 salvage」那条兜底链路。
 */

function fakePort(replies: Array<string | Error>): ChatPort {
  let i = 0
  return {
    id: 'fake',
    supportsVision: false,
    async complete(_messages: ChatMessage[]): Promise<string> {
      const reply = replies[Math.min(i, replies.length - 1)]
      i++
      if (reply instanceof Error) throw reply
      return reply
    }
  }
}

const KEYPOINTS: Keypoints = {
  source: { problemText: '题干', answerText: '(1)600 Pa', imageCount: 1, recognizedBy: 'fake' },
  analysis: { given: ['V=1'], hidden: [], find: ['(1)压强'], ideas: ['p=F/S'], marks: [] },
  outline: [{ id: 'o1', title: '第一步', idea: '算压强' }],
  takeaways: { knowledge: ['压强'], keyPoints: [], methods: [], variants: [] },
  template: { id: 'board-steps', reason: 'x', confidence: 'low' }
}

const MINIMAL_DRAFT = {
  version: 2,
  title: '压强',
  subject: 'physics',
  summary: '压强题。',
  problem: { text: '题干', images: [], answer: '(1)600 Pa' },
  analysis: { given: ['V=1'], hidden: [], find: ['(1)压强'], ideas: ['p=F/S'], marks: [] },
  columns: [
    { id: 'c0', title: '审题', phase: 'analysis' },
    { id: 'c1', title: '第(1)问 · 压强', phase: 'solve', subq: 1 },
    { id: 'c2', title: '总结', phase: 'summary' }
  ],
  cards: [
    { id: 'k_problem', col: 'c0', kind: 'problem' },
    { id: 'k_analysis', col: 'c0', kind: 'analysis' },
    { id: 'k_take', col: 'c2', kind: 'takeaways' }
  ],
  figures: [],
  animations: [],
  steps: [{ id: 's0', title: '审题', col: 'c0', flow: [{ say: '这道题问压强。', ref: 'k_problem' }] }],
  takeaways: { knowledge: ['【压强】等于力除以面积'], pitfalls: [], methods: [], variants: [] }
}

describe('planBoardScript · Qwen 返回非 JSON', () => {
  it('回复不含 JSON 对象 → extractJson 抛错,冒泡给调用方(不静默吞掉)', async () => {
    const port = fakePort(['这不是 JSON,是模型瞎聊的一段话'])
    await expect(planBoardScript(port, { keypoints: KEYPOINTS, imageUrls: [] })).rejects.toThrow('没有 JSON 对象')
  })

  it('回复是残缺 JSON(截断)→ 同样抛错', async () => {
    const port = fakePort(['{"version":2,"title":"没写完'])
    await expect(planBoardScript(port, { keypoints: KEYPOINTS, imageUrls: [] })).rejects.toThrow()
  })

  it('模型请求超时 → 错误原样冒泡(pipeline.ts 外层会 failLesson,不在这层吞掉)', async () => {
    const port = fakePort([new Error('模型请求超时(180000 ms)')])
    await expect(planBoardScript(port, { keypoints: KEYPOINTS, imageUrls: [] })).rejects.toThrow('超时')
  })
})

describe('finalizeBoardScript · 修复轮失败时的 salvage 兜底', () => {
  const ctx = { problemText: '题干', answerText: '(1)600 Pa', templates: ANIMATION_TEMPLATES }
  const baseMessages: ChatMessage[] = [{ role: 'user', content: 'x' }]

  it('第一轮草稿本身没有 errors → 直接用,不调用修复轮', async () => {
    const port = fakePort([new Error('不该被调用')])
    const result = await finalizeBoardScript(port, MINIMAL_DRAFT, ctx, { messages: baseMessages })
    expect(result.attempts).toBe(1)
    expect(result.errors).toEqual([])
  })

  it('第一轮有错、修复轮请求超时 → 退回第一轮草稿 salvage,不抛错、不挂掉整道题', async () => {
    const badDraft = { ...MINIMAL_DRAFT, columns: [] } // 触发「columns 是空的」error
    const port = fakePort([new Error('模型请求超时(180000 ms)')])
    const result = await finalizeBoardScript(port, badDraft, ctx, { messages: baseMessages })
    expect(result.attempts).toBe(2)
    expect(result.script).toBeDefined()
    expect(result.warnings.some((w) => w.includes('修复轮失败'))).toBe(true)
  })

  it('第一轮有错、修复轮返回非 JSON → 同样 salvage 而不是抛出未捕获异常', async () => {
    const badDraft = { ...MINIMAL_DRAFT, columns: [] }
    const port = fakePort(['不是 JSON 的回复'])
    const result = await finalizeBoardScript(port, badDraft, ctx, { messages: baseMessages })
    expect(result.attempts).toBe(2)
    expect(result.script).toBeDefined()
    expect(result.warnings.some((w) => w.includes('修复轮失败'))).toBe(true)
  })

  it('第一轮有错、修复轮 JSON 合法但还是有错 → 用修复轮结果 salvage(不是退回第一轮)', async () => {
    const badDraft = { ...MINIMAL_DRAFT, columns: [] }
    const stillBad = { ...MINIMAL_DRAFT, columns: [] } // 修复轮依旧没修好 columns
    const port = fakePort([JSON.stringify(stillBad)])
    const result = await finalizeBoardScript(port, badDraft, ctx, { messages: baseMessages })
    expect(result.attempts).toBe(2)
    expect(result.warnings.some((w) => w.includes('修复轮后仍有'))).toBe(true)
  })

  it('修复轮真的修好了 → errors 清空,用修复后的剧本', async () => {
    const badDraft = { ...MINIMAL_DRAFT, columns: [] }
    const port = fakePort([JSON.stringify(MINIMAL_DRAFT)])
    const result = await finalizeBoardScript(port, badDraft, ctx, { messages: baseMessages })
    expect(result.attempts).toBe(2)
    expect(result.errors).toEqual([])
  })
})
