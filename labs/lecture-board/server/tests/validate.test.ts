import { describe, expect, it } from 'vitest'
import { extractJson, normalizeBoardScript } from '../src/validate'
import { ANIMATION_TEMPLATES } from '../src/templates'

const PROBLEM = '13.物理小组研究遥控潜艇模型。模型体积为 6×10⁻⁴ m³,注水前模型质量为 0.48 kg,与桌面接触面积为 8×10⁻³ m²。模型沉入水底。求\n(1)注水前模型对水平桌面的压强;\n(2)模型沉在水底受到的浮力。'
const ANSWER = '(1)600 Pa;(2)6 N。'

function makeScript(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 2,
    title: '潜艇浮沉',
    subject: 'physics',
    summary: '压强与浮力两问。',
    problem: { text: PROBLEM, images: ['/assets/x/input/1.jpg'], answer: ANSWER },
    analysis: {
      given: ['V = 6×10⁻⁴ m³'],
      hidden: ['沉入水底 → 完全浸没'],
      find: ['(1)压强'],
      ideas: ['p = F/S'],
      marks: [{ text: '0.48 kg', kind: 'data' }]
    },
    columns: [
      { id: 'c0', title: '审题', phase: 'analysis' },
      { id: 'c1', title: '第(1)问 · 压强', phase: 'solve', subq: 1 },
      { id: 'c2', title: '总结', phase: 'summary' }
    ],
    cards: [
      { id: 'k_problem', col: 'c0', kind: 'problem' },
      { id: 'k_analysis', col: 'c0', kind: 'analysis' },
      {
        id: 'k1', col: 'c1', kind: 'board', title: '压强',
        lines: [
          { id: 'l1', kind: 'text', text: '水平桌面上压力等于重力' },
          { id: 'l2', kind: 'formula', tex: 'p = \\frac{F}{S} = 600\\,\\text{Pa}', speech: '压强等于受力面积分之压力,等于 600 帕' },
          { id: 'l3', kind: 'conclusion', text: 'p = 600 Pa' }
        ]
      },
      { id: 'k_take', col: 'c2', kind: 'takeaways' }
    ],
    figures: [],
    animations: [],
    // s1(index 0)是这份 fixture 一直以来测的「解题步」,很多用例直接改它的 flow[0]/[1] ——
    // 保持它在数组最前面;新增的审题步 s0 放在后面,只是为了满足「steps 必须以 phase=analysis
    // 的审题步开头」这条硬约束(见 board-discipline.ts / animation-discipline.test.ts),
    // 不影响既有用例按下标取 steps[0]。
    steps: [
      { id: 's1', title: '压强', col: 'c1', flow: [{ do: 'focus', target: 'c1' }, { say: '先看第一问。' }, { do: 'reveal', target: 'l2' }] },
      {
        id: 's0', title: '审题', col: 'c0',
        flow: [
          { say: '这道题围绕潜艇模型问压强与浮力两件事。', ref: 'k_problem' },
          { do: 'reveal', target: 'mark:0.48 kg' },
          { say: '题目给了注水前的质量,0.48 千克。', ref: 'mark:0.48 kg', emph: 'mark' },
          { do: 'reveal', target: 'analysis:given' },
          { do: 'reveal', target: 'analysis:hidden' },
          { say: '沉入水底说明模型完全浸没在水里。', ref: 'analysis:hidden', emph: 'circle' },
          { do: 'reveal', target: 'analysis:find' },
          { say: '第一问要求的是压强。', ref: 'analysis:find' },
          { do: 'reveal', target: 'analysis:ideas' },
          { say: '思路是压力除以受力面积。', ref: 'analysis:ideas' }
        ]
      }
    ],
    takeaways: {
      knowledge: ['水平面上【压力等于重力】'],
      pitfalls: ['面积单位别抄成【平方厘米】'],
      methods: ['先【列全已知量】再套公式'],
      variants: ['改问【漂浮时的浮力】']
    },
    ...patch
  }
}

const ctx = { problemText: PROBLEM, answerText: ANSWER, templates: ANIMATION_TEMPLATES }

describe('normalizeBoardScript · 合格剧本', () => {
  it('样例剧本零错误', () => {
    const r = normalizeBoardScript(makeScript(), ctx)
    expect(r.errors).toEqual([])
  })
})

