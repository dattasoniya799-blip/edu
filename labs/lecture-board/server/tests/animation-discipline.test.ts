import { describe, expect, it } from 'vitest'
import type { FlowItem } from '../../shared/schema'
import { ANIMATION_TEMPLATES, baseLayersOf } from '../src/templates'
import { normalizeBoardScript } from '../src/validate'

/**
 * 「内容上不了板」的七条硬约束(web 侧 2026-09-17 接真剧本踩到的坑,ISSUES W1)。
 * 这些坑前端都兜底了,但根在出剧本这边:校验器能就地修的一律就地修。
 */
const PROBLEM = '如图,△ABC 内接于 ⊙O,∠ACB = 40°,∠OAC = 15°,求 ∠ADB 的度数。'
const ANSWER = '∠ADB = 65°。'

interface Patch {
  animations?: unknown[]
  cards?: unknown[]
  steps?: unknown[]
  explore?: unknown
  columns?: unknown[]
}

/**
 * 默认的审题步(col c0,phase=analysis)。这份 fixture 的核心测试对象是「第(1)问」solve 步
 * (id 固定 s1,很多用例靠 flowOf(r) 默认取 steps[0] 拿它的 flow),所以把它放在数组最前面,
 * 审题步追加在后面 —— 只是为了满足「steps 必须以 phase=analysis 的审题步开头」这条硬约束
 * (见 board-discipline.ts 的 enforceNarrationAnchors),不影响既有用例按下标取值。
 */
const ANALYSIS_STEP = {
  id: 's0', title: '审题', col: 'c0',
  flow: [
    { say: '这道题在圆里求一个圆周角。', ref: 'k_problem' },
    { do: 'reveal', target: 'analysis:given' },
    { say: '已知圆周角 ACB 是 40 度。', ref: 'analysis:given' },
    { do: 'reveal', target: 'analysis:hidden' },
    { say: '半径相等,能构造出等腰三角形。', ref: 'analysis:hidden', emph: 'circle' },
    { do: 'reveal', target: 'analysis:find' },
    { say: '要求的是角 ADB。', ref: 'analysis:find' },
    { do: 'reveal', target: 'analysis:ideas' },
    { say: '思路是先求角 OCB,再往下推。', ref: 'analysis:ideas' }
  ]
}

/** 一问 + 一张动画卡的最小剧本;patch 里给的字段整体替换 */
function makeScript(patch: Patch = {}): Record<string, unknown> {
  return {
    version: 2,
    title: '圆与圆周角',
    subject: 'math',
    summary: '用半径构造等腰三角形求角。',
    problem: { text: PROBLEM, images: [], answer: ANSWER },
    analysis: { given: ['∠ACB = 40°'], hidden: ['OA=OC → 等腰'], find: ['∠ADB'], ideas: ['先求 ∠OCB'], marks: [] },
    columns: patch.columns ?? [
      { id: 'c0', title: '审题', phase: 'analysis' },
      { id: 'c1', title: '第(1)问 · 求角', phase: 'solve', subq: 1 },
      { id: 'c9', title: '总结', phase: 'summary' },
      { id: 'c10', title: '动手', phase: 'explore' }
    ],
    cards: patch.cards ?? [
      { id: 'k_problem', col: 'c0', kind: 'problem' },
      { id: 'k_analysis', col: 'c0', kind: 'analysis' },
      { id: 'k_anim', col: 'c1', kind: 'animation', animationId: 'a1' },
      { id: 'k_board', col: 'c1', kind: 'board', lines: [{ id: 'l1', kind: 'conclusion', text: '∠ADB = 65°' }] },
      { id: 'k_take', col: 'c9', kind: 'takeaways' }
    ],
    figures: [],
    animations: patch.animations ?? [
      { id: 'a1', kind: 'template', purpose: '演示圆周角', template: 'circle-angle', params: { thetaA: 120, thetaB: 40, thetaC: 330 } }
    ],
    steps: patch.steps ?? [
      {
        id: 's1', title: '求角', col: 'c1',
        flow: [
          { say: '看图中这个圆周角。' },
          { do: 'anim', target: 'a1', action: { type: 'show', target: 'circle' } },
          { do: 'anim', target: 'a1', action: { type: 'show', target: 'triangle' } },
          { do: 'reveal', target: 'l1' }
        ]
      },
      ANALYSIS_STEP
    ],
    takeaways: { knowledge: ['同弧的【圆周角】相等'], pitfalls: ['别漏了【等腰】'], methods: ['连【半径】造等腰'], variants: ['改问【切线】'] },
    ...(patch.explore !== undefined ? { explore: patch.explore } : {})
  }
}

