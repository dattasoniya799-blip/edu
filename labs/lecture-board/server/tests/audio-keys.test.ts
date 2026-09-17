import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { audioFileName, collectUtterances } from '../src/audio-keys'
import { normalizeBoardScript } from '../src/validate'
import type { BoardScript } from '../../shared/schema'

const SAMPLE = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../shared/sample-buoyancy.json', import.meta.url)), 'utf8')
) as BoardScript

describe('collectUtterances · 音频 key 与口播文本', () => {
  const list = collectUtterances(SAMPLE)
  const byKey = new Map(list.map((u) => [u.key, u.text]))

  it('flow 的 say 按 flow 数组下标编 key(不是 say 的序号)', () => {
    // s1 的 flow:0=focus,1=say,2..4=reveal,5=say
    expect(byKey.get('steps.s1.flow.1')).toBe('先看第(1)问。注水前模型放在水平桌面上,对桌面的压力就等于它的重力。')
    expect(byKey.get('steps.s1.flow.5')).toBe('压力 4.8 牛,受力面积是题目给的 8 乘 10 的负 3 次方平方米,套压强公式。')
    expect(byKey.has('steps.s1.flow.0')).toBe(false)
    expect(byKey.has('steps.s1.flow.2')).toBe(false)
  })

  it('formula 行的 speech 走 cards.<cardId>.lines.<lineId>', () => {
    expect(byKey.get('cards.k1_board.lines.l1b')).toContain('压力等于重力')
    expect(byKey.has('cards.k1_board.lines.l1a')).toBe(false) // text 行没有 speech
    expect(byKey.has('cards.k1_board.lines.l1d')).toBe(false) // conclusion 行没有 speech
  })

  it('table 卡的 speech 走 cards.<cardId>.speech', () => {
    expect(byKey.get('cards.k2_table.speech')).toContain('浮沉看重力和浮力谁大')
  })

  it('takeaways 去【】,每组首条加组名', () => {
    expect(byKey.get('takeaways.knowledge.0')).toBe('核心知识点。固体压强 p=F/S,水平面上压力等于重力')
    expect(byKey.get('takeaways.knowledge.1')).toBe('浸没时V排等于V,F浮=ρ液gV排')
    expect(byKey.get('takeaways.pitfalls.0')).toBe('考点与易错。面积单位10⁻³ m²别抄成 cm²')
    expect(byKey.get('takeaways.methods.0')).toBe('方法与技巧。三问共用一组数据,先把已知量列全再逐问套公式')
    expect(byKey.get('takeaways.variants.0')).toContain('举一反三。')
  })

  it('key 不重复,且顺序是 steps → cards → takeaways', () => {
    const keys = list.map((u) => u.key)
    expect(new Set(keys).size).toBe(keys.length)
    const firstCard = keys.findIndex((k) => k.startsWith('cards.'))
    const firstTake = keys.findIndex((k) => k.startsWith('takeaways.'))
    expect(keys.findIndex((k) => k.startsWith('steps.'))).toBeLessThan(firstCard)
    expect(firstCard).toBeLessThan(firstTake)
  })

  it('空剧本不炸', () => {
    expect(collectUtterances({ steps: [], cards: [], takeaways: {} } as unknown as BoardScript)).toEqual([])
  })
})

describe('audioFileName · key 里的点原样保留', () => {
  it('直接用 key 当文件名', () => {
    expect(audioFileName('steps.s1.flow.1')).toBe('steps.s1.flow.1.mp3')
    expect(audioFileName('cards.k1_board.lines.l1b')).toBe('cards.k1_board.lines.l1b.mp3')
  })
  it('路径分隔符与非法字符被换掉(不让 key 逃出 audio 目录)', () => {
    expect(audioFileName('steps../../etc/passwd')).not.toContain('/')
    expect(audioFileName('a\\b')).not.toContain('\\')
  })
})

describe('手写样例剧本本身要过校验', () => {
  it('sample-buoyancy.json 零错误', () => {
    const r = normalizeBoardScript(SAMPLE, { problemText: SAMPLE.problem.text, answerText: SAMPLE.problem.answer })
    expect(r.errors).toEqual([])
  })
})
