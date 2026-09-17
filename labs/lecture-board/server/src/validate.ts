/**
 * BoardScript v2 校验器 —— 出剧本提示词里那套硬纪律的兜底。
 *
 * 分两档:
 *  - errors   会让剧本没法播或明显讲错(引用断了、公式缺 tex、动作模板不认识、旁白超长)。
 *             第一遍出现 errors 就发一次修复轮给模型;修复轮之后仍有的引用类错误在 salvage 模式下
 *             就地删掉并降级为 warning,保证「一处坏不拖垮整道题」。
 *  - warnings 能就地修好的(marks 不是子串、speech 缺失、参数越界、scene 超额、【】不成对)。
 *
 * 校验器只依赖 shared/schema.ts 的形状 + templates.ts 的 manifest,不联网、不调模型。
 */
import type {
  Animation,
  BoardLine,
  BoardScript,
  Card,
  Column,
  Figure,
  FlowItem,
  Phase,
  Step,
  Subject
} from '../../shared/schema'
import { enforceAnimationFlow, enforceNarrationAnchors } from './board-discipline'
import { normalizeSpokenText } from './spoken-text'
import { numbersIn, speechMissingNumbers, texHasLatexMarkup, texToSpeech } from './tex-to-speech'
import { ANIMATION_TEMPLATES, type BoardTemplateInfo } from './templates'

export class BoardValidationError extends Error {}

export interface NormalizeContext {
  /** 识题抄下来的题干(模型没给 problem.text 时兜底,也是 marks 子串校验的基准) */
  problemText?: string
  /** 答案.md 原文,数值 ground truth */
  answerText?: string
  /** 上传原图的 /assets URL */
  images?: string[]
  templates?: BoardTemplateInfo[]
  /** 修复轮之后的最后一遍:引用类错误就地删掉并降级成告警 */
  salvage?: boolean
}

export interface NormalizeResult {
  script: BoardScript
  errors: string[]
  warnings: string[]
}

/** 从模型回复里抠出 JSON(容忍 ``` 围栏与前后废话) */
export function extractJson(raw: string): unknown {
  const text = String(raw ?? '').trim()
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = (fenced ? fenced[1] : text).trim()
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start < 0 || end <= start) throw new BoardValidationError('回复里没有 JSON 对象')
  return JSON.parse(candidate.slice(start, end + 1))
}