const ctx = { problemText: PROBLEM, answerText: ANSWER, templates: ANIMATION_TEMPLATES }
const run = (patch?: Patch) => normalizeBoardScript(makeScript(patch), ctx)
const flowOf = (r: ReturnType<typeof run>, i = 0): FlowItem[] => r.script.steps[i].flow
const autoFixes = (r: ReturnType<typeof run>): string[] => r.warnings.filter((w) => w.startsWith('已自动修正'))

describe('R1 · do:anim 之前必须先 reveal 承载它的卡', () => {
  it('从没 reveal 动画卡 → 在首个 anim 前自动插入 reveal', () => {
    const r = run()
    const flow = flowOf(r)
    const revealAt = flow.findIndex((f) => (f as any).do === 'reveal' && (f as any).target === 'k_anim')
    const animAt = flow.findIndex((f) => (f as any).do === 'anim')
    expect(revealAt).toBeGreaterThanOrEqual(0)
    expect(revealAt).toBeLessThan(animAt)
    expect(autoFixes(r).some((w) => w.includes('k_anim'))).toBe(true)
    expect(r.errors).toEqual([])
  })

  it('剧本自己 reveal 过了 → 不重复插入', () => {
    const r = run({
      steps: [
        {
          id: 's1', title: '求角', col: 'c1',
          flow: [
            { do: 'reveal', target: 'k_anim' },
            { say: '看图中这个圆周角。' },
            { do: 'anim', target: 'a1', action: { type: 'show', target: 'circle' } },
            { do: 'anim', target: 'a1', action: { type: 'show', target: 'triangle' } }
          ]
        }
      ]
    })
    const reveals = flowOf(r).filter((f) => (f as any).do === 'reveal' && (f as any).target === 'k_anim')
    expect(reveals).toHaveLength(1)
  })

  it('reveal 在前一步里 → 也算数,不插入', () => {
    const r = run({
      steps: [
        { id: 's1', title: '铺场', col: 'c1', flow: [{ say: '先看这张动画。' }, { do: 'reveal', target: 'k_anim' }] },
        {
          id: 's2', title: '求角', col: 'c1',
          flow: [
            { say: '看图中的圆。' },
            { do: 'anim', target: 'a1', action: { type: 'show', target: 'circle' } },
            { do: 'anim', target: 'a1', action: { type: 'show', target: 'triangle' } }
          ]
        }
      ]
    })
    expect(flowOf(r, 1).filter((f) => (f as any).do === 'reveal')).toHaveLength(0)
    expect(autoFixes(r).some((w) => w.includes('k_anim'))).toBe(false)
  })
})

