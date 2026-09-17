import { describe, expect, it } from 'vitest'
import type { FlowItem } from '../../shared/schema'
import { ANIMATION_TEMPLATES } from '../src/templates'
import { normalizeBoardScript } from '../src/validate'

/**
 * 「讲到哪、亮到哪」(schema / protocol 2026-09-17 11:40 扩展):
 * target 与 ref 多了 `mark:<text>` / `analysis:<block>[:<i>]` / `takeaways:<group>:<i>` 三种写法;
 * steps 必须以 phase=analysis 的审题步开头,审题每句必有 ref,解题阶段 ≥ 60% 的 say 有 ref。
 */
const PROBLEM = '模型体积为 6×10⁻⁴ m³,注水前模型质量为 0.48 kg。模型沉入水底。求注水前对桌面的压强。'
const ANSWER = '600 Pa'

interface Patch {
  steps?: unknown[]
  analysis?: unknown
  takeaways?: unknown
}

function makeScript(patch: Patch = {}): Record<string, unknown> {
  return {
    version: 2,
    title: '潜艇浮沉',
    subject: 'physics',
    summary: '压强一问。',
    problem: { text: PROBLEM, images: [], answer: ANSWER },
    analysis: patch.analysis ?? {
      given: ['V = 6×10⁻⁴ m³', 'm = 0.48 kg'],
      hidden: ['沉入水底 → 完全浸没'],
      find: ['注水前对桌面的压强'],
      ideas: ['p = F/S'],
      marks: [
        { text: '6×10⁻⁴ m³', kind: 'data' },
        { text: '0.48 kg', kind: 'data' },
        { text: '沉入水底', kind: 'hidden' }
      ]
    },
    columns: [
      { id: 'c0', title: '审题', phase: 'analysis' },
      { id: 'c1', title: '第(1)问 · 压强', phase: 'solve', subq: 1 },
      { id: 'c9', title: '总结', phase: 'summary' }
    ],
    cards: [
      { id: 'k_problem', col: 'c0', kind: 'problem' },
      { id: 'k_analysis', col: 'c0', kind: 'analysis' },
      {
        id: 'k1', col: 'c1', kind: 'board',
        lines: [
          { id: 'l1', kind: 'text', text: '压力等于重力' },
          { id: 'l2', kind: 'conclusion', text: 'p = 600 Pa' }
        ]
      },
      { id: 'k_take', col: 'c9', kind: 'takeaways' }
    ],
    figures: [],
    animations: [],
    steps: patch.steps ?? [
      {
        id: 's0', title: '审题', col: 'c0',
        flow: [
          { say: '这道题问注水前对桌面的压强。', ref: 'k_problem' },
          { do: 'reveal', target: 'mark:6×10⁻⁴ m³' },
          { say: '体积是 6 乘 10 的负 4 次方立方米。', ref: 'mark:6×10⁻⁴ m³', emph: 'mark' },
          { do: 'reveal', target: 'mark:0.48 kg' },
          { say: '注水前质量 0.48 千克。', ref: 'mark:0.48 kg', emph: 'mark' },
          { do: 'reveal', target: 'analysis:given' },
          { do: 'reveal', target: 'mark:沉入水底' },
          { say: '沉入水底说明完全浸没。', ref: 'mark:沉入水底', emph: 'circle' },
          { do: 'reveal', target: 'analysis:hidden:0' },
          { do: 'reveal', target: 'analysis:find' },
          { say: '要求的是压强。', ref: 'analysis:find' },
          { do: 'reveal', target: 'analysis:ideas' },
          { say: '思路是压力除以受力面积。', ref: 'analysis:ideas' }
        ]
      },
      {
        id: 's1', title: '压强', col: 'c1',
        flow: [
          { do: 'reveal', target: 'l1' },
          { say: '水平面上压力等于重力。', ref: 'l1' },
          { do: 'reveal', target: 'l2' },
          { say: '算出来是 600 帕。', ref: 'l2', emph: 'circle' }
        ]
      }
    ],
    takeaways: patch.takeaways ?? {
      knowledge: ['水平面上【压力等于重力】'],
      pitfalls: ['面积单位别用【平方厘米】'],
      methods: ['先【列全已知】再套公式'],
      variants: ['改问【浸没时的浮力】']
    }
  }
}

const ctx = { problemText: PROBLEM, answerText: ANSWER, templates: ANIMATION_TEMPLATES }
const run = (patch?: Patch) => normalizeBoardScript(makeScript(patch), ctx)
const analysisFlow = (r: ReturnType<typeof run>): FlowItem[] => r.script.steps[0].flow

