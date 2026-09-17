/**
 * 动画在白板上「上得了板」的纪律(2026-09-17 第二轮:web 侧接真剧本后回流的坑,ISSUES W1)。
 *
 * 前端对这几条都做了兜底,但根在出剧本这边 —— 提示词写清楚、校验器就地修:
 *  R1 `do:anim` 之前必须先 `reveal` 承载它的动画卡,否则动作发给一张还没浮现的卡;
 *  R2 template 动画首个动作前必须把底图层 `show` 出来,否则卡片一片空白;
 *  R4 动画要当推理主线用:至少两个动作驱动、旁白里要有一句把学生的眼睛指过去。
 *
 * R1/R2 是自动插入(改 flow),R4 只统计与告警。统计结果同时给 `run-problem` 的报告用。
 */
import type { Animation, BoardScript, Card, FlowItem, Step } from '../../shared/schema'
import { baseLayersOf } from './templates'

/** 旁白里「把眼睛指向画面」的说法 */
export const SCREEN_POINTER_RE = /看|图中|图里|图上|画面|动画|演示|屏幕|如图|观察|盯着/

type AnimFlowItem = Extract<FlowItem, { do: 'anim' }>

const isAnim = (f: FlowItem): f is AnimFlowItem => (f as AnimFlowItem).do === 'anim'
const isReveal = (f: FlowItem, target: string): boolean =>
  (f as Extract<FlowItem, { do: 'reveal' }>).do === 'reveal' && (f as Extract<FlowItem, { do: 'reveal' }>).target === target
const sayOf = (f: FlowItem): string => (typeof (f as { say?: unknown }).say === 'string' ? (f as { say: string }).say : '')

export interface AnimationUsage {
  id: string
  kind: Animation['kind']
  template?: string
  /** 承载它的动画卡;剧本没给动画卡时为空 */
  cardId?: string
  colTitle?: string
  /** 剧本自己写的 anim 动作数(不含校验器补的底图 show) */
  actions: number
  /** 这些动作用到的动作名(html 动画)或动作类型(template 动画) */
  actionNames: string[]
  /** 与这张动画同一步里、把眼睛指向画面的旁白句数 */
  screenSays: number
}

/** 统计每张动画被怎么用的;`run-problem` 的报告与 R4 告警共用 */
export function animationUsage(script: BoardScript): AnimationUsage[] {
  const cardOf = new Map<string, Card & { kind: 'animation' }>()
  for (const card of script.cards ?? []) {
    if (card.kind === 'animation' && !cardOf.has(card.animationId)) cardOf.set(card.animationId, card)
  }
  const colTitle = new Map((script.columns ?? []).map((c) => [c.id, c.title]))

  return (script.animations ?? []).map((anim) => {
    const card = cardOf.get(anim.id)
    let actions = 0
    const actionNames: string[] = []
    let screenSays = 0
    for (const step of script.steps ?? []) {
      const mine = step.flow.filter((f) => isAnim(f) && f.target === anim.id) as AnimFlowItem[]
      if (!mine.length) continue
      actions += mine.length
      for (const item of mine) {
        const action = item.action as { type?: unknown; name?: unknown }
        const name = typeof action.name === 'string' ? action.name : String(action.type ?? '')
        if (name && !actionNames.includes(name)) actionNames.push(name)
      }
      screenSays += step.flow.filter((f) => SCREEN_POINTER_RE.test(sayOf(f))).length
    }
    return {
      id: anim.id,
      kind: anim.kind,
      template: anim.template,
      cardId: card?.id,
      colTitle: card ? colTitle.get(card.col) : undefined,
      actions,
      actionNames,
      screenSays
    }
  })
}

export interface DisciplineResult {
  /** 就地改了什么(已自动修正) */
  fixes: string[]
  /** 改不了、只能提醒的 */
  warnings: string[]
}

/**
 * R1 + R2 的自动插入,以及 R4 的告警。直接改 `steps` 里的 flow。
 * 统计在插入之前算,否则补进去的底图 show 会把「只被 1 个动作驱动」这种问题盖掉。
 */