describe('normalizeBoardScript · 引用闭合', () => {
  it('flow 的 reveal 指向不存在的卡/行 → 错误', () => {
    const s = makeScript()
    ;(s.steps as any[])[0].flow.push({ do: 'reveal', target: 'nope' })
    const r = normalizeBoardScript(s, ctx)
    expect(r.errors.some((e) => e.includes('nope'))).toBe(true)
  })
  it('卡片挂在不存在的列上 → 错误', () => {
    const s = makeScript()
    ;(s.cards as any[])[2].col = 'c9'
    expect(normalizeBoardScript(s, ctx).errors.some((e) => e.includes('c9'))).toBe(true)
  })
  it('step.col 不存在 → 错误', () => {
    const s = makeScript()
    ;(s.steps as any[])[0].col = 'c9'
    expect(normalizeBoardScript(s, ctx).errors.some((e) => e.includes('c9'))).toBe(true)
  })
  it('figure 卡指向不存在的 figureId → 错误', () => {
    const s = makeScript()
    ;(s.cards as any[]).push({ id: 'kf', col: 'c1', kind: 'figure', figureId: 'ghost' })
    expect(normalizeBoardScript(s, ctx).errors.some((e) => e.includes('ghost'))).toBe(true)
  })
  it('anim 动作指向不存在的动画 → 错误', () => {
    const s = makeScript()
    ;(s.steps as any[])[0].flow.push({ do: 'anim', target: 'a_ghost', action: { type: 'show', target: 'tank' } })
    expect(normalizeBoardScript(s, ctx).errors.some((e) => e.includes('a_ghost'))).toBe(true)
  })
  it('explore.animationId 不存在 → 错误', () => {
    const s = makeScript({ explore: { animationId: 'a_ghost', unlock: [], tasks: ['拖一拖'] } })
    expect(normalizeBoardScript(s, ctx).errors.some((e) => e.includes('a_ghost'))).toBe(true)
  })
  it('重复 id → 错误', () => {
    const s = makeScript()
    ;(s.cards as any[]).push({ id: 'k1', col: 'c1', kind: 'heading', text: '重复' })
    expect(normalizeBoardScript(s, ctx).errors.some((e) => e.includes('重复'))).toBe(true)
  })
})

describe('normalizeBoardScript · marks 必须是题干子串', () => {
  it('不是子串的 mark 被丢掉并告警', () => {
    const s = makeScript()
    ;(s.analysis as any).marks.push({ text: '这句题干里没有', kind: 'key' })
    const r = normalizeBoardScript(s, ctx)
    expect(r.script.analysis.marks).toHaveLength(1)
    expect(r.warnings.some((w) => w.includes('这句题干里没有'))).toBe(true)
  })
  it('kind 不合法的 mark 被丢掉', () => {
    const s = makeScript()
    ;(s.analysis as any).marks = [{ text: '0.48 kg', kind: '紫色' }]
    expect(normalizeBoardScript(s, ctx).script.analysis.marks).toHaveLength(0)
  })
})

describe('normalizeBoardScript · tex / speech 配对', () => {
  it('formula 行缺 tex → 错误', () => {
    const s = makeScript()
    ;(s.cards as any[])[2].lines[1] = { id: 'l2', kind: 'formula', speech: '压强等于 600 帕' }
    expect(normalizeBoardScript(s, ctx).errors.some((e) => e.includes('tex'))).toBe(true)
  })
  it('formula 行缺 speech → 由转换器兜底生成并告警', () => {
    const s = makeScript()
    delete (s.cards as any[])[2].lines[1].speech
    const r = normalizeBoardScript(s, ctx)
    const line = (r.script.cards[2] as any).lines[1]
    expect(line.speech).toContain('600 帕')
    expect(r.warnings.some((w) => w.includes('l2'))).toBe(true)
    expect(r.errors).toEqual([])
  })
  it('speech 里混进 LaTeX 记号 → 重新由 tex 生成并告警', () => {
    const s = makeScript()
    ;(s.cards as any[])[2].lines[1].speech = 'p 等于 \\frac{F}{S}'
    const r = normalizeBoardScript(s, ctx)
    const line = (r.script.cards[2] as any).lines[1]
    expect(line.speech).not.toMatch(/[\\{}^_$]/)
    expect(r.warnings.some((w) => w.includes('LaTeX'))).toBe(true)
  })
  it('speech 漏掉转换器算出的数字 → 告警(不打回)', () => {
    const s = makeScript()
    ;(s.cards as any[])[2].lines[1].speech = '压强就是这么算的'
    const r = normalizeBoardScript(s, ctx)
    expect(r.warnings.some((w) => w.includes('600'))).toBe(true)
    expect(r.errors).toEqual([])
  })
  it('speech 把希腊字母按拉丁转写念了 → 告警', () => {
    const s = makeScript()
    ;(s.cards as any[])[2].lines[1] = {
      id: 'l2', kind: 'formula',
      tex: 'F_{浮} = \\rho_{水} g V_{排}',
      speech: '浮力等于 rho 水乘 g 乘 V 排'
    }
    const r = normalizeBoardScript(s, ctx)
    expect(r.warnings.some((w) => w.includes('rho'))).toBe(true)
  })
  it('table 卡缺 speech → 错误', () => {
    const s = makeScript()
    ;(s.cards as any[]).push({ id: 'kt', col: 'c1', kind: 'table', markdown: '| a |\n|---|', speech: '' })
    expect(normalizeBoardScript(s, ctx).errors.some((e) => e.includes('kt'))).toBe(true)
  })
})