describe('新目标写法 mark: / analysis: / takeaways:', () => {
  it('合格的审题步零错误,三种目标都留下来', () => {
    const r = run()
    expect(r.errors).toEqual([])
    const targets = analysisFlow(r).filter((f) => (f as any).do === 'reveal').map((f) => (f as any).target)
    expect(targets).toContain('mark:0.48 kg')
    expect(targets).toContain('analysis:given')
    expect(targets).toContain('analysis:hidden:0')
  })

  it('takeaways:<group>:<i> 也是合法目标', () => {
    const r = run({
      steps: [
        {
          id: 's0', title: '审题', col: 'c0',
          flow: [{ say: '先看这道题。', ref: 'k_problem' }, { do: 'reveal', target: 'analysis:given' }, { say: '已知两个量。', ref: 'analysis:given' }]
        },
        {
          id: 's1', title: '压强', col: 'c1',
          flow: [{ do: 'reveal', target: 'takeaways:knowledge:0' }, { say: '记住这条。', ref: 'takeaways:knowledge:0' }]
        }
      ]
    })
    expect(r.errors).toEqual([])
    expect((r.script.steps[1].flow[0] as any).target).toBe('takeaways:knowledge:0')
  })

  it('mark:<不在 marks 里的文本> → 删掉 reveal 并告警', () => {
    const r = run({
      steps: [
        {
          id: 's0', title: '审题', col: 'c0',
          flow: [
            { say: '先看题。', ref: 'k_problem' },
            { do: 'reveal', target: 'mark:这段题干里没有' },
            { do: 'reveal', target: 'analysis:given' },
            { say: '已知两个量。', ref: 'analysis:given' }
          ]
        },
        { id: 's1', title: '压强', col: 'c1', flow: [{ do: 'reveal', target: 'l2' }, { say: '得 600 帕。', ref: 'l2' }] }
      ]
    })
    expect(analysisFlow(r).some((f) => String((f as any).target).includes('这段题干里没有'))).toBe(false)
    expect(r.warnings.some((w) => w.includes('这段题干里没有'))).toBe(true)
    expect(r.errors).toEqual([])
  })

  it('analysis:hidden:9 越界 → 删掉并告警', () => {
    const r = run({
      steps: [
        {
          id: 's0', title: '审题', col: 'c0',
          flow: [{ say: '先看题。', ref: 'k_problem' }, { do: 'reveal', target: 'analysis:hidden:9' }, { say: '隐含条件。', ref: 'analysis:given' }]
        },
        { id: 's1', title: '压强', col: 'c1', flow: [{ do: 'reveal', target: 'l2' }, { say: '得 600 帕。', ref: 'l2' }] }
      ]
    })
    expect(r.warnings.some((w) => w.includes('analysis:hidden:9'))).toBe(true)
    expect(r.errors).toEqual([])
  })
})

describe('say 的 ref / emph', () => {
  it('ref 与 emph 原样保留', () => {
    const say = analysisFlow(run()).find((f) => (f as any).emph === 'mark') as any
    expect(say.ref).toBe('mark:6×10⁻⁴ m³')
    expect(say.emph).toBe('mark')
  })

  it('ref 可以是数组', () => {
    const r = run({
      steps: [
        {
          id: 's0', title: '审题', col: 'c0',
          flow: [
            { do: 'reveal', target: 'analysis:given' },
            { say: '两个已知量都在这里。', ref: ['analysis:given:0', 'analysis:given:1'] }
          ]
        },
        { id: 's1', title: '压强', col: 'c1', flow: [{ do: 'reveal', target: 'l2' }, { say: '得 600 帕。', ref: 'l2' }] }
      ]
    })
    expect((analysisFlow(r)[1] as any).ref).toEqual(['analysis:given:0', 'analysis:given:1'])
  })

  it('ref 指向不存在的东西 → 去掉 ref 并告警,句子留着', () => {
    const r = run({
      steps: [
        {
          id: 's0', title: '审题', col: 'c0',
          flow: [{ do: 'reveal', target: 'analysis:given' }, { say: '看这里。', ref: 'k_ghost' }]
        },
        { id: 's1', title: '压强', col: 'c1', flow: [{ do: 'reveal', target: 'l2' }, { say: '得 600 帕。', ref: 'l2' }] }
      ]
    })
    const say = analysisFlow(r)[1] as any
    expect(say.say).toBe('看这里。')
    expect(say.ref).toBe('analysis:given') // 退回本步最近一次 reveal
    expect(r.warnings.some((w) => w.includes('k_ghost'))).toBe(true)
  })

  it('emph 只认 mark / circle,别的丢掉', () => {
    const r = run({
      steps: [
        {
          id: 's0', title: '审题', col: 'c0',
          flow: [{ do: 'reveal', target: 'analysis:given' }, { say: '看这里。', ref: 'analysis:given', emph: 'rainbow' }]
        },
        { id: 's1', title: '压强', col: 'c1', flow: [{ do: 'reveal', target: 'l2' }, { say: '得 600 帕。', ref: 'l2' }] }
      ]
    })
    expect((analysisFlow(r)[1] as any).emph).toBeUndefined()
  })
})