export function enforceAnimationFlow(
  script: Pick<BoardScript, 'animations' | 'cards' | 'columns' | 'steps'>,
  steps: Step[]
): DisciplineResult {
  const fixes: string[] = []
  const warnings: string[] = []
  const usage = animationUsage(script as BoardScript)

  for (const anim of script.animations ?? []) {
    const use = usage.find((u) => u.id === anim.id)
    if (!use || !use.actions) continue

    // 首个 anim 动作的位置
    let stepIdx = -1
    let flowIdx = -1
    outer: for (let i = 0; i < steps.length; i++) {
      for (let j = 0; j < steps[i].flow.length; j++) {
        const f = steps[i].flow[j]
        if (isAnim(f) && f.target === anim.id) {
          stepIdx = i
          flowIdx = j
          break outer
        }
      }
    }
    if (stepIdx < 0) continue

    // ---- R1:首个动作之前必须 reveal 承载卡 ----
    if (use.cardId) {
      let revealed = false
      for (let i = 0; i <= stepIdx && !revealed; i++) {
        const upto = i === stepIdx ? flowIdx : steps[i].flow.length
        for (let j = 0; j < upto; j++) if (isReveal(steps[i].flow[j], use.cardId)) revealed = true
      }
      if (!revealed) {
        steps[stepIdx].flow.splice(flowIdx, 0, { do: 'reveal', target: use.cardId })
        flowIdx++
        fixes.push(
          `已自动修正 · 动画 ${anim.id} 在步骤 ${steps[stepIdx].id} 里先发动作却从没浮现承载卡 ${use.cardId},已在首个动作前补一条 reveal`
        )
      }
    }

    // ---- R2:template 动画首个动作前要把底图层 show 出来 ----
    if (anim.kind === 'template') {
      const shown = new Set<string>()
      for (const step of steps) {
        for (const f of step.flow) {
          if (!isAnim(f) || f.target !== anim.id) continue
          const action = f.action as { type?: unknown; target?: unknown }
          if ((action.type === 'show' || action.type === 'draw') && typeof action.target === 'string') shown.add(action.target)
        }
      }
      const missing = baseLayersOf(anim.template).filter((layer) => !shown.has(layer))
      if (missing.length) {
        steps[stepIdx].flow.splice(
          flowIdx,
          0,
          ...missing.map<FlowItem>((layer) => ({ do: 'anim', target: anim.id, action: { type: 'show', target: layer } }))
        )
        fixes.push(
          `已自动修正 · 动画 ${anim.id}(${anim.template})首个动作前没把底图层亮出来,卡片会是空白;已补 show ${missing.join('、')}`
        )
      }
    }

    // ---- R4:动画要当推理主线用(只告警) ----
    if (use.actions < 2) {
      warnings.push(
        `动画 ${anim.id} 只被 1 个动作驱动;动画要当推理主线用,至少让它动两次(分步 show / run / move),否则学生只看到一张静态图`
      )
    }
    if (!use.screenSays) {
      warnings.push(
        `动画 ${anim.id} 附近没有一句指向画面的旁白;发动作的那几步里至少要有一句说「看…」「图中…」,否则学生不知道该看哪`
      )
    }
  }

  // ---- R4:每一问最多一张动画卡 ----
  const perCol = new Map<string, number>()
  for (const card of script.cards ?? []) {
    if (card.kind === 'animation') perCol.set(card.col, (perCol.get(card.col) ?? 0) + 1)
  }
  for (const [colId, count] of perCol) {
    if (count <= 1) continue
    const title = (script.columns ?? []).find((c) => c.id === colId)?.title ?? colId
    warnings.push(`列「${title}」里放了 ${count} 张动画卡;每一问最多一张,多的那张请改成板书或并进同一张动画`)
  }

  return { fixes, warnings }
}