describe('R2 · template 动画首个动作前必须把底图层 show 出来', () => {
  it('baseLayersOf 从 manifest 取到各模板的底图层', () => {
    expect(baseLayersOf('circle-angle')).toEqual(['circle', 'triangle'])
    expect(baseLayersOf('buoyancy')).toEqual(['tank', 'model'])
    expect(baseLayersOf('quadratic-line')).toEqual(['axes', 'parabola'])
    for (const tpl of ANIMATION_TEMPLATES) {
      for (const layer of baseLayersOf(tpl.id)) expect(Object.keys(tpl.targets)).toContain(layer)
    }
  })

  it('只发 run,没 show 底图 → 自动补 show(浮力题实测:一个 show 都没有)', () => {
    const r = run({
      animations: [{ id: 'a1', kind: 'template', purpose: '演示浮沉', template: 'buoyancy', params: { V: 6 } }],
      steps: [
        {
          id: 's1', title: '入水', col: 'c1',
          flow: [
            { say: '看动画,模型沉到水底。' },
            { do: 'anim', target: 'a1', action: { type: 'run', phase: 'towater' } },
            { do: 'anim', target: 'a1', action: { type: 'show', target: 'forces' } }
          ]
        }
      ]
    })
    const actions = flowOf(r).filter((f) => (f as any).do === 'anim').map((f) => (f as any).action)
    expect(actions.slice(0, 2)).toEqual([
      { type: 'show', target: 'tank' },
      { type: 'show', target: 'model' }
    ])
    expect(actions[2]).toMatchObject({ type: 'run', phase: 'towater' })
    expect(autoFixes(r).some((w) => w.includes('底图'))).toBe(true)
  })

  it('剧本只 show 了一层 → 只补缺的那层(圆题实测:只 show 了 segBE)', () => {
    const r = run({
      steps: [
        {
          id: 's1', title: '求角', col: 'c1',
          flow: [
            { say: '看图中的线段 BE。' },
            { do: 'anim', target: 'a1', action: { type: 'draw', target: 'circle' } },
            { do: 'anim', target: 'a1', action: { type: 'show', target: 'segBE' } }
          ]
        }
      ]
    })
    const actions = flowOf(r).filter((f) => (f as any).do === 'anim').map((f) => (f as any).action)
    expect(actions[0]).toEqual({ type: 'show', target: 'triangle' }) // circle 已由 draw 点亮,只补 triangle
    expect(actions.filter((a: any) => a.target === 'circle')).toHaveLength(1)
  })

  it('底图层写全了 → 一个都不补', () => {
    const r = run()
    expect(autoFixes(r).some((w) => w.includes('底图'))).toBe(false)
    expect(flowOf(r).filter((f) => (f as any).do === 'anim')).toHaveLength(2)
  })

  it('html 动画没有底图层的概念 → 不补', () => {
    const r = run({
      animations: [{ id: 'a1', kind: 'html', purpose: '演示旋转' }],
      steps: [
        {
          id: 's1', title: '旋转', col: 'c1',
          flow: [
            { say: '看动画里三角形转起来。' },
            { do: 'anim', target: 'a1', action: { type: 'do', name: 'rotate' } },
            { do: 'anim', target: 'a1', action: { type: 'do', name: 'stopAtPerp' } }
          ]
        }
      ]
    })
    expect(flowOf(r).filter((f) => (f as any).do === 'anim')).toHaveLength(2)
    expect(autoFixes(r).some((w) => w.includes('底图'))).toBe(false)
  })
})