/** 旁白 / 总结条目里不该出现的 LaTeX 与 Markdown 记号 */
export function stripLatex(text: string): string {
  return String(text ?? '')
    .replace(/\\(?:frac|dfrac|tfrac)\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, '$2 分之 $1')
    .replace(/\\[A-Za-z]+/g, ' ')
    .replace(/[\\${}^_]/g, ' ')
    .replace(/[*`#>]/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

/**
 * 推理草稿泄漏(2026-09-16 qwen3.8-flash 关思考实测):模型把「不对,重新算…换个思路」写进旁白。
 * 讲解词只能是讲给学生的定稿。
 */
const DRAFT_LEAK =
  /不对[,,。!!]|重新算|重新来过|这条路|换路|换个思路|看来我的|有误[,,。]|这也不对|推不出|调整策略|稍等|等一下|让我们?回到|我的推导|逻辑修正|此处.{0,4}修正/

/** 几何 / 函数图的意象:出现这些词就不许走 Seedream(AI 画不准角度和交点) */
const GEOMETRY_WORDS =
  /几何|坐标系|函数图|图象|图像|抛物线|数轴|象限|圆心|圆周角|外接圆|内切|三角形|正方形|长方形|矩形|平行四边形|菱形|梯形|多边形|对角线|全等|相似|辅助线|角平分线|中垂线|垂线|∠|直角三角|锐角|钝角|顶点坐标/

const SUBJECTS: Subject[] = ['math', 'physics', 'chemistry']
const PHASES: Phase[] = ['analysis', 'solve', 'summary', 'explore']
const CARD_KINDS = ['heading', 'points', 'board', 'table', 'figure', 'animation', 'problem', 'analysis', 'takeaways']
const MARK_KINDS = ['key', 'data', 'hidden']
const FX_KINDS = ['circle', 'underline', 'pulse']
const TAKEAWAY_GROUPS = ['knowledge', 'pitfalls', 'methods', 'variants'] as const

const SAY_MAX = 120
/** 每题情境图上限(方案 §四) */
export const SCENE_FIGURE_MAX = 2

/** purpose 只该是给学生看的一句话上限(提示词 E3);超过只告警,不强行截断整句话 */
const PURPOSE_MAX = 40
/**
 * 模型有时把「动作名/参数」这些实现细节写进 purpose(如「…动作名:rotate(旋转), showPerp(显示垂直)」),
 * 这段本该只讲给生成动画的模型听,不该出现在学生看的动画卡上(2026-09-17 多道真题实测复现)。
 * 一旦出现这几个触发词就把它和它之后的内容一起切掉。
 */
const PURPOSE_ACTION_LEAK = /(动作名|动作包括|参数)[:：]?/

/** purpose 净化:切掉「动作名/动作包括/参数」及其后的实现细节,只留给学生看的那一句话 */
export function sanitizePurpose(raw: string): { text: string; truncated: boolean } {
  const s = String(raw ?? '').trim()
  const m = s.match(PURPOSE_ACTION_LEAK)
  if (!m || m.index == null) return { text: s, truncated: false }
  const cut = s.slice(0, m.index).replace(/[，,。;;::、\s]+$/, '').trim()
  return { text: cut || s.slice(0, PURPOSE_MAX), truncated: true }
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}
function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : []
}
function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

export function normalizeBoardScript(input: unknown, ctx: NormalizeContext = {}): NormalizeResult {
  const errors: string[] = []
  const warnings: string[] = []
  /** 引用断裂类问题:salvage 模式下删掉并降级 */
  const refFail = (message: string): void => {
    if (ctx.salvage) warnings.push(`已本地修复:${message}`)
    else errors.push(message)
  }
  const templates = ctx.templates ?? ANIMATION_TEMPLATES

  /**
   * 被我们自己按规则删掉的 id(几何情境图、超额的 scene、空板书卡…)。
   * 指向它们的卡和 flow 项要**连坐删掉并只记告警** —— 这是我们造成的,不该扣在模型头上
   * 再花一轮修复(2026-09-17 正方形旋转题实测:一张违规配图连累出 3 条错误 + 一轮空转)。
   */
  const dropped = new Map<string, string>()
  const cascade = (id: string, reason: string, what: string): void => {
    warnings.push(`${what}引用的 ${id} 已被规则去掉(${reason}),这一项一起去掉`)
    dropped.set(id, reason)
  }

  const raw = obj(input)
  if (!Object.keys(raw).length) throw new BoardValidationError('剧本不是对象')

  // ---------- 全局 id 唯一 ----------
  const ids = new Set<string>()
  const claimId = (id: string, where: string): boolean => {
    if (!id) {
      errors.push(`${where}缺少 id`)
      return false
    }
    if (ids.has(id)) {
      errors.push(`id 重复:${id}(${where});剧本里每个 id 全局唯一`)
      return false
    }
    ids.add(id)
    return true
  }

  // ---------- 题面 ----------
  const problemRaw = obj(raw.problem)
  const problemText = str(problemRaw.text) || str(ctx.problemText)
  if (!problemText) errors.push('problem.text 为空:题干必须逐字抄录')
  const answerText = str(problemRaw.answer) || str(ctx.answerText)
  const images = ctx.images?.length ? ctx.images : arr(problemRaw.images).map(String).filter(Boolean)

  // ---------- 审题四块 ----------
  const analysisRaw = obj(raw.analysis)
  const list = (v: unknown, max: number, maxLen: number): string[] =>
    arr(v).map((x) => stripLatex(String(x))).filter(Boolean).map((x) => x.slice(0, maxLen)).slice(0, max)
  const marks: BoardScript['analysis']['marks'] = []
  for (const m of arr(analysisRaw.marks)) {
    const item = obj(m)
    const text = str(item.text)
    const kind = str(item.kind)
    if (!text || !MARK_KINDS.includes(kind)) {
      if (text) warnings.push(`审题高亮「${text}」的 kind「${kind}」不合法(只能 key/data/hidden),已去掉`)
      continue
    }
    if (problemText && !problemText.includes(text)) {
      warnings.push(`审题高亮「${text}」不是题干原文的子串,已去掉`)
      continue
    }
    marks.push({ text, kind: kind as 'key' | 'data' | 'hidden' })
  }
  const analysis: BoardScript['analysis'] = {
    given: list(analysisRaw.given, 6, 40),
    hidden: list(analysisRaw.hidden, 4, 40),
    find: list(analysisRaw.find, 5, 36),
    ideas: list(analysisRaw.ideas, 5, 48),
    marks
  }
  if (!analysis.given.length) warnings.push('审题的「已知」是空的')
  if (!analysis.find.length) warnings.push('审题的「求」是空的')

  // ---------- 列 ----------
  const columns: Column[] = []
  for (const c of arr(raw.columns)) {
    const item = obj(c)
    const id = str(item.id)
    const phase = PHASES.includes(str(item.phase) as Phase) ? (str(item.phase) as Phase) : 'solve'
    if (!claimId(id, `列「${str(item.title) || id}」`)) continue
    const col: Column = { id, title: str(item.title) || '未命名', phase }
    if (phase === 'solve' && Number.isFinite(Number(item.subq))) col.subq = Number(item.subq)
    columns.push(col)
  }
  if (!columns.length) errors.push('columns 是空的:白板至少要有审题、一问、总结三列')
  const analysisCols = columns.filter((c) => c.phase === 'analysis')
  const summaryCols = columns.filter((c) => c.phase === 'summary')
  const exploreCols = columns.filter((c) => c.phase === 'explore')
  if (analysisCols.length !== 1) errors.push(`必须恰有一列「审题」(phase=analysis),现在有 ${analysisCols.length} 列`)
  if (summaryCols.length !== 1) errors.push(`必须恰有一列「总结」(phase=summary),现在有 ${summaryCols.length} 列`)
  if (exploreCols.length > 1) errors.push(`「动手」列最多一列,现在有 ${exploreCols.length} 列`)
  if (!columns.some((c) => c.phase === 'solve')) errors.push('缺少解题列(phase=solve):每一问一列')
  if (analysisCols[0] && columns[0] !== analysisCols[0]) {
    warnings.push('审题列不在第一列,已挪到最前')
  }
  if (analysisCols[0] && analysisCols[0].title !== '审题') {
    warnings.push(`审题列标题「${analysisCols[0].title}」已改为「审题」`)
    analysisCols[0].title = '审题'
  }
  if (summaryCols[0] && summaryCols[0].title !== '总结') {
    warnings.push(`总结列标题「${summaryCols[0].title}」已改为「总结」`)
    summaryCols[0].title = '总结'
  }
  if (exploreCols[0] && exploreCols[0].title !== '动手') exploreCols[0].title = '动手'
  const order: Record<Phase, number> = { analysis: 0, solve: 1, summary: 2, explore: 3 }
  columns.sort((a, b) => order[a.phase] - order[b.phase] || (a.subq ?? 0) - (b.subq ?? 0))
  const columnIds = new Set(columns.map((c) => c.id))

  // ---------- 配图 ----------
  const figures: Figure[] = []
  let sceneCount = 0
  for (const f of arr(raw.figures)) {
    const item = obj(f)
    const id = str(item.id)
    const kind = str(item.kind) === 'diagram' ? 'diagram' : 'scene'
    if (!claimId(id, '配图')) continue
    const prompt = str(item.prompt)
    const caption = str(item.caption)
    const mermaid = str(item.mermaid)
    if (kind === 'scene') {
      if (!prompt) {
        warnings.push(`配图 ${id} 是情境图但没有 prompt,已去掉`)
        ids.delete(id)
        dropped.set(id, '没有 prompt')
        continue
      }
      if (GEOMETRY_WORDS.test(prompt) || GEOMETRY_WORDS.test(caption)) {
        warnings.push(`配图 ${id} 画的是几何/函数图,禁止走生图(AI 画不准角度和交点),已去掉;请改用动画卡或板书`)
        ids.delete(id)
        dropped.set(id, '几何/函数图不许生图')
        continue
      }
      if (/文字|标签|标注|写上|字母|文本|注释/.test(prompt)) {
        warnings.push(`配图 ${id} 的 prompt 要求画文字/标签,图内不放文字(会写错字),已从 prompt 里删掉这段要求`)
      }
      if (sceneCount >= SCENE_FIGURE_MAX) {
        warnings.push(`配图 ${id} 超出每题 ${SCENE_FIGURE_MAX} 张情境图的上限,已去掉`)
        ids.delete(id)
        dropped.set(id, `超出 ${SCENE_FIGURE_MAX} 张上限`)
        continue
      }
      sceneCount++
    } else if (!mermaid) {
      warnings.push(`配图 ${id} 是 diagram 但没有 mermaid 源码,已去掉`)
      ids.delete(id)
      dropped.set(id, '没有 mermaid 源码')
      continue
    }
    const figure: Figure = { id, kind, status: 'pending' }
    if (prompt) figure.prompt = prompt.replace(/[,,。]?\s*(图中|画面里)?(要求|请)?(写上|标注|加上)?[^,,。]*(文字|标签|字母)[^,,。]*/g, '')
    if (mermaid) figure.mermaid = mermaid
    if (caption) figure.caption = caption.slice(0, 24)
    if (kind === 'diagram') figure.status = 'ready'
    figures.push(figure)
  }
  const figureIds = new Set(figures.map((f) => f.id))

  // ---------- 动画 ----------
  const animations: Animation[] = []
  for (const a of arr(raw.animations)) {
    const item = obj(a)
    const id = str(item.id)
    if (!claimId(id, '动画')) continue
    const kind = ['template', 'html', 'static'].includes(str(item.kind)) ? (str(item.kind) as Animation['kind']) : 'html'
    const { text: purposeText, truncated } = sanitizePurpose(str(item.purpose) || '演示这一步')
    if (truncated) {
      warnings.push(`动画 ${id} 的 purpose 混进了动作名/参数这类实现细节(这只该讲给学生一句话),已截掉:「${purposeText}」`)
    }
    if (purposeText.length > PURPOSE_MAX) {
      warnings.push(`动画 ${id} 的 purpose「${purposeText}」超过 ${PURPOSE_MAX} 字,建议再精简`)
    }
    const anim: Animation = { id, kind, purpose: purposeText || '演示这一步', status: 'pending' }
    if (kind === 'template') {
      const templateId = str(item.template)
      const tpl = templates.find((t) => t.id === templateId)
      if (!tpl) {
        const message = `动画 ${id} 用了不存在的模板「${templateId || '(空)'}」;template 动画只能用:${templates.map((t) => t.id).join('、')};没有合适的就把 kind 改成 html`
        if (!ctx.salvage) {
          errors.push(message)
          ids.delete(id)
          continue
        }
        // salvage:与其丢掉这张动画,不如按「六模板摆不出来就现场生成」的既定兜底改成 html
        warnings.push(`已本地修复:${message};已改为 html 现场生成`)
        anim.kind = 'html'
        animations.push(anim)
        continue
      }
      anim.template = tpl.id
      anim.params = normalizeTemplateParams(obj(item.params), tpl, id, warnings)
    } else if (kind === 'static') {
      const svg = str(item.svg)
      if (svg) {
        anim.svg = svg
        anim.status = 'ready'
      }
    }
    animations.push(anim)
  }
  const animationIds = new Map(animations.map((a) => [a.id, a]))

  // ---------- 卡片 ----------
  const cards: Card[] = []
  /** animationId → 承载它的第一张动画卡;后来的重复卡一律删掉 */
  const animationCardOwner = new Map<string, string>()
  const lineOwner = new Map<string, { cardId: string; line: BoardLine }>()
  for (const c of arr(raw.cards)) {
    const item = obj(c)
    const id = str(item.id)
    const kind = str(item.kind)
    if (!CARD_KINDS.includes(kind)) {
      warnings.push(`卡片 ${id || '(无 id)'} 的 kind「${kind}」不认识,已去掉`)
      continue
    }
    if (!claimId(id, `卡片(${kind})`)) continue
    const col = str(item.col)
    if (!columnIds.has(col)) {
      refFail(`卡片 ${id} 挂在不存在的列 ${col || '(空)'} 上`)
      ids.delete(id)
      continue
    }
    switch (kind) {
      case 'heading':
        cards.push({ id, col, kind, text: stripLatex(str(item.text)).slice(0, 30) })
        break
      case 'points':
        cards.push({ id, col, kind, title: str(item.title) || undefined, lines: list(item.lines, 8, 60) })
        break
      case 'board': {
        const lines: BoardLine[] = []
        for (const l of arr(item.lines)) {
          const line = normalizeBoardLine(obj(l), id, { errors, warnings, answerText })
          if (!line) continue
          if (ids.has(line.id)) {
            errors.push(`id 重复:${line.id}(卡片 ${id} 的板书行)`)
            continue
          }
          ids.add(line.id)
          lineOwner.set(line.id, { cardId: id, line })
          lines.push(line)
        }
        if (!lines.length) {
          warnings.push(`板书卡 ${id} 一行都没有,已去掉`)
          ids.delete(id)
          dropped.set(id, '板书卡是空的')
          continue
        }
        cards.push({ id, col, kind, title: str(item.title) || undefined, lines })
        break
      }
      case 'table': {
        const markdown = str(item.markdown)
        let speech = stripLatex(str(item.speech))
        const tableSpoken = normalizeSpokenText(speech)
        if (tableSpoken.fixes.length) {
          warnings.push(`已自动修正 · 表格卡 ${id} 的 speech:${tableSpoken.fixes.join(';')}`)
          speech = tableSpoken.text
        }
        if (!markdown) {
          warnings.push(`表格卡 ${id} 没有 markdown,已去掉`)
          ids.delete(id)
          dropped.set(id, '表格卡没有 markdown')
          continue
        }
        if (!speech) errors.push(`表格卡 ${id} 缺 speech:表格也要有一句口播说明`)
        cards.push({ id, col, kind, title: str(item.title) || undefined, markdown, speech })
        break
      }
      case 'figure': {
        const figureId = str(item.figureId)
        if (!figureIds.has(figureId)) {
          ids.delete(id)
          if (dropped.has(figureId)) cascade(figureId, dropped.get(figureId)!, `配图卡 ${id}`)
          else refFail(`配图卡 ${id} 指向不存在的配图 ${figureId || '(空)'}`)
          dropped.set(id, dropped.get(figureId) ?? '配图不存在')
          continue
        }
        cards.push({ id, col, kind, figureId })
        break
      }
      case 'animation': {
        const animationId = str(item.animationId)
        if (!animationIds.has(animationId)) {
          ids.delete(id)
          if (dropped.has(animationId)) cascade(animationId, dropped.get(animationId)!, `动画卡 ${id}`)
          else refFail(`动画卡 ${id} 指向不存在的动画 ${animationId || '(空)'}`)
          dropped.set(id, dropped.get(animationId) ?? '动画不存在')
          continue
        }
        // 一张动画只挂一张卡:anim 动作按动画 id 派发,挂两张的话播放器不知道该驱动哪一张(ISSUES 8 / W1)
        const owner = animationCardOwner.get(animationId)
        if (owner) {
          warnings.push(`已自动修正 · 动画 ${animationId} 挂了两张卡,删掉重复的 ${id},保留先出现的 ${owner};动手环节复用 ${owner}`)
          ids.delete(id)
          dropped.set(id, `动画 ${animationId} 已经挂在 ${owner} 上`)
          continue
        }
        animationCardOwner.set(animationId, id)
        cards.push({ id, col, kind, animationId })
        break
      }
      default:
        cards.push({ id, col, kind } as Card)
    }
  }
  const cardIds = new Set(cards.map((c) => c.id))
  const analysisColId = analysisCols[0]?.id
  if (analysisColId) {
    if (!cards.some((c) => c.kind === 'problem')) warnings.push('审题列缺 problem 卡(题干 + 题图)')
    if (!cards.some((c) => c.kind === 'analysis')) warnings.push('审题列缺 analysis 卡(已知/隐含/求/思路)')
  }
  if (summaryCols[0] && !cards.some((c) => c.kind === 'takeaways')) warnings.push('总结列缺 takeaways 卡')

  // ---------- 总结 ----------
  const takeawaysRaw = obj(raw.takeaways)
  const takeaways = { knowledge: [], pitfalls: [], methods: [], variants: [] } as BoardScript['takeaways']
  for (const group of TAKEAWAY_GROUPS) {
    const items = arr(takeawaysRaw[group]).map((x) => stripLatex(String(x))).filter(Boolean).slice(0, 3)
    takeaways[group] = items.map((item) => {
      const spoken = normalizeSpokenText(item)
      if (spoken.fixes.length) warnings.push(`已自动修正 · 总结 ${group}「${item.slice(0, 14)}…」:${spoken.fixes.join(';')}`)
      return normalizeKeyword(spoken.text, group, warnings)
    })
  }
  if (!takeaways.knowledge.length) errors.push('takeaways.knowledge 是空的:总结必须写本题用到的知识点')

  // ---------- 步 ----------
  /**
   * reveal / ref 的目标写法(schema 2026-09-17 11:40 扩展):卡 id、板书行 id,
   * 外加 `mark:<题干片段>`、`analysis:<块>[:<第几条>]`、`takeaways:<组>:<第几条>`。
   * 「审题是讲出来的,不是摆出来的」—— 审题卡的四块和题干高亮都要靠 reveal 一条条亮。
   */
  const revealTargets = new Set<string>([...cardIds, ...lineOwner.keys()])
  for (const mark of analysis.marks) revealTargets.add(`mark:${mark.text}`)
  for (const block of ['given', 'hidden', 'find', 'ideas'] as const) {
    revealTargets.add(`analysis:${block}`)
    analysis[block].forEach((_, i) => revealTargets.add(`analysis:${block}:${i}`))
  }
  for (const group of TAKEAWAY_GROUPS) {
    takeaways[group].forEach((_, i) => revealTargets.add(`takeaways:${group}:${i}`))
  }
  const focusTargets = new Set<string>([...cardIds, ...columnIds])
  const steps: Step[] = []
  const usedHtmlActions = new Map<string, Set<string>>()
  for (const s of arr(raw.steps)) {
    const item = obj(s)
    const id = str(item.id)
    if (!claimId(id, '步骤')) continue
    const col = str(item.col)
    if (!columnIds.has(col)) {
      refFail(`步骤 ${id} 挂在不存在的列 ${col || '(空)'} 上`)
      ids.delete(id)
      continue
    }
    // 总结与动手不写成 steps:播放器讲完最后一步会按 takeaways / explore 自动推进,
    // 写成 steps 就会出现「整张 takeaways 卡被 reveal」「动手列的卡没人 reveal」这类拧巴(ISSUES W1)
    const colPhase = columns.find((c) => c.id === col)?.phase
    if (colPhase === 'summary' || colPhase === 'explore') {
      warnings.push(`已自动修正 · 总结/动手不写成 steps:删掉步骤 ${id}(挂在 ${colPhase === 'summary' ? '总结' : '动手'}列),播放器会自动推进`)
      ids.delete(id)
      continue
    }
    const flow: FlowItem[] = []
    /** 本步最近一次 reveal 的目标:say 没写 ref 时拿它兜底(protocol 11:40) */
    const lastReveal = { target: '' }
    for (const f of arr(item.flow)) {
      const fi = normalizeFlowItem(obj(f), {
        stepId: id,
        colPhase: colPhase ?? 'solve',
        lastReveal,
        revealTargets,
        focusTargets,
        animations: animationIds,
        lineOwner,
        cards,
        templates,
        usedHtmlActions,
        errors,
        warnings,
        refFail,
        dropped,
        cascade
      })
      if (fi) flow.push(fi)
    }
    if (!flow.some((f) => 'say' in f && str((f as { say: string }).say))) {
      errors.push(`步骤 ${id} 一句旁白都没有:每步至少一句 say`)
    }
    steps.push({ id, title: str(item.title) || id, col, flow })
  }
  if (!steps.length) errors.push('steps 是空的:没有可播的讲解')

  // ---------- 动画上板纪律(R1 补 reveal / R2 补底图 show / R4 主线告警)----------
  const discipline = enforceAnimationFlow({ animations, cards, columns, steps }, steps)
  warnings.push(...discipline.fixes, ...discipline.warnings)

  // ---------- 讲到哪亮到哪(审题步必须有 / 解题 ref 覆盖率 / 结论留红圈)----------
  const conclusionLines = new Set<string>()
  for (const [lineId, owner] of lineOwner) if (owner.line.kind === 'conclusion') conclusionLines.add(lineId)
  const anchors = enforceNarrationAnchors(steps, {
    phaseOf: (colId) => columns.find((c) => c.id === colId)?.phase,
    conclusionLines
  })
  errors.push(...anchors.errors)
  warnings.push(...anchors.fixes, ...anchors.warnings)

  // ---------- 动手 ----------
  let explore: BoardScript['explore']
  const exploreRaw = obj(raw.explore)
  if (Object.keys(exploreRaw).length) {
    const animationId = str(exploreRaw.animationId)
    const anim = animationIds.get(animationId)
    if (!anim) {
      if (dropped.has(animationId)) cascade(animationId, dropped.get(animationId)!, 'explore')
      else refFail(`explore.animationId 指向不存在的动画 ${animationId || '(空)'}`)
    } else {
      const tpl = anim.kind === 'template' ? templates.find((t) => t.id === anim.template) : undefined
      const unlock = arr(exploreRaw.unlock).map(String).filter((u) => {
        if (!tpl) return true
        if (tpl.handles[u]) return true
        warnings.push(`动手:参数 ${u} 在模板 ${tpl.id} 上没有手柄,已去掉`)
        return false
      })
      const tasks = arr(exploreRaw.tasks).map((t) => stripLatex(String(t))).filter(Boolean).slice(0, 3).map((t) => t.slice(0, 60))
      explore = { animationId, unlock, tasks }
    }
  }

  // ---------- 成品 ----------
  const script: BoardScript = {
    version: 2,
    title: (stripLatex(str(raw.title)) || '讲题').slice(0, 16),
    subject: SUBJECTS.includes(str(raw.subject) as Subject) ? (str(raw.subject) as Subject) : 'math',
    summary: stripLatex(str(raw.summary)).slice(0, 60) || '一道题的完整讲解。',
    problem: { text: problemText, images, answer: answerText },
    analysis,
    columns,
    cards,
    figures,
    animations,
    steps,
    takeaways
  }
  if (explore) script.explore = explore
  return { script, errors, warnings }
}

/** 板书行:formula 必须 tex + speech 双轨;conclusion 与答案对数 */
function normalizeBoardLine(
  raw: Record<string, unknown>,
  cardId: string,
  o: { errors: string[]; warnings: string[]; answerText: string }
): BoardLine | null {
  const id = str(raw.id)
  const kind = ['text', 'formula', 'conclusion'].includes(str(raw.kind)) ? (str(raw.kind) as BoardLine['kind']) : 'text'
  if (!id) {
    o.warnings.push(`卡片 ${cardId} 有一行没有 id,已去掉`)
    return null
  }
  const line: BoardLine = { id, kind }
  const tex = str(raw.tex)
  let text = str(raw.text)

  if (kind === 'formula') {
    if (!tex) {
      o.errors.push(`板书行 ${id}(卡片 ${cardId})是 formula 但缺 tex:公式行必须同时给 tex 与 speech`)
      return null
    }
    line.tex = tex
    const reference = texToSpeech(tex)
    let speech = str(raw.speech)
    if (!speech) {
      speech = reference
      o.warnings.push(`板书行 ${id} 缺 speech,已用 tex 转换器兜底生成:「${speech}」`)
    } else if (texHasLatexMarkup(speech)) {
      o.warnings.push(`板书行 ${id} 的 speech 里混进了 LaTeX 记号,已改用转换器生成的口语:「${reference}」`)
      speech = reference
    } else {
      const missing = speechMissingNumbers(speech, reference)
      if (missing.length) {
        o.warnings.push(`板书行 ${id} 的 speech 少了 tex 里的数字 ${missing.join('、')};老师念的和板上写的对不上,请核对`)
      }
    }
    // 希腊字母拉丁转写与中文数字是机械问题,直接换掉(其余措辞不碰)
    const spoken = normalizeSpokenText(speech)
    if (spoken.fixes.length) {
      o.warnings.push(`已自动修正 · 板书行 ${id} 的 speech:${spoken.fixes.join(';')}`)
      speech = spoken.text
    }
    line.speech = speech
    if (text) line.text = text
    return line
  }

  if (!text) {
    o.warnings.push(`板书行 ${id} 没有文字,已去掉`)
    return null
  }
  if (kind === 'conclusion' && o.answerText) {
    const answerNums = new Set(numbersIn(o.answerText))
    if (answerNums.size) {
      const bad = numbersIn(text).filter((n) => !answerNums.has(n))
      if (bad.length && !text.includes('与答案不符')) {
        text = `${text}(与答案不符,请核对)`
        o.warnings.push(`结论行 ${id} 里的「${bad.join('、')}」在答案里找不到;答案是 ground truth,已在板书上标「与答案不符,请核对」`)
      }
    }
  }
  line.text = text
  if (tex) line.tex = tex
  return line
}

/** template 动画参数:模板没有的丢掉,超范围的夹到边界 */
function normalizeTemplateParams(
  raw: Record<string, unknown>,
  tpl: BoardTemplateInfo,
  animId: string,
  warnings: string[]
): Record<string, number | string | unknown> {
  const out: Record<string, number | string | unknown> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (!(key in tpl.params)) {
      warnings.push(`动画 ${animId}:模板 ${tpl.id} 没有参数 ${key},已去掉`)
      continue
    }
    const range = tpl.paramRanges[key]
    if (!range) {
      out[key] = value
      continue
    }
    const n = Number(value)
    if (!Number.isFinite(n)) {
      warnings.push(`动画 ${animId}:参数 ${key} = ${String(value)} 不是数字,已去掉`)
      continue
    }
    const clamped = Math.min(range[1], Math.max(range[0], n))
    if (clamped !== n) {
      warnings.push(`动画 ${animId}:参数 ${key} = ${n} 超出 manifest 范围 [${range[0]}, ${range[1]}],已夹到 ${clamped}`)
    }
    out[key] = Math.round(clamped * 1000) / 1000
  }
  return out
}

interface FlowCtx {
  stepId: string
  colPhase: Phase
  /** 本步最近一次 reveal 的目标(引用传递,normalizeFlowItem 会更新它) */
  lastReveal: { target: string }
  revealTargets: Set<string>
  focusTargets: Set<string>
  animations: Map<string, Animation>
  lineOwner: Map<string, { cardId: string; line: BoardLine }>
  cards: Card[]
  templates: BoardTemplateInfo[]
  usedHtmlActions: Map<string, Set<string>>
  errors: string[]
  warnings: string[]
  refFail: (message: string) => void
  /** 被规则删掉的 id → 原因;指到它们的 flow 项连坐删掉,只记告警 */
  dropped: Map<string, string>
  cascade: (id: string, reason: string, what: string) => void
}

function normalizeFlowItem(raw: Record<string, unknown>, c: FlowCtx): FlowItem | null {
  const where = `步骤 ${c.stepId}`
  if (typeof raw.say === 'string') {
    let say = raw.say.trim()
    if (!say) return null
    if (texHasLatexMarkup(say)) {
      const cleaned = stripLatex(say)
      c.warnings.push(`${where} 的旁白里混进了 LaTeX 记号,已清掉:「${cleaned.slice(0, 30)}…」`)
      say = cleaned
    }
    const spoken = normalizeSpokenText(say)
    if (spoken.fixes.length) {
      c.warnings.push(`已自动修正 · ${where} 的旁白:${spoken.fixes.join(';')}`)
      say = spoken.text
    }
    if (say.length > SAY_MAX) {
      c.errors.push(`${where} 有一句旁白 ${say.length} 字(上限 ${SAY_MAX}):请拆成几句短的,与动作交错`)
      return { say: say.slice(0, SAY_MAX) }
    }
    const leak = say.match(DRAFT_LEAK)
    if (leak) {
      c.errors.push(`${where} 的旁白里混进了推理草稿(「${leak[0]}」附近):讲解词只能写讲给学生的定稿`)
    }

    // ref:这句话在讲板上的哪个东西。不存在的目标去掉;审题阶段必须有 ref,缺了就用本步最近一次 reveal 兜底
    const rawRefs = Array.isArray(raw.ref) ? raw.ref.map(String) : typeof raw.ref === 'string' ? [raw.ref] : []
    const refs = rawRefs.filter((t) => {
      if (c.revealTargets.has(t)) return true
      c.warnings.push(`${where}:旁白的 ref「${t}」指向不存在的卡/行/高亮,已去掉`)
      return false
    })
    // 只有两种情形才用「本步最近一次 reveal」兜底:审题阶段每句都必须有 ref(协议硬性要求,
    // 没写也要补);或者句子本来写了 ref 但指的东西不存在(不该因为一个笔误就让这句话彻底没有锚点)。
    // 解题阶段单纯没写 ref 时**不**兜底——留空才能让「≥60% 的 say 有 ref」这条覆盖率统计反映真实情况,
    // 播放器自己会在运行时按协议兜底指向最近一次 reveal,不需要校验器在剧本里替它写死。
    if (!refs.length && c.lastReveal.target && (rawRefs.length || c.colPhase === 'analysis')) {
      refs.push(c.lastReveal.target)
      c.warnings.push(`已自动修正 · ${where}:旁白缺 ref,已指向本步最近一次 reveal 的「${c.lastReveal.target}」`)
    }
    const item: FlowItem = { say }
    if (refs.length === 1) item.ref = refs[0]
    else if (refs.length > 1) item.ref = refs
    const emph = str(raw.emph)
    if (emph === 'mark' || emph === 'circle') item.emph = emph
    else if (emph) c.warnings.push(`${where}:emph「${emph}」只能是 mark 或 circle,已去掉`)
    return item
  }

  if (typeof raw.fx === 'string') {
    let fx = raw.fx
    // schema 只有 circle/underline/pulse,但模型受 lecture-scene 动作表影响老写 highlight(ISSUES 4)
    if (fx === 'highlight') {
      c.warnings.push(`已自动修正 · ${where}:fx「highlight」不在 schema 枚举里,已归一成 pulse`)
      fx = 'pulse'
    }
    if (!FX_KINDS.includes(fx)) {
      c.warnings.push(`${where}:不认识的 fx「${fx}」,已去掉`)
      return null
    }
    const target = str(raw.target)
    if (!c.revealTargets.has(target)) {
      if (c.dropped.has(target)) c.cascade(target, c.dropped.get(target)!, `${where} 的 fx ${fx}`)
      else c.refFail(`${where} 的 fx ${fx} 指向不存在的卡/行 ${target || '(空)'}`)
      return null
    }
    const item: FlowItem = { fx: fx as 'circle' | 'underline' | 'pulse', target }
    const snippet = str(raw.snippet)
    if (snippet) {
      const owner = c.lineOwner.get(target)
      const haystack = owner
        ? `${owner.line.text ?? ''}${owner.line.speech ?? ''}${owner.line.tex ?? ''}`
        : cardText(c.cards.find((card) => card.id === target))
      if (haystack && !haystack.includes(snippet)) {
        c.warnings.push(`${where}:红圈的 snippet「${snippet}」不在 ${target} 的文字里,已改成整卡高亮`)
      } else {
        item.snippet = snippet
      }
    }
    const color = str(raw.color)
    if (color) item.color = color
    return item
  }

  const doKind = str(raw.do)
  if (doKind === 'reveal') {
    const target = str(raw.target)
    if (!c.revealTargets.has(target)) {
      if (c.dropped.has(target)) c.cascade(target, c.dropped.get(target)!, `${where} 的 reveal`)
      else if (/^(mark|analysis|takeaways):/.test(target)) {
        // 高亮片段 / 审题块 / 总结条目对不上:模型编了一个不存在的锚点,删掉即可,不值得打回
        c.warnings.push(`${where}:reveal 的目标「${target}」对不上(mark 必须等于 analysis.marks 里的原文,analysis/takeaways 的序号不能越界),已去掉`)
      } else c.refFail(`${where} 的 reveal 指向不存在的卡/行 ${target || '(空)'}`)
      return null
    }
    c.lastReveal.target = target
    return { do: 'reveal', target }
  }
  if (doKind === 'focus') {
    const target = str(raw.target)
    if (!c.focusTargets.has(target)) {
      if (c.dropped.has(target)) c.cascade(target, c.dropped.get(target)!, `${where} 的 focus`)
      else c.refFail(`${where} 的 focus 指向不存在的卡/列 ${target || '(空)'}`)
      return null
    }
    return { do: 'focus', target }
  }
  if (doKind === 'pause') {
    const ms = Number(raw.ms)
    return { do: 'pause', ms: Number.isFinite(ms) ? Math.max(0, Math.min(5000, Math.round(ms))) : 600 }
  }
  if (doKind === 'anim') {
    const target = str(raw.target)
    const anim = c.animations.get(target)
    if (!anim) {
      if (c.dropped.has(target)) c.cascade(target, c.dropped.get(target)!, `${where} 的 anim`)
      else c.refFail(`${where} 的 anim 指向不存在的动画 ${target || '(空)'}`)
      return null
    }
    const action = obj(raw.action)
    if (!validateAnimAction(action, anim, c, where)) return null
    if (anim.kind !== 'template') {
      const set = c.usedHtmlActions.get(anim.id) ?? new Set<string>()
      set.add(str(action.name))
      c.usedHtmlActions.set(anim.id, set)
    }
    return { do: 'anim', target, action }
  }

  c.warnings.push(`${where}:flow 里有一项既不是 say 也不是 do/fx,已去掉`)
  return null
}

function cardText(card: Card | undefined): string {
  if (!card) return ''
  if (card.kind === 'heading') return card.text
  if (card.kind === 'points') return card.lines.join('')
  if (card.kind === 'table') return `${card.markdown}${card.speech}`
  if (card.kind === 'board') return card.lines.map((l) => `${l.text ?? ''}${l.speech ?? ''}${l.tex ?? ''}`).join('')
  return ''
}

/** template 动画的 action 按 manifest 校验;html / static 只接受 {type:'do', name, params} */
function validateAnimAction(action: Record<string, unknown>, anim: Animation, c: FlowCtx, where: string): boolean {
  const type = str(action.type)
  if (anim.kind !== 'template') {
    if (type !== 'do' || !str(action.name)) {
      c.errors.push(`${where}:html 动画 ${anim.id} 的动作只接受 {"type":"do","name":"…","params":{…}},现在是 ${JSON.stringify(action).slice(0, 60)}`)
      return false
    }
    return true
  }
  const tpl = c.templates.find((t) => t.id === anim.template)
  if (!tpl) return false
  if (!(type in tpl.actions)) {
    c.errors.push(`${where}:模板 ${tpl.id} 没有动作「${type || '(空)'}」;可用:${Object.keys(tpl.actions).join('、')}`)
    return false
  }
  const target = str(action.target)
  if (target && !(target in tpl.targets)) {
    c.errors.push(`${where}:模板 ${tpl.id} 没有元素「${target}」;可用:${Object.keys(tpl.targets).slice(0, 12).join('、')}`)
    return false
  }
  if (type === 'run') {
    const phase = str(action.phase)
    if (tpl.runPhases.length && !tpl.runPhases.includes(phase)) {
      c.errors.push(`${where}:模板 ${tpl.id} 的 run 没有相位「${phase || '(空)'}」;可用:${tpl.runPhases.join('、')}`)
      return false
    }
  }
  if (type === 'move') {
    const param = str(action.param)
    if (!(param in tpl.params)) {
      c.errors.push(`${where}:模板 ${tpl.id} 没有参数「${param || '(空)'}」,move 动不了`)
      return false
    }
    const range = tpl.paramRanges[param]
    for (const key of ['to', 'from']) {
      if (action[key] == null) continue
      const n = Number(action[key])
      if (!Number.isFinite(n)) {
        c.errors.push(`${where}:move 的 ${key} 不是数字`)
        return false
      }
      if (range) {
        const clamped = Math.min(range[1], Math.max(range[0], n))
        if (clamped !== n) c.warnings.push(`${where}:move 的 ${key} = ${n} 超出 [${range[0]}, ${range[1]}],已夹到 ${clamped}`)
        action[key] = clamped
      }
    }
  }
  return true
}

/** 总结条目:恰有一对【】。多了只留第一对,少了挑个关键词补上 */
function normalizeKeyword(item: string, group: string, warnings: string[]): string {
  const pairs = item.match(/【[^【】]*】/g) ?? []
  if (pairs.length === 1) return item.slice(0, 40)
  const plain = item.replace(/[【】]/g, '')
  if (pairs.length > 1) {
    warnings.push(`总结 ${group}:「${plain.slice(0, 16)}…」有 ${pairs.length} 对【】,只保留第一对`)
    const first = (pairs[0] ?? '').slice(1, -1)
    const at = first ? plain.indexOf(first) : -1
    if (at >= 0) return (plain.slice(0, at) + `【${first}】` + plain.slice(at + first.length)).slice(0, 44)
    return plain.slice(0, 40)
  }
  warnings.push(`总结 ${group}:「${plain.slice(0, 16)}…」没有用【】圈重点词,已自动圈一个,请核对`)
  const runs = plain.match(/[\u4e00-\u9fff]{2,6}/g) ?? []
  const keyword = runs.length ? runs.reduce((a, b) => (b.length >= a.length ? b : a)) : plain.slice(0, 4)
  const at = plain.indexOf(keyword)
  if (at < 0 || !keyword) return `【${plain.slice(0, 4)}】${plain.slice(4)}`.slice(0, 44)
  return (plain.slice(0, at) + `【${keyword}】` + plain.slice(at + keyword.length)).slice(0, 44)
}