describe('normalizeBoardScript · say 纪律', () => {
  it('say 超过 120 字 → 错误', () => {
    const s = makeScript()
    ;(s.steps as any[])[0].flow[1] = { say: '压'.repeat(121) }
    expect(normalizeBoardScript(s, ctx).errors.some((e) => e.includes('120'))).toBe(true)
  })
  it('say 里的 LaTeX 记号被清掉并告警', () => {
    const s = makeScript()
    ;(s.steps as any[])[0].flow[1] = { say: '压强是 $p = \\frac{F}{S}$ 这么算的。' }
    const r = normalizeBoardScript(s, ctx)
    expect((r.script.steps[0].flow[1] as any).say).not.toMatch(/[\\{}$]/)
    expect(r.warnings.some((w) => w.includes('LaTeX'))).toBe(true)
  })
  it('一步都没有 say → 错误', () => {
    const s = makeScript()
    ;(s.steps as any[])[0].flow = [{ do: 'focus', target: 'c1' }]
    expect(normalizeBoardScript(s, ctx).errors.some((e) => e.includes('s1'))).toBe(true)
  })
})

describe('normalizeBoardScript · 配图规则', () => {
  it('scene 超过 2 张 → 多的被丢掉并告警', () => {
    const s = makeScript({
      figures: [
        { id: 'f1', kind: 'scene', prompt: '潜艇沉在水底', status: 'pending' },
        { id: 'f2', kind: 'scene', prompt: '桌面上的模型', status: 'pending' },
        { id: 'f3', kind: 'scene', prompt: '第三张', status: 'pending' }
      ]
    })
    const r = normalizeBoardScript(s, ctx)
    expect(r.script.figures.filter((f) => f.kind === 'scene')).toHaveLength(2)
    expect(r.warnings.some((w) => w.includes('f3'))).toBe(true)
  })
  it('几何 / 函数图的 scene 配图被拒(禁止生图)', () => {
    const s = makeScript({
      figures: [{ id: 'f1', kind: 'scene', prompt: '画一个圆,圆心 O,圆周角 ∠ACB = 40°', status: 'pending' }]
    })
    const r = normalizeBoardScript(s, ctx)
    expect(r.script.figures).toHaveLength(0)
    expect(r.warnings.some((w) => w.includes('几何'))).toBe(true)
  })
  it('被规则去掉的配图,连坐去掉引用它的卡和 flow 项,只记告警不打回', () => {
    const s = makeScript({
      figures: [{ id: 'f1', kind: 'scene', prompt: '画一个圆,圆心 O 与圆周角', status: 'pending' }]
    })
    ;(s.cards as any[]).push({ id: 'k1_fig', col: 'c1', kind: 'figure', figureId: 'f1' })
    ;(s.steps as any[])[0].flow.push({ do: 'reveal', target: 'k1_fig' })
    const r = normalizeBoardScript(s, ctx)
    expect(r.errors).toEqual([])
    expect(r.script.figures).toHaveLength(0)
    expect(r.script.cards.some((c) => c.id === 'k1_fig')).toBe(false)
    expect(r.script.steps[0].flow.some((f) => (f as any).target === 'k1_fig')).toBe(false)
    expect(r.warnings.filter((w) => w.includes('一起去掉')).length).toBe(2)
  })
  it('diagram 必须带 mermaid', () => {
    const s = makeScript({ figures: [{ id: 'f1', kind: 'diagram', status: 'pending' }] })
    expect(normalizeBoardScript(s, ctx).warnings.some((w) => w.includes('mermaid'))).toBe(true)
  })
})