describe('R3 · 一张动画只挂一张卡', () => {
  const twoCards: Patch = {
    cards: [
      { id: 'k_problem', col: 'c0', kind: 'problem' },
      { id: 'k_analysis', col: 'c0', kind: 'analysis' },
      { id: 'k_anim', col: 'c1', kind: 'animation', animationId: 'a1' },
      { id: 'k_board', col: 'c1', kind: 'board', lines: [{ id: 'l1', kind: 'conclusion', text: '∠ADB = 65°' }] },
      { id: 'k_take', col: 'c9', kind: 'takeaways' },
      { id: 'k_explore', col: 'c10', kind: 'animation', animationId: 'a1' }
    ],
    explore: { animationId: 'a1', unlock: ['thetaC'], tasks: ['拖 C 点看圆周角变不变'] }
  }

  it('重复卡被删掉,保留首次出现的那张', () => {
    const r = normalizeBoardScript(makeScript(twoCards), ctx)
    const animCards = r.script.cards.filter((c) => c.kind === 'animation')
    expect(animCards).toHaveLength(1)
    expect(animCards[0].id).toBe('k_anim')
    expect(autoFixes(r).some((w) => w.includes('k_explore'))).toBe(true)
    expect(r.errors).toEqual([])
  })

  it('动手环节复用保留下来的那张,explore 仍然有效', () => {
    const r = normalizeBoardScript(makeScript(twoCards), ctx)
    expect(r.script.explore?.animationId).toBe('a1')
  })

  it('指向被删重复卡的 reveal 连坐清掉,不报错', () => {
    const patch: Patch = {
      ...twoCards,
      steps: [
        {
          id: 's1', title: '求角', col: 'c1',
          flow: [
            { say: '看图中这个圆周角。' },
            { do: 'reveal', target: 'k_explore' },
            { do: 'anim', target: 'a1', action: { type: 'show', target: 'circle' } },
            { do: 'anim', target: 'a1', action: { type: 'show', target: 'triangle' } }
          ]
        },
        ANALYSIS_STEP
      ]
    }
    const r = normalizeBoardScript(makeScript(patch), ctx)
    expect(r.errors).toEqual([])
    expect(flowOf(r).some((f) => (f as any).target === 'k_explore')).toBe(false)
  })
})

describe('R4 · 动画必须是推理主线(只告警,不打回)', () => {
  it('一张动画只被 1 个动作驱动 → 告警', () => {
    const r = run({
      steps: [
        {
          id: 's1', title: '求角', col: 'c1',
          flow: [{ say: '看图中的圆。' }, { do: 'anim', target: 'a1', action: { type: 'show', target: 'circle' } }]
        },
        ANALYSIS_STEP
      ]
    })
    expect(r.warnings.some((w) => w.includes('只被 1 个动作驱动'))).toBe(true)
    expect(r.errors).toEqual([])
  })

  it('动作附近没有一句指向画面的旁白 → 告警', () => {
    const r = run({
      steps: [
        {
          id: 's1', title: '求角', col: 'c1',
          flow: [
            { say: '半径相等所以是等腰三角形。' },
            { do: 'anim', target: 'a1', action: { type: 'show', target: 'circle' } },
            { do: 'anim', target: 'a1', action: { type: 'show', target: 'triangle' } }
          ]
        }
      ]
    })
    expect(r.warnings.some((w) => w.includes('指向画面'))).toBe(true)
  })

  it('有「看」「图中」这类词就不告警', () => {
    expect(run().warnings.some((w) => w.includes('指向画面'))).toBe(false)
  })

  it('同一列放了两张动画卡 → 告警', () => {
    const r = run({
      animations: [
        { id: 'a1', kind: 'template', purpose: '演示圆周角', template: 'circle-angle', params: {} },
        { id: 'a2', kind: 'html', purpose: '演示切线' }
      ],
      cards: [
        { id: 'k_problem', col: 'c0', kind: 'problem' },
        { id: 'k_analysis', col: 'c0', kind: 'analysis' },
        { id: 'k_anim', col: 'c1', kind: 'animation', animationId: 'a1' },
        { id: 'k_anim2', col: 'c1', kind: 'animation', animationId: 'a2' },
        { id: 'k_take', col: 'c9', kind: 'takeaways' }
      ]
    })
    expect(r.warnings.some((w) => w.includes('第(1)问 · 求角') && w.includes('2 张动画卡'))).toBe(true)
  })
})