/**
 * 「讲到哪、亮到哪」的纪律(protocol 2026-09-17 11:40):
 *  - steps 必须以 phase=analysis 的审题步开头(缺了打回重写)——审题是讲出来的,不是摆出来的;
 *  - 审题步合计 5–9 句 say;
 *  - 解题阶段 ≥ 60% 的 say 带 ref,否则旁白没有视觉锚点;
 *  - conclusion 行 reveal 之后紧跟的那句 say 自动配上 ref + emph:'circle'(结论要留红圈)。
 * 审题步缺 ref 的兜底在 normalizeFlowItem 里逐句做,这里只做跨步的统计与结论红圈。
 */
export function enforceNarrationAnchors(
  steps: Step[],
  o: { phaseOf: (colId: string) => string | undefined; conclusionLines: Set<string> }
): DisciplineResult & { errors: string[] } {
  const errors: string[] = []
  const fixes: string[] = []
  const warnings: string[] = []

  const analysisSteps = steps.filter((s) => o.phaseOf(s.col) === 'analysis')
  if (!analysisSteps.length) {
    errors.push(
      'steps 里没有 phase=analysis 的审题步:剧本必须以 1–2 个审题步开头,逐条 reveal 题干高亮(mark:…)与审题四块(analysis:…)并讲出来,而不是把审题列整列摆出来'
    )
  } else {
    const saysCount = analysisSteps.reduce((n, s) => n + s.flow.filter((f) => sayOf(f)).length, 0)
    if (saysCount < 5 || saysCount > 9) {
      warnings.push(`审题步一共 ${saysCount} 句旁白,纪律是 5–9 句(一句总览 + 逐条已知 + 隐含条件 + 求什么 + 思路)`)
    }
  }

  // conclusion 行讲完要留红圈
  for (const step of steps) {
    for (let i = 0; i < step.flow.length - 1; i++) {
      const cur = step.flow[i] as Extract<FlowItem, { do: 'reveal' }>
      if (cur.do !== 'reveal' || !o.conclusionLines.has(cur.target)) continue
      const next = step.flow[i + 1] as { say?: string; ref?: string | string[]; emph?: string }
      if (typeof next.say !== 'string') continue
      if (next.emph === 'circle') continue
      next.ref = cur.target
      next.emph = 'circle'
      fixes.push(`已自动修正 · 步骤 ${step.id}:结论行 ${cur.target} 讲完没留红圈,已给紧随的旁白加 ref + emph:'circle'`)
    }
  }

  // 解题阶段的 ref 覆盖率
  const solveSays = steps
    .filter((s) => o.phaseOf(s.col) === 'solve')
    .flatMap((s) => s.flow.filter((f) => sayOf(f)) as Array<{ ref?: string | string[] }>)
  if (solveSays.length) {
    const withRef = solveSays.filter((f) => (Array.isArray(f.ref) ? f.ref.length > 0 : Boolean(f.ref))).length
    const ratio = withRef / solveSays.length
    if (ratio < 0.6) {
      warnings.push(
        `解题阶段只有 ${withRef}/${solveSays.length}(${Math.round(ratio * 100)}%)的旁白写了 ref,低于 60%;旁白要指着板上的东西讲,学生才知道看哪`
      )
    }
  }

  return { errors, fixes, warnings }
}

/**
 * html 动画生成完之后的对账:HTML 里实现了的 do 动作名,剧本一次都没用 → 白写了。
 * 从源码里抠 `case 'xxx'` / `name === 'xxx'` / `{ xxx: () => }` 这几种常见写法。
 */
export function unusedHtmlActions(html: string, usedNames: string[]): string[] {
  const implemented = new Set<string>()
  for (const re of [/case\s*['"]([A-Za-z][\w-]*)['"]/g, /name\s*===\s*['"]([A-Za-z][\w-]*)['"]/g, /['"]?([A-Za-z][\w-]*)['"]?\s*:\s*(?:function\b|\()/g]) {
    for (const m of String(html ?? '').matchAll(re)) implemented.add(m[1])
  }
  // 明显不是动作名的公共词
  for (const noise of ['do', 'unlock', 'reset', 'type', 'name', 'params', 'message', 'function', 'if', 'for', 'return', 'value', 'data']) {
    implemented.delete(noise)
  }
  const used = new Set(usedNames)
  return [...implemented].filter((n) => !used.has(n))
}
