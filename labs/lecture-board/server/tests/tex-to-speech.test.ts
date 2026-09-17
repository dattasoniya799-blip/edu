import { describe, expect, it } from 'vitest'
import { texHasLatexMarkup, texToSpeech, speechMissingNumbers } from '../src/tex-to-speech'

/**
 * 确定性 LaTeX → 中文口语。用途有二:LLM 漏写 speech 时兜底生成;作为参照校验 LLM 版 speech。
 * 断言的是「念出来对不对」,不是字符串美观 —— 改实现时以这些句子为准。
 */
describe('texToSpeech · 分式与根号', () => {
  it('\\frac{a}{b} 念成「b 分之 a」', () => {
    expect(texToSpeech('\\frac{a}{b}')).toBe('b 分之 a')
  })
  it('分式里可以套数字与单位', () => {
    expect(texToSpeech('p = \\frac{F}{S}')).toBe('p 等于 S 分之 F')
  })
  it('\\dfrac 与 \\tfrac 同 \\frac', () => {
    expect(texToSpeech('\\dfrac{1}{2}')).toBe('2 分之 1')
    expect(texToSpeech('\\tfrac{3}{4}')).toBe('4 分之 3')
  })
  it('\\sqrt{x} 念「根号 x」', () => {
    expect(texToSpeech('\\sqrt{2}')).toBe('根号 2')
  })
  it('\\sqrt[3]{x} 念「3 次根号 x」', () => {
    expect(texToSpeech('\\sqrt[3]{8}')).toBe('3 次根号 8')
  })
})

describe('texToSpeech · 上标与下标', () => {
  it('^2 念「的平方」', () => {
    expect(texToSpeech('x^2')).toBe('x 的平方')
  })
  it('^3 念「的立方」', () => {
    expect(texToSpeech('a^3')).toBe('a 的立方')
  })
  it('^{-4} 念「的负 4 次方」', () => {
    expect(texToSpeech('10^{-4}')).toBe('10 的负 4 次方')
  })
  it('^{n} 念「的 n 次方」', () => {
    expect(texToSpeech('2^{10}')).toBe('2 的 10 次方')
  })
  it('中文下标按「谁的什么」念', () => {
    expect(texToSpeech('\\rho_{水}')).toBe('水的密度')
    expect(texToSpeech('V_{排}')).toBe('排开液体的体积')
    expect(texToSpeech('F_{浮}')).toBe('浮力')
  })
  it('未登记的中文下标退化成「X 的 Y」语序', () => {
    expect(texToSpeech('T_{甲}')).toBe('甲的 T')
  })
  it('下标写成 \\text{水} 也认(模型两种写法都出)', () => {
    expect(texToSpeech('\\rho_{\\text{水}}')).toBe('水的密度')
    expect(texToSpeech('F_{\\text{浮}} = \\rho_{\\text{水}} g V_{\\text{排}}')).toBe('浮力等于水的密度 g 排开液体的体积')
  })
  it('数字下标直接连读', () => {
    expect(texToSpeech('F_1')).toBe('F 1')
    expect(texToSpeech('v_{0}')).toBe('v 0')
  })
})

describe('texToSpeech · 几何与关系符号', () => {
  it('\\angle 念「角」', () => {
    expect(texToSpeech('\\angle ABC = 65^\\circ')).toBe('角 ABC 等于 65 度')
  })
  it('\\triangle 念「三角形」', () => {
    expect(texToSpeech('\\triangle ABC')).toBe('三角形 ABC')
  })
  it('\\perp 念「垂直于」', () => {
    expect(texToSpeech('OB \\perp BE')).toBe('OB 垂直于 BE')
  })
  it('\\parallel 念「平行于」', () => {
    expect(texToSpeech('AB \\parallel CD')).toBe('AB 平行于 CD')
  })
  it('\\cong 念「全等于」,\\sim 念「相似于」', () => {
    expect(texToSpeech('\\triangle ABE \\cong \\triangle ADF')).toBe('三角形 ABE 全等于三角形 ADF')
    expect(texToSpeech('\\triangle NAE \\sim \\triangle NDF')).toBe('三角形 NAE 相似于三角形 NDF')
  })
  it('\\le / \\ge / \\ne / \\approx', () => {
    expect(texToSpeech('x \\le 3')).toBe('x 小于等于 3')
    expect(texToSpeech('x \\ge 3')).toBe('x 大于等于 3')
    expect(texToSpeech('a \\ne b')).toBe('a 不等于 b')
    expect(texToSpeech('\\pi \\approx 3.14')).toBe('派约等于 3.14')
  })
  it('\\times / \\div / \\cdot / \\pm', () => {
    expect(texToSpeech('6 \\times 0.2')).toBe('6 乘 0.2')
    expect(texToSpeech('8 \\div 2')).toBe('8 除以 2')
    expect(texToSpeech('F \\cdot h')).toBe('F 乘 h')
    expect(texToSpeech('\\pm 3')).toBe('正负 3')
  })
  it('希腊字母:\\pi \\Delta \\rho \\alpha \\theta', () => {
    expect(texToSpeech('\\Delta = b^2 - 4ac')).toBe('德尔塔等于 b 的平方减 4ac')
    expect(texToSpeech('\\alpha + \\theta')).toBe('阿尔法加西塔')
    expect(texToSpeech('\\rho V')).toBe('密度 V')
  })
  it('\\therefore / \\because / \\rightarrow', () => {
    expect(texToSpeech('\\because a = b \\therefore b = a')).toBe('因为 a 等于 b 所以 b 等于 a')
    expect(texToSpeech('A \\rightarrow B')).toBe('A 推出 B')
  })
})

