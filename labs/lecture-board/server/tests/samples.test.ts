import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  answerPreview,
  guessSubject,
  listSamples,
  loadSampleInput,
  resolveSampleDir,
  sampleTitle,
  SAMPLES_ROOT
} from '../src/samples'

describe('sampleTitle', () => {
  it('去掉数字序号前缀', () => {
    expect(sampleTitle('01-圆与圆周角')).toBe('圆与圆周角')
    expect(sampleTitle('04-泸州-进价下降率')).toBe('泸州-进价下降率')
  })

  it('没有前缀也不炸', () => {
    expect(sampleTitle('圆与圆周角')).toBe('圆与圆周角')
  })
})

describe('guessSubject', () => {
  it('物理关键词 → physics', () => {
    expect(guessSubject('遥控潜艇模型的浮沉,求压强与浮力')).toBe('physics')
    expect(guessSubject('滑轮组机械效率与功率')).toBe('physics')
    expect(guessSubject('并联电路,电流表串在支路')).toBe('physics')
  })

  it('化学关键词 → chemistry', () => {
    expect(guessSubject('溶液的 pH 与化学方程式')).toBe('chemistry')
  })

  it('没有关键词命中 → 默认 math', () => {
    expect(guessSubject('圆与圆周角')).toBe('math')
    expect(guessSubject('一元二次方程应用:进价下降率')).toBe('math')
  })

  it('化学关键词优先于物理关键词(两者都出现时)', () => {
    expect(guessSubject('化学反应中的电流与化合价')).toBe('chemistry')
  })
})

describe('answerPreview', () => {
  it('跳过标题行和引用行,取第一条结论', () => {
    const md = ['# 答案(遥控潜艇模型的浮沉 · 7 分)', '', '> 来源:讲解件案例', '', '(1)注水前模型对水平桌面的压强:p = 600 Pa。', '(2)浮力 6 N。'].join(
      '\n'
    )
    expect(answerPreview(md)).toBe('(1)注水前模型对水平桌面的压强:p = 600 Pa。')
  })

  it('超长截断并加省略号', () => {
    const long = 'x'.repeat(80)
    const out = answerPreview(long, 20)
    expect(out.length).toBe(21)
    expect(out.endsWith('…')).toBe(true)
  })

  it('空文档给空串', () => {
    expect(answerPreview('')).toBe('')
    expect(answerPreview('# 只有标题\n\n> 只有引用')).toBe('')
  })
})

// 下面两个测「扫真实 ../题目/ 目录」——仓库里这个目录一直都在,不 mock 文件系统更贴近真实场景。
describe('listSamples(真实 题目/ 目录)', () => {
  it('SAMPLES_ROOT 存在', () => {
    expect(existsSync(SAMPLES_ROOT)).toBe(true)
  })

  it('扫出 7 道题,每道都有 dir/title/subject/imageUrl/answerPreview', async () => {
    const samples = await listSamples()
    expect(samples.length).toBe(7)
    for (const s of samples) {
      expect(s.dir).toMatch(/^\d+-/)
      expect(s.title.length).toBeGreaterThan(0)
      expect(['math', 'physics', 'chemistry']).toContain(s.subject)
      expect(s.imageUrl).toMatch(new RegExp(`^/samples/${s.dir}/题目\\.(png|jpg|jpeg|webp)$`))
      expect(s.answerPreview.length).toBeGreaterThan(0)
    }
  })

  it('浮力潜艇那道识别成 physics,圆与圆周角识别成 math', async () => {
    const samples = await listSamples()
    const buoyancy = samples.find((s) => s.dir.includes('浮力潜艇'))
    const circle = samples.find((s) => s.dir.includes('圆与圆周角'))
    expect(buoyancy?.subject).toBe('physics')
    expect(circle?.subject).toBe('math')
  })

  it('按目录名(序号)排序', async () => {
    const samples = await listSamples()
    const dirs = samples.map((s) => s.dir)
    expect(dirs).toEqual([...dirs].sort())
  })
})

describe('loadSampleInput(真实 题目/ 目录)', () => {
  it('浮力潜艇:找得到图 + 答案全文', async () => {
    const input = await loadSampleInput('03-浮力潜艇')
    expect(input).toBeDefined()
    expect(input?.imageExt).toBe('jpg')
    expect(input?.imagePath.endsWith('题目.jpg')).toBe(true)
    expect(input?.answerText).toContain('600 Pa')
  })

  it('不存在的文件夹返回 undefined', async () => {
    expect(await loadSampleInput('99-不存在')).toBeUndefined()
  })
})

// 运行问题复查(2026-09-17)· 安全:POST /api/lessons/from-sample/:dir 的 dir 必须白名单校验,
// 不能靠 join() 隐式拼出去的路径逃出 题目/ 目录(实测 `../../../server/src` 能拼到仓库别的目录)。
describe('resolveSampleDir · 路径穿越防护', () => {
  it('合法目录名 → 解析成 SAMPLES_ROOT 下的绝对路径', () => {
    const full = resolveSampleDir('03-浮力潜艇')
    expect(full).toBeDefined()
    expect(full).toContain(SAMPLES_ROOT)
  })
  it('.. 逃出 SAMPLES_ROOT → undefined', () => {
    expect(resolveSampleDir('../../../server/src')).toBeUndefined()
    expect(resolveSampleDir('..')).toBeUndefined()
  })
  it('带路径分隔符(编码后的 / 或 \\)→ undefined', () => {
    expect(resolveSampleDir('03-浮力潜艇/../../server')).toBeUndefined()
    expect(resolveSampleDir('a/b')).toBeUndefined()
    expect(resolveSampleDir('a\\b')).toBeUndefined()
  })
  it('不存在的目录名 → undefined(即使名字本身合法)', () => {
    expect(resolveSampleDir('99-不存在')).toBeUndefined()
  })
  it('空字符串 / . → undefined', () => {
    expect(resolveSampleDir('')).toBeUndefined()
    expect(resolveSampleDir('.')).toBeUndefined()
  })
  it('loadSampleInput 对同样的穿越 payload 也拿不到东西(端到端)', async () => {
    expect(await loadSampleInput('../../../server/src')).toBeUndefined()
    expect(await loadSampleInput('..%2f..%2fserver')).toBeUndefined()
  })
})
