/**
 * 识题(复用 ohmyppt-lecture/src/main/lecture/recognize.ts 的做法,基本原样搬过来):
 * 题目截图(1–3 张,base64 进 Qwen,思考开)+ 答案文字 → 要点卡 Keypoints。
 *
 * v2 里要点卡不再给老师确认(全自动),它的作用变成「出剧本那一步的硬约束」:
 * 题干逐字抄录、审题四块、解题骨架、总结四组、动画模板候选。
 * 纪律:答案是 ground truth;看不清标 ⚠ 不猜;marks 必须是题干子串。
 */
import type { ChatContent, ChatMessage, ChatPort } from './ports'
import { ALL_TEMPLATES, BOARD_STEPS_TEMPLATE_ID, type BoardTemplateInfo } from './templates'
import { BoardValidationError, extractJson } from './validate'

export const RECOGNIZE_MAX_IMAGES = 3
export const RECOGNIZE_MAX_IMAGE_BYTES = 6 * 1024 * 1024
/** 解题骨架步数上限 */
export const OUTLINE_MAX = 8
export const ANSWER_CONFLICT_NOTE = '⚠ 与答案不符,请核对'

export interface KeypointMark {
  text: string
  color: 'red' | 'blue' | 'green'
}
export interface Keypoints {
  source: { problemText: string; answerText?: string; imageCount: number; recognizedBy: string }
  analysis: { given: string[]; hidden: string[]; find: string[]; ideas: string[]; marks: KeypointMark[] }
  outline: { id: string; title: string; idea: string; result?: string }[]
  takeaways: { knowledge: string[]; keyPoints: string[]; methods: string[]; variants: string[] }
  template: { id: string; reason: string; params?: Record<string, number>; confidence: 'high' | 'medium' | 'low' }
}

export interface RecognizeInput {
  /** data:image/...;base64,… */
  images: string[]
  answerText: string
  problemText?: string
}

export function assertRecognizeInput(input: RecognizeInput): RecognizeInput {
  const images = (input.images ?? []).filter((s) => typeof s === 'string' && s.trim())
  const answerText = String(input.answerText ?? '').trim()
  const problemText = String(input.problemText ?? '').trim()
  if (!images.length && !problemText) throw new Error('请上传题目截图,或给一段题干文字')
  if (!answerText) throw new Error('答案是必填的:它是这道题的 ground truth')
  if (images.length > RECOGNIZE_MAX_IMAGES) throw new Error(`题目截图最多 ${RECOGNIZE_MAX_IMAGES} 张,现在有 ${images.length} 张`)
  images.forEach((img, i) => {
    if (!/^data:image\/[a-z0-9.+-]+;base64,/i.test(img)) throw new Error(`第 ${i + 1} 张截图不是图片 data URL`)
    const bytes = Math.floor(((img.length - img.indexOf(',') - 1) * 3) / 4)
    if (bytes > RECOGNIZE_MAX_IMAGE_BYTES) throw new Error(`第 ${i + 1} 张截图约 ${(bytes / 1024 / 1024).toFixed(1)} MB,超过 6 MB`)
  })
  return { images, answerText, problemText }
}

/** 动画模板目录(给识题看的简版) */
function templateCatalog(templates: BoardTemplateInfo[]): string {
  return templates
    .map((t) => {
      const params = Object.entries(t.params)
      const paramLine = params.length ? `参数:${params.map(([k, v]) => `${k}=${v}`).join(' | ')}` : '参数:无'
      return `- ${t.id} · ${t.name}(${t.subject})\n  适合:${t.fits.join(';')}\n  ${paramLine}${
        TEMPLATE_PARAM_TIPS[t.id] ? `\n  ${TEMPLATE_PARAM_TIPS[t.id]}` : ''
      }`
    })
    .join('\n')
}