describe('texToSpeech · 单位(\\text 按 speak-text 的单位读法)', () => {
  it('简单单位', () => {
    expect(texToSpeech('600\\,\\text{Pa}')).toBe('600 帕')
    expect(texToSpeech('6\\,\\text{N}')).toBe('6 牛')
    expect(texToSpeech('1.2\\,\\text{J}')).toBe('1.2 焦')
    expect(texToSpeech('0.2\\,\\text{m}')).toBe('0.2 米')
  })
  it('复合单位带斜杠', () => {
    expect(texToSpeech('10\\,\\text{N/kg}')).toBe('10 牛每千克')
    expect(texToSpeech('5\\,\\text{m/s}')).toBe('5 米每秒')
  })
  it('单位带指数:平方米 / 立方米 / 千克每立方米', () => {
    expect(texToSpeech('8\\times10^{-3}\\,\\text{m}^2')).toBe('8 乘 10 的负 3 次方平方米')
    expect(texToSpeech('6\\times10^{-4}\\,\\text{m}^3')).toBe('6 乘 10 的负 4 次方立方米')
    expect(texToSpeech('1.0\\times10^{3}\\,\\text{kg/m}^3')).toBe('1.0 乘 10 的 3 次方千克每立方米')
  })
  it('角度记号 ^\\circ 念「度」', () => {
    expect(texToSpeech('45^\\circ')).toBe('45 度')
  })
})

describe('texToSpeech · 整行公式(取自样例剧本)', () => {
  it('压力等于重力那行', () => {
    expect(texToSpeech('F = G = mg = 0.48\\,\\text{kg} \\times 10\\,\\text{N/kg} = 4.8\\,\\text{N}')).toBe(
      'F 等于 G 等于 mg 等于 0.48 千克乘 10 牛每千克等于 4.8 牛'
    )
  })
  it('压强那行', () => {
    expect(texToSpeech('p = \\frac{F}{S} = \\frac{4.8\\,\\text{N}}{8\\times10^{-3}\\,\\text{m}^2} = 600\\,\\text{Pa}')).toBe(
      'p 等于 S 分之 F 等于 8 乘 10 的负 3 次方平方米分之 4.8 牛等于 600 帕'
    )
  })
  it('浮力那行', () => {
    expect(texToSpeech('F_{浮} = \\rho_{水} g V_{排}')).toBe('浮力等于水的密度 g 排开液体的体积')
  })
  it('做功那行', () => {
    expect(texToSpeech('W = F_{浮} h = 6\\,\\text{N} \\times 0.2\\,\\text{m} = 1.2\\,\\text{J}')).toBe(
      'W 等于浮力 h 等于 6 牛乘 0.2 米等于 1.2 焦'
    )
  })
  it('面积比那行', () => {
    expect(texToSpeech('S_{\\triangle AEM} : S_{\\triangle AFM} = 4 : 3')).toBe('三角形 AEM 的 S 比三角形 AFM 的 S 等于 4 比 3')
  })
})

describe('texToSpeech · 兜底与清理', () => {
  it('去掉 \\left \\right 与间距宏', () => {
    expect(texToSpeech('\\left( a + b \\right)\\quad c')).toBe('( a 加 b ) c')
  })
  it('未知宏被丢弃而不是念出反斜杠', () => {
    expect(texToSpeech('\\foobar x')).toBe('x')
  })
  it('$ 定界符与多余空白被清掉', () => {
    expect(texToSpeech('$$  x = 1  $$')).toBe('x 等于 1')
  })
  it('空输入回空串', () => {
    expect(texToSpeech('')).toBe('')
    expect(texToSpeech('   ')).toBe('')
  })
  it('输出里不残留任何 LaTeX 记号', () => {
    const out = texToSpeech('\\frac{\\rho_{水} g V_{排}}{2} \\le \\sqrt{x^2 + y^2}')
    expect(texHasLatexMarkup(out)).toBe(false)
  })
})

describe('texHasLatexMarkup', () => {
  it('抓反斜杠、花括号、^、_、$', () => {
    expect(texHasLatexMarkup('\\frac{1}{2}')).toBe(true)
    expect(texHasLatexMarkup('x^2')).toBe(true)
    expect(texHasLatexMarkup('F_浮')).toBe(true)
    expect(texHasLatexMarkup('{a}')).toBe(true)
    expect(texHasLatexMarkup('$x$')).toBe(true)
  })
  it('干净的中文口语不算', () => {
    expect(texHasLatexMarkup('浮力等于水的密度乘 g 乘排开液体的体积')).toBe(false)
    expect(texHasLatexMarkup('压强等于 600 帕')).toBe(false)
  })
})

describe('speechMissingNumbers · 用转换结果校验 LLM 版 speech', () => {
  it('LLM speech 漏掉了参照里的数字 → 报出来', () => {
    const missing = speechMissingNumbers('p 等于 S 分之 F 等于 600 帕', 'p 等于 S 分之 F 等于 4.8 牛除以 8 乘 10 的负 3 次方平方米等于 600 帕')
    expect(missing).toContain('4.8')
    expect(missing).toContain('8')
  })
  it('老师念中文数字也算数(四十度 == 40°)', () => {
    expect(speechMissingNumbers('角 O C B 等于四十度减十五度,得二十五度', '角 OCB 等于 40 度减 15 度等于 25 度')).toEqual([])
    expect(speechMissingNumbers('九十度减 x', '90 度减 x')).toEqual([])
    expect(speechMissingNumbers('二倍角 CAB', '2 角 CAB')).toEqual([])
  })
  it('数字齐了就没有告警', () => {
    expect(speechMissingNumbers('功等于 6 牛乘 0.2 米等于 1.2 焦', 'W 等于浮力 h 等于 6 牛乘 0.2 米等于 1.2 焦')).toEqual([])
  })
})