describe('normalizeBoardScript · template 动画参数越界', () => {
  const withAnim = (params: Record<string, unknown>, action?: Record<string, unknown>) =>
    makeScript({
      animations: [{ id: 'a1', kind: 'template', purpose: '演示浮沉', template: 'buoyancy', params, status: 'pending' }],
      steps: [
        {
          id: 's1', title: '压强', col: 'c1',
          flow: [{ say: '看动画。' }, { do: 'anim', target: 'a1', action: action ?? { type: 'run', phase: 'towater' } }]
        }
      ]
    })

  it('参数超出 manifest 范围 → 夹到边界并告警', () => {
    const r = normalizeBoardScript(withAnim({ V: 99, m0: 0.48, S: 8, h: 0.2 }), ctx)
    expect((r.script.animations[0].params as any).V).toBe(10)
    expect(r.warnings.some((w) => w.includes('V'))).toBe(true)
  })
  it('模板没有的参数被丢掉', () => {
    const r = normalizeBoardScript(withAnim({ V: 6, zzz: 1 }), ctx)
    expect((r.script.animations[0].params as any).zzz).toBeUndefined()
    expect(r.warnings.some((w) => w.includes('zzz'))).toBe(true)
  })
  it('template id 不在六模板内 → 错误', () => {
    const s = makeScript({
      animations: [{ id: 'a1', kind: 'template', purpose: 'x', template: 'square-rotate', params: {}, status: 'pending' }],
      steps: [{ id: 's1', title: 'x', col: 'c1', flow: [{ say: '看动画。' }] }]
    })
    expect(normalizeBoardScript(s, ctx).errors.some((e) => e.includes('square-rotate'))).toBe(true)
  })
  it('anim 动作类型不在该模板 actions 里 → 错误', () => {
    const r = normalizeBoardScript(withAnim({ V: 6 }, { type: 'explode' }), ctx)
    expect(r.errors.some((e) => e.includes('explode'))).toBe(true)
  })
  it('run 的 phase 不在模板相位里 → 错误', () => {
    const r = normalizeBoardScript(withAnim({ V: 6 }, { type: 'run', phase: 'fly' }), ctx)
    expect(r.errors.some((e) => e.includes('fly'))).toBe(true)
  })
  // 一张动画只挂一张卡:2026-09-17 第二轮从「告警」改成「自动删重复卡」,细则见 animation-discipline.test.ts
  it('一张动画被两张卡引用 → 删掉后出现的那张', () => {
    const s = withAnim({ V: 6 })
    ;(s.cards as any[]).push(
      { id: 'ka1', col: 'c1', kind: 'animation', animationId: 'a1' },
      { id: 'ka2', col: 'c1', kind: 'animation', animationId: 'a1' }
    )
    const r = normalizeBoardScript(s, ctx)
    expect(r.script.cards.filter((c) => c.kind === 'animation').map((c) => c.id)).toEqual(['ka1'])
    expect(r.warnings.some((w) => w.startsWith('已自动修正') && w.includes('ka2'))).toBe(true)
  })
  it('html 动画:action 只接受 {type:do,name}', () => {
    const s = makeScript({
      animations: [{ id: 'a1', kind: 'html', purpose: '演示旋转', status: 'pending' }],
      steps: [{ id: 's1', title: 'x', col: 'c1', flow: [{ say: '看动画。' }, { do: 'anim', target: 'a1', action: { type: 'run', phase: 'rise' } }] }]
    })
    expect(normalizeBoardScript(s, ctx).errors.some((e) => e.includes('do'))).toBe(true)
  })
})

describe('normalizeBoardScript · 列结构与总结', () => {
  it('缺审题列 → 错误', () => {
    const s = makeScript()
    ;(s.columns as any[]).shift()
    ;(s.cards as any[]).splice(0, 2)
    expect(normalizeBoardScript(s, ctx).errors.some((e) => e.includes('审题'))).toBe(true)
  })
  it('缺总结列 → 错误', () => {
    const s = makeScript()
    ;(s.columns as any[]).pop()
    ;(s.cards as any[]).pop()
    expect(normalizeBoardScript(s, ctx).errors.some((e) => e.includes('总结'))).toBe(true)
  })
  it('takeaways 条目不是恰好一对【】 → 补/告警', () => {
    const s = makeScript()
    ;(s.takeaways as any).knowledge = ['没有重点词的一条', '有【两个】重点【词】的一条']
    const r = normalizeBoardScript(s, ctx)
    expect(r.warnings.filter((w) => w.includes('【】')).length).toBeGreaterThanOrEqual(2)
    for (const item of r.script.takeaways.knowledge) {
      expect((item.match(/【/g) ?? []).length).toBe(1)
    }
  })
})

describe('normalizeBoardScript · 数值与答案一致', () => {
  it('conclusion 行的数与答案不符 → 标注「与答案不符,请核对」', () => {
    const s = makeScript()
    ;(s.cards as any[])[2].lines[2] = { id: 'l3', kind: 'conclusion', text: 'p = 750 Pa' }
    const r = normalizeBoardScript(s, ctx)
    const line = (r.script.cards[2] as any).lines[2]
    expect(line.text).toContain('与答案不符,请核对')
    expect(r.warnings.some((w) => w.includes('750'))).toBe(true)
  })
  it('与答案一致时不加标注', () => {
    const r = normalizeBoardScript(makeScript(), ctx)
    expect((r.script.cards[2] as any).lines[2].text).not.toContain('与答案不符')
  })
})

describe('extractJson', () => {
  it('容忍代码围栏与前后废话', () => {
    expect(extractJson('好的:\n```json\n{"a":1}\n```\n以上')).toEqual({ a: 1 })
  })
  it('没有 JSON 就抛错', () => {
    expect(() => extractJson('我不会')).toThrow()
  })
})