/** 「题目数值 → 模板参数」的换算提示(沿用 09-16 实测踩过的坑) */
export const TEMPLATE_PARAM_TIPS: Record<string, string> = {
  'circle-angle':
    '参数取法:先固定 thetaB = 40;圆周角 ∠ACB = β → thetaA = thetaB + 2β;∠OAC = α → thetaC = thetaA + 180 + 2α(超过 360 减 360,必须落在 270..360,否则交点 D 不存在);tE 一般先给 1.6。例:∠OAC = 15°、∠ACB = 40° → { "thetaA": 120, "thetaB": 40, "thetaC": 330, "tE": 1.6 };「BE = BA → OB ⊥ BE」那一步要用 { "thetaC": 360, "tE": 1.39 }。',
  'parallelogram-angle': '参数取法:beta = ∠DBC,gamma = ∠DCB,AB = 题目的 AB(=CD)长度,直接照抄。',
  'linear-shift':
    '参数取法:k、b 是平移前原直线的斜率与截距,d 是平移量(上正下负);先由给定点定出平移后直线 y = kx + b′,再 b = b′ − d。',
  buoyancy:
    '参数取法:V 按 ×10⁻⁴ m³ 填(6×10⁻⁴ 写 6),S 按 ×10⁻³ m² 填(8×10⁻³ 写 8),m0 是注水前质量,mw 是注水质量(没给就取一个能让 G总 > F浮 的值,如 0.6),h 是上浮高度。',
  'quadratic-line': '参数取法:a、b、c 是抛物线 y=ax²+bx+c 的系数,k、m 是直线 y=kx+m 的斜率与截距,照题目抄。',
  'cart-collision': '参数取法:m1/m2 是两车质量,v1/v2 是初速度(右正),e 是恢复系数(完全弹性 1,完全非弹性 0)。'
}

export function buildRecognizeSystemPrompt(templates: BoardTemplateInfo[]): string {
  return `你是中学数理化老师,负责「识题」:看老师给的题目截图(1–3 张)和答案,抄下题干、审题、列出解题骨架、写出课后总结、并判断有没有现成的交互动画模板可用。这份要点卡会直接拿去生成白板讲题剧本,所以宁可标 ⚠ 也不要编造。

只输出一个 JSON 对象(不要解释,不要代码围栏):
{
  "problemText": "题干逐字抄录:一字不改、不省略、不改写;多个小问按 (1)(2)①② 分行(行间用 \\n);数学符号用 Unicode 明文(√ ² ³ ∠ ⊥ ∥ ≈ ° × ÷ ≤ ≥ ≠ π ρ △ ▱ ⊙),不用 LaTeX;看不清或被裁掉的字用 ⚠ 标出;只抄文字,图里的几何关系不写进题干",
  "analysis": {
    "given": ["已知条件 2–5 条,带单位"],
    "hidden": ["隐含条件 1–3 条,格式「线索 → 结论」"],
    "find": ["每一问求什么,逐问一条"],
    "ideas": ["思路切入,逐问一条,「先…再…」"],
    "marks": [ { "text": "必须是 problemText 的连续子串(逐字摘)", "color": "red|blue|green" } ]
  },
  "outline": [
    { "id": "o1", "title": "这一步做什么(≤14 字)", "idea": "一句核心想法(≤40 字)", "result": "该步结论或数值,带单位(≤30 字)", "conflict": false }
  ],
  "takeaways": {
    "knowledge": ["核心知识点 2–3 条,每条 ≤20 字"],
    "keyPoints": ["考点与易错 1–2 条,每条 ≤24 字"],
    "methods": ["技巧 1–2 条,每条 ≤24 字,动词开头"],
    "variants": ["举一反三 1–2 条,每条 ≤24 字"]
  },
  "template": { "id": "模板 id 或 ${BOARD_STEPS_TEMPLATE_ID}", "reason": "为什么选它(≤40 字)", "params": { "参数名": 数值 }, "confidence": "high|medium|low" }
}

纪律:
1. 抄题:problemText 逐字照抄截图上的文字(标点、字母、单位、编号照原样),不要概括。
2. 数值:given、outline.result 里每个数都带单位;不确定的写「⚠ 待核对」而不是猜。
3. 答案是标准:老师给的答案是 ground truth。outline 每步 result 以答案为准;你自己算的和答案不一致时,把该步 "conflict" 设为 true 并在 result 里注明「${ANSWER_CONFLICT_NOTE}」。
4. 解题骨架 outline 3–${OUTLINE_MAX} 步:一步一个想法,按讲题顺序,多问的题逐问展开。
5. marks(三色笔法):red=限制/关键行为词(恰好、完全、静止、平分、垂直、不超过…),blue=数据(数字带单位),green=触发隐含条件的词(浸没、半径、平行四边形、光滑…);每条 text 必须是 problemText 的连续子串,3–8 处。
6. 动画模板:只有题目场景和下面某个模板明确对应(能用它的参数把题设摆出来)才选它,并按题目数值给 params;都不贴切就选 ${BOARD_STEPS_TEMPLATE_ID} 并说明理由——那表示这道题需要现场生成一个专用的 HTML 动画。
7. takeaways 是念出来的话:不写公式源码。
8. 不写 problemText 里没有的图中信息;图上的角度/长度只在题干文字里明确给出时才算已知。

## 动画模板目录
${templateCatalog(templates)}`
}

