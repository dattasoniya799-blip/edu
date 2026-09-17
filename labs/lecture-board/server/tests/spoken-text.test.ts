import { describe, expect, it } from 'vitest'
import { normalizeSpokenText } from '../src/spoken-text'

/**
 * 口播文本的机械修正(ISSUES W1 / 硬约束 6):
 * 只做两类**不会破坏措辞**的替换 —— 希腊字母拉丁转写 → 中文读法;中文数字 → 阿拉伯数字。
 * 其余措辞问题一律不碰(自动改写会把模型写得更好的句子一起冲掉)。
 */
const t = (s: string): string => normalizeSpokenText(s).text

describe('normalizeSpokenText · 希腊字母', () => {
  it('rho 跟着水/液/物时读成「…的密度」', () => {
    expect(t('浮力等于 rho 水乘 g 乘 V 排')).toBe('浮力等于水的密度乘 g 乘 V 排')
    expect(t('rho液 比 rho物 大')).toBe('液的密度比物的密度大')
  })
  it('单独的 rho 读成「密度」', () => {
    expect(t('这里的 rho 是密度符号')).toBe('这里的密度是密度符号')
  })
  it('alpha / beta / theta / gamma / pi / Delta', () => {
    expect(t('余弦 alpha 等于 5 分之 3')).toBe('余弦阿尔法等于 5 分之 3')
    expect(t('角 beta 加角 gamma')).toBe('角贝塔加角伽马')
    expect(t('theta 从 0 变到 90 度')).toBe('西塔从 0 变到 90 度')
    expect(t('圆周率 pi 取 3.14')).toBe('圆周率派取 3.14')
    expect(t('判别式 Delta 大于 0')).toBe('判别式德尔塔大于 0')
  })
  it('大小写都认,汉字之间的空格收掉', () => {
    expect(t('正弦 Alpha 等于 5 分之 4')).toBe('正弦阿尔法等于 5 分之 4')
  })
  it('不误伤正常中文与英文字母变量', () => {
    expect(t('角 ABC 等于 65 度')).toBe('角 ABC 等于 65 度')
    expect(t('压强等于 600 帕')).toBe('压强等于 600 帕')
  })
  it('报告替换了什么', () => {
    const r = normalizeSpokenText('余弦 alpha 等于 3')
    expect(r.fixes.some((f) => f.includes('alpha'))).toBe(true)
  })
})

describe('normalizeSpokenText · 中文数字 → 阿拉伯数字', () => {
  it('数字 + 单位', () => {
    expect(t('四十度减十五度,得二十五度')).toBe('40 度减 15 度,得 25 度')
    expect(t('九十度减 x')).toBe('90 度减 x')
    expect(t('一百二十度')).toBe('120 度')
    expect(t('六牛乘零点二米等于一点二焦')).toBe('6 牛乘 0.2 米等于 1.2 焦')
  })
  it('倍数、比、分之', () => {
    expect(t('二倍角 CAB')).toBe('2 倍角 CAB')
    expect(t('五分之四')).toBe('5 分之 4')
    expect(t('十分之三')).toBe('10 分之 3')
    expect(t('面积比是四比三')).toBe('面积比是 4 比 3')
  })
  it('百分之不能拆成「100 分之」', () => {
    expect(t('浓度是百分之八十')).toBe('浓度是百分之 80')
  })
  it('自带数词的单位不能拆:千克 ≠ 1000 克(浮力题实测)', () => {
    expect(t('质量 0.48 千克')).toBe('质量 0.48 千克')
    expect(t('三千克的物体')).toBe('3 千克的物体')
    expect(t('跑了五千米')).toBe('跑了 5 千米')
    expect(t('功率是两千瓦')).toBe('功率是 2 千瓦')
  })
  it('带「十」的还是数字 + 单位(十分钟 = 10 分钟)', () => {
    expect(t('用了十分钟')).toBe('用了 10 分钟')
  })
  it('不碰数词以外的中文(三角形 / 四边形 / 一次函数)', () => {
    expect(t('三角形 ABE 全等于三角形 ADF')).toBe('三角形 ABE 全等于三角形 ADF')
    expect(t('这是一个平行四边形')).toBe('这是一个平行四边形')
    expect(t('一次函数的图象是直线')).toBe('一次函数的图象是直线')
    expect(t('用二次根式化简')).toBe('用二次根式化简')
  })
  it('序数词「第一问」「第二步」不动', () => {
    expect(t('先看第一问')).toBe('先看第一问')
    expect(t('第二步代入公式')).toBe('第二步代入公式')
    expect(t('这是第三次尝试')).toBe('这是第三次尝试')
  })
  it('报告替换了什么', () => {
    const r = normalizeSpokenText('四十度')
    expect(r.fixes.some((f) => f.includes('40'))).toBe(true)
  })
})

describe('normalizeSpokenText · 成语/惯用语白名单(不该被数字化)', () => {
  it('「百分之百」保持原样,不拆成「百分之 100」', () => {
    expect(t('浓度是百分之百')).toBe('浓度是百分之百')
    expect(t('百分之百确定')).toBe('百分之百确定')
    expect(t('溶液浓度提高了百分之百')).toBe('溶液浓度提高了百分之百')
  })
  it('「百分之」后面接别的数还是要转(不能因为白名单误伤正常用法)', () => {
    expect(t('浓度是百分之八十')).toBe('浓度是百分之 80')
  })
  it('一半 / 一样 / 一下 / 一些 不被当成「一 + 量词」拆开', () => {
    expect(t('注水量占了一半')).toBe('注水量占了一半')
    expect(t('两三角形一样大')).toBe('两三角形一样大')
    expect(t('等一下再看')).toBe('等一下再看')
    expect(t('取一些数据')).toBe('取一些数据')
  })
  it('二次函数 / 一次函数 / 一元二次 不被拆开', () => {
    expect(t('二次函数的图象')).toBe('二次函数的图象')
    expect(t('一次函数的图象是直线')).toBe('一次函数的图象是直线')
    expect(t('一元二次方程')).toBe('一元二次方程')
  })
  it('三角形 / 四边形 / 平行四边形 不被拆开(白名单兜底,不只靠排除量词)', () => {
    expect(t('三角形 ABE 全等于三角形 ADF')).toBe('三角形 ABE 全等于三角形 ADF')
    expect(t('这是一个平行四边形')).toBe('这是一个平行四边形')
  })
  it('跑两遍结果一样(幂等)', () => {
    const once = t('浓度是百分之百,注水量占了一半')
    expect(t(once)).toBe(once)
  })
})

describe('normalizeSpokenText · 幂等与边界', () => {
  it('已经规范的文本不变,也不报修正', () => {
    const s = '压强等于受力面积分之压力,等于 600 帕'
    const r = normalizeSpokenText(s)
    expect(r.text).toBe(s)
    expect(r.fixes).toEqual([])
  })
  it('跑两遍结果一样', () => {
    const once = t('余弦 alpha 等于四十度')
    expect(t(once)).toBe(once)
  })
  it('空输入', () => {
    expect(t('')).toBe('')
    expect(normalizeSpokenText(undefined as unknown as string).text).toBe('')
  })
})