describe('审题 step 是硬要求', () => {
  it('一个 phase=analysis 的 step 都没有 → 打回重写(error)', () => {
    const r = run({
      steps: [{ id: 's1', title: '压强', col: 'c1', flow: [{ do: 'reveal', target: 'l2' }, { say: '得 600 帕。', ref: 'l2' }] }]
    })
    expect(r.errors.some((e) => e.includes('审题'))).toBe(true)
  })

  it('审题 say 没写 ref → 自动指向本步最近一次 reveal,并告警', () => {
    const r = run({
      steps: [
        {
          id: 's0', title: '审题', col: 'c0',
          flow: [
            { do: 'reveal', target: 'mark:0.48 kg' },
            { say: '注水前质量 0.48 千克。' },
            { do: 'reveal', target: 'analysis:given' },
            { say: '已知就这两条。' }
          ]
        },
        { id: 's1', title: '压强', col: 'c1', flow: [{ do: 'reveal', target: 'l2' }, { say: '得 600 帕。', ref: 'l2' }] }
      ]
    })
    const flow = analysisFlow(r) as any[]
    expect(flow[1].ref).toBe('mark:0.48 kg')
    expect(flow[3].ref).toBe('analysis:given')
    expect(r.warnings.filter((w) => w.startsWith('已自动修正') && w.includes('ref')).length).toBeGreaterThanOrEqual(1)
  })

  it('审题 say 少于 4 句 → 告警(不打回)', () => {
    const r = run({
      steps: [
        {
          id: 's0', title: '审题', col: 'c0',
          flow: [{ do: 'reveal', target: 'analysis:given' }, { say: '已知两个量。', ref: 'analysis:given' }]
        },
        { id: 's1', title: '压强', col: 'c1', flow: [{ do: 'reveal', target: 'l2' }, { say: '得 600 帕。', ref: 'l2' }] }
      ]
    })
    expect(r.warnings.some((w) => w.includes('审题') && w.includes('4–8'))).toBe(true)
    expect(r.errors).toEqual([])
  })

  it('审题逐条念数据(≥3 句短旁白各指一处 mark)→ 告警「像在逐条念条件」', () => {
    const r = run({
      steps: [
        {
          id: 's0', title: '审题', col: 'c0',
          flow: [
            { say: '这道题考压强与浮力。', ref: 'k_problem' },
            { do: 'reveal', target: 'mark:0.48 kg' }, { say: '质量 0.48 千克。', ref: 'mark:0.48 kg', emph: 'mark' },
            { do: 'reveal', target: 'mark:0.48 kg' }, { say: '体积是这个。', ref: 'mark:0.48 kg', emph: 'mark' },
            { do: 'reveal', target: 'mark:0.48 kg' }, { say: '面积是这个。', ref: 'mark:0.48 kg', emph: 'mark' },
            { do: 'reveal', target: 'analysis:find' }, { say: '求三个量。', ref: 'analysis:find' }
          ]
        },
        { id: 's1', title: '压强', col: 'c1', flow: [{ do: 'reveal', target: 'l2' }, { say: '得 600 帕。', ref: 'l2' }] }
      ]
    })
    expect(r.warnings.some((w) => w.includes('逐条念条件'))).toBe(true)
    expect(r.errors).toEqual([])
  })
})

describe('解题阶段的 ref 覆盖率与 conclusion 的红圈', () => {
  it('解题 say 有 ref 的比例低于 60% → 告警', () => {
    const r = run({
      steps: [
        makeScript().steps as never,
        { id: 's1', title: '压强', col: 'c1', flow: [{ do: 'reveal', target: 'l1' }, { say: '一。' }, { say: '二。' }, { say: '三。' }] }
      ].slice(1) as unknown[]
    })
    // 上面 slice 掉了审题步,所以会同时报「缺审题」;这里只看覆盖率那条
    expect(r.warnings.some((w) => w.includes('60%'))).toBe(true)
  })

  it('conclusion 行 reveal 之后紧跟的 say 自动补 ref + emph:circle', () => {
    const r = run({
      steps: [
        {
          id: 's0', title: '审题', col: 'c0',
          flow: [{ do: 'reveal', target: 'analysis:given' }, { say: '已知两个量。', ref: 'analysis:given' }]
        },
        {
          id: 's1', title: '压强', col: 'c1',
          flow: [{ do: 'reveal', target: 'l1' }, { say: '压力等于重力。', ref: 'l1' }, { do: 'reveal', target: 'l2' }, { say: '算出来是 600 帕。' }]
        }
      ]
    })
    const last = r.script.steps[1].flow[3] as any
    expect(last.ref).toBe('l2')
    expect(last.emph).toBe('circle')
    expect(r.warnings.some((w) => w.startsWith('已自动修正') && w.includes('circle'))).toBe(true)
  })

  it('已经写了 emph:circle 就不重复补', () => {
    const r = run()
    const fixes = r.warnings.filter((w) => w.startsWith('已自动修正') && w.includes('circle'))
    expect(fixes).toHaveLength(0)
  })
})