export function buildRecognizeUserContent(input: RecognizeInput): ChatContent {
  const lines: string[] = []
  if (input.images.length) lines.push(`上面 ${input.images.length} 张是老师上传的题目截图(按顺序)。`)
  lines.push(`老师给的答案(ground truth,以此为准):\n${input.answerText}`)
  if (input.problemText) {
    lines.push(input.images.length ? `老师已贴的题干文字(供互校,以截图为准):\n${input.problemText}` : `题干文字:\n${input.problemText}`)
  }
  lines.push('请识题并只输出要点卡 JSON。')
  const text = lines.join('\n\n')
  if (!input.images.length) return text
  return [...input.images.map((dataUrl) => ({ type: 'image' as const, dataUrl })), { type: 'text' as const, text }]
}

const CONFIDENCES = ['high', 'medium', 'low']

export function normalizeKeypoints(
  raw: unknown,
  o: { templates: BoardTemplateInfo[]; source: { answerText: string; imageCount: number; recognizedBy: string } }
): Keypoints {
  if (!raw || typeof raw !== 'object') throw new BoardValidationError('要点卡不是对象')
  const k = raw as Record<string, unknown>
  const problemText = String(k.problemText ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .join('\n')
  if (!problemText) throw new BoardValidationError('要点卡缺少题干(problemText)')
  if (!Array.isArray(k.outline)) throw new BoardValidationError('要点卡缺少解题骨架(outline)')

  const outline: Keypoints['outline'] = []
  for (const item of k.outline) {
    const o2 = (item ?? {}) as Record<string, unknown>
    const title = String(o2.title ?? '').trim().slice(0, 20)
    const idea = String(o2.idea ?? '').trim().slice(0, 60)
    if (!title && !idea) continue
    let result = String(o2.result ?? '').trim().slice(0, 40)
    if (o2.conflict === true && !result.includes('与答案不符')) result = `${result} ${ANSWER_CONFLICT_NOTE}`.trim().slice(0, 60)
    const entry: Keypoints['outline'][number] = { id: String(o2.id ?? `o${outline.length + 1}`), title: title || `第 ${outline.length + 1} 步`, idea }
    if (result) entry.result = result
    outline.push(entry)
    if (outline.length >= OUTLINE_MAX) break
  }
  if (outline.length < 2) throw new BoardValidationError(`解题骨架至少 2 步,现在只有 ${outline.length} 步`)

  const a = (k.analysis ?? {}) as Record<string, unknown>
  const list = (v: unknown, max: number, len: number): string[] =>
    (Array.isArray(v) ? v : []).map((x) => String(x).trim()).filter(Boolean).map((x) => x.slice(0, len)).slice(0, max)
  const marks: KeypointMark[] = []
  for (const m of Array.isArray(a.marks) ? a.marks : []) {
    const item = (m ?? {}) as Record<string, unknown>
    const text = String(item.text ?? '').trim()
    const color = String(item.color ?? '')
    if (!text || !['red', 'blue', 'green'].includes(color) || !problemText.includes(text)) continue
    marks.push({ text, color: color as KeypointMark['color'] })
    if (marks.length >= 10) break
  }

  const t = (k.takeaways ?? {}) as Record<string, unknown>
  const tplRaw = (k.template ?? {}) as Record<string, unknown>
  let templateId = String(tplRaw.id ?? '').trim()
  if (templateId && templateId !== BOARD_STEPS_TEMPLATE_ID && !o.templates.some((x) => x.id === templateId)) {
    templateId = BOARD_STEPS_TEMPLATE_ID
  }
  const params: Record<string, number> = {}
  for (const [key, value] of Object.entries((tplRaw.params ?? {}) as Record<string, unknown>)) {
    const n = Number(value)
    if (Number.isFinite(n)) params[key] = n
  }

  return {
    source: {
      problemText,
      answerText: o.source.answerText || undefined,
      imageCount: o.source.imageCount,
      recognizedBy: o.source.recognizedBy
    },
    analysis: {
      given: list(a.given, 6, 40),
      hidden: list(a.hidden, 4, 40),
      find: list(a.find, 5, 36),
      ideas: list(a.ideas, 5, 48),
      marks
    },
    outline,
    takeaways: {
      knowledge: list(t.knowledge, 3, 30),
      keyPoints: list(t.keyPoints, 3, 30),
      methods: list(t.methods, 3, 30),
      variants: list(t.variants, 3, 30)
    },
    template: {
      id: templateId || BOARD_STEPS_TEMPLATE_ID,
      reason: String(tplRaw.reason ?? '').trim().slice(0, 80),
      ...(Object.keys(params).length ? { params } : {}),
      confidence: (CONFIDENCES.includes(String(tplRaw.confidence)) ? String(tplRaw.confidence) : 'low') as Keypoints['template']['confidence']
    }
  }
}

export interface RecognizeResult {
  keypoints: Keypoints
  raw: string
  attempts: number
}

/** 一次调用出要点卡;坏 JSON / 缺字段触发一次修复轮 */
export async function recognizeKeypoints(
  port: ChatPort,
  input: RecognizeInput,
  options: { timeoutMs?: number; templates?: BoardTemplateInfo[]; onAttempt?: (info: { attempt: number; ms: number; ok: boolean; error?: string; raw: string; messages: ChatMessage[] }) => void } = {}
): Promise<RecognizeResult> {
  const checked = assertRecognizeInput(input)
  const templates = options.templates ?? ALL_TEMPLATES
  if (checked.images.length && !port.supportsVision) throw new Error(`识题需要能看图的模型,当前 ${port.id} 不支持图片`)

  const messages: ChatMessage[] = [
    { role: 'system', content: buildRecognizeSystemPrompt(templates) },
    { role: 'user', content: buildRecognizeUserContent(checked) }
  ]
  let lastError = ''
  for (let attempt = 0; attempt < 2; attempt++) {
    const started = Date.now()
    const raw = (await port.complete(messages, { temperature: 0.1, timeoutMs: options.timeoutMs ?? 180_000, maxTokens: 8000, thinking: true })).trim()
    try {
      const keypoints = normalizeKeypoints(extractJson(raw), {
        templates,
        source: { answerText: checked.answerText, imageCount: checked.images.length, recognizedBy: port.id }
      })
      options.onAttempt?.({ attempt, ms: Date.now() - started, ok: true, raw, messages })
      return { keypoints, raw, attempts: attempt + 1 }
    } catch (error) {
      if (!(error instanceof BoardValidationError || error instanceof SyntaxError)) throw error
      lastError = (error as Error).message
      options.onAttempt?.({ attempt, ms: Date.now() - started, ok: false, error: lastError, raw, messages })
      messages.push(
        { role: 'assistant', content: raw },
        { role: 'user', content: `你上一份要点卡 JSON 没通过校验:${lastError}\n请只修正这个问题,重新输出完整的要点卡 JSON(只输出 JSON,不要解释)。` }
      )
    }
  }
  throw new BoardValidationError(`识题两次都没得到合格的要点卡:${lastError}`)
}