describe('R5 · 总结与动手不写成 steps', () => {
  it('phase=summary / explore 的 step 被删掉并告警', () => {
    const r = run({
      steps: [
        ANALYSIS_STEP,
        {
          id: 's1', title: '求角', col: 'c1',
          flow: [
            { say: '看图中的圆。' },
            { do: 'anim', target: 'a1', action: { type: 'show', target: 'circle' } },
            { do: 'anim', target: 'a1', action: { type: 'show', target: 'triangle' } }
          ]
        },
        { id: 's2', title: '总结', col: 'c9', flow: [{ say: '这道题用到三个知识点。' }, { do: 'reveal', target: 'k_take' }] },
        { id: 's3', title: '动手', col: 'c10', flow: [{ say: '现在你来拖。' }] }
      ]
    })
    expect(r.script.steps.map((s) => s.id)).toEqual(['s0', 's1'])
    expect(autoFixes(r).filter((w) => w.includes('总结/动手不写成 steps')).length).toBe(2)
    expect(r.errors).toEqual([])
  })

  it('全是总结/动手步 → steps 空了,这才是错误', () => {
    const r = run({
      steps: [{ id: 's2', title: '总结', col: 'c9', flow: [{ say: '这道题用到三个知识点。' }] }]
    })
    expect(r.errors.some((e) => e.includes('steps 是空的'))).toBe(true)
  })
})

describe('R7 · fx 只认 circle / underline / pulse', () => {
  it('highlight 归一成 pulse(模型受 lecture-scene 动作表影响常写它)', () => {
    const r = run({
      steps: [
        {
          id: 's1', title: '求角', col: 'c1',
          flow: [
            { say: '看图中的圆。' },
            { do: 'anim', target: 'a1', action: { type: 'show', target: 'circle' } },
            { do: 'anim', target: 'a1', action: { type: 'show', target: 'triangle' } },
            { do: 'reveal', target: 'l1' },
            { fx: 'highlight', target: 'l1' }
          ]
        }
      ]
    })
    expect(flowOf(r).some((f) => (f as any).fx === 'pulse' && (f as any).target === 'l1')).toBe(true)
    expect(autoFixes(r).some((w) => w.includes('highlight'))).toBe(true)
  })

  it('真不认识的 fx 还是丢掉', () => {
    const r = run({
      steps: [
        {
          id: 's1', title: '求角', col: 'c1',
          flow: [
            { say: '看图中的圆。' },
            { do: 'anim', target: 'a1', action: { type: 'show', target: 'circle' } },
            { do: 'anim', target: 'a1', action: { type: 'show', target: 'triangle' } },
            { fx: 'explode', target: 'l1' }
          ]
        }
      ]
    })
    expect(flowOf(r).some((f) => 'fx' in (f as object))).toBe(false)
  })
})

describe('R6 · 校验器把 speech / say 的机械问题就地改掉', () => {
  it('板书行 speech 里的希腊字母与中文数字被替换', () => {
    const r = run({
      cards: [
        { id: 'k_problem', col: 'c0', kind: 'problem' },
        { id: 'k_analysis', col: 'c0', kind: 'analysis' },
        { id: 'k_anim', col: 'c1', kind: 'animation', animationId: 'a1' },
        {
          id: 'k_board', col: 'c1', kind: 'board',
          lines: [{ id: 'l1', kind: 'formula', tex: '\\angle ADB = 65^\\circ', speech: '角 ADB 等于六十五度' }]
        },
        { id: 'k_take', col: 'c9', kind: 'takeaways' }
      ]
    })
    const line = (r.script.cards.find((c) => c.id === 'k_board') as any).lines[0]
    expect(line.speech).toBe('角 ADB 等于 65 度')
  })

  it('say 里的希腊字母也换', () => {
    const r = run({
      steps: [
        {
          id: 's1', title: '求角', col: 'c1',
          flow: [
            { say: '看图中,余弦 alpha 等于 5 分之 3。' },
            { do: 'anim', target: 'a1', action: { type: 'show', target: 'circle' } },
            { do: 'anim', target: 'a1', action: { type: 'show', target: 'triangle' } }
          ]
        }
      ]
    })
    expect((flowOf(r)[1] as any).say ?? (flowOf(r)[0] as any).say).toContain('阿尔法')
  })
})
