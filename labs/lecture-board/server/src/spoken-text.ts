/**
 * 口播文本的**机械**修正(2026-09-17 第二轮:web 侧反馈 + 硬约束 6)。
 *
 * 只做两类改不坏措辞的替换,其余措辞问题一律只告警:
 *  1. 希腊字母的拉丁转写 → 中文读法(`rho 水` → 「水的密度」、`alpha` → 「阿尔法」);
 *     TTS 念 "alpha" 会拼英文单词,课堂上必须是中文。
 *  2. 中文数字 → 阿拉伯数字(「四十度」→「40 度」),只在**后面紧跟单位/量词**时才换,
 *     所以「三角形」「一次函数」「平行四边形」「第一问」都不会被误伤。
 *
 * 顺带把「汉字之间的多余空格」收掉、「汉字与数字之间」补上一个空格 —— 与 tex-to-speech 的排版口径一致。
 */

/** 希腊字母:先处理「rho + 中文物质名」这种合成读法,再处理裸字母 */
const GREEK_COMPOUND: Array<[RegExp, string]> = [[/\brho\s*([水液物体])/gi, '$1的密度']]

const GREEK_WORDS: Record<string, string> = {
  rho: '密度',
  alpha: '阿尔法',
  beta: '贝塔',
  gamma: '伽马',
  delta: '德尔塔',
  epsilon: '艾普西龙',
  zeta: '泽塔',
  eta: '伊塔',
  theta: '西塔',
  lambda: '兰姆达',
  mu: '缪',
  xi: '克西',
  pi: '派',
  sigma: '西格玛',
  tau: '陶',
  phi: '斐',
  omega: '欧米伽'
}

/** 中文数字(含「点」小数),如 四十五 / 零点二 / 一百二十 */
const CN_NUMBER = '[〇零一二两三四五六七八九十百千]+(?:点[〇零一二三四五六七八九]+)?'

/**
 * 判定「这串中文数字真的是个数」的量词/单位。长的排前面,否则「厘米」会先被「米」吃掉。
 * 故意**不**收「角」「边」「次」「个」「步」「问」—— 收了就会把三角形、一次函数、第一问改坏。
 */
const NUM_UNITS = [
  '平方米', '立方米', '平方厘米', '立方厘米',
  '牛顿', '帕斯卡', '焦耳', '瓦特', '厘米', '毫米', '千米', '千克', '毫克', '分钟', '小时', '毫升', '安培', '伏特', '欧姆', '摩尔',
  '度', '牛', '帕', '焦', '瓦', '米', '克', '吨', '秒', '升', '安', '伏', '倍', '比', '分之'
].join('|')

const CN_DIGITS: Record<string, number> = { 〇: 0, 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }
const CN_UNITS: Record<string, number> = { 十: 10, 百: 100, 千: 1000 }

/** 「四十五」→ 45,「零点二」→ 0.2;认不出返回 null */
export function chineseNumeral(text: string): number | null {
  const [intPart, decPart] = text.split('点')
  let total = 0
  let current = 0
  let seen = false
  for (const ch of intPart) {
    if (ch in CN_DIGITS) {
      current = CN_DIGITS[ch]
      seen = true
    } else if (ch in CN_UNITS) {
      total += (current || 1) * CN_UNITS[ch]
      current = 0
      seen = true
    } else return null
  }
  if (!seen) return null
  total += current
  if (decPart == null) return total
  let decimals = ''
  for (const ch of decPart) {
    if (!(ch in CN_DIGITS)) return null
    decimals += String(CN_DIGITS[ch])
  }
  return decimals ? Number(`${total}.${decimals}`) : total
}

/** 「百分之」要整体保护:拆成「100 分之」就把 80% 念成百分之一了 */
const PERCENT_HOLDER = '\uE010'

/**
 * 成语 / 惯用语白名单:这些词里的字看起来像「中文数字 + 量词」,但整体是固定说法,不该被拆开数字化
 * (2026-09-17 实测:「百分之百」被当成「百分之」+「百」这个数,改成了「百分之 100」——「百」在这里
 * 是「百分之百」的一部分,不是「百分之」后面接的那个数)。
 * NUM_UNITS 的设计已经故意不收「角/边/次/样/下/些」等量词,躲开了「三角形」「一次函数」这类误伤;
 * 这里额外显式保护一批常见惯用语,双重兜底,也覆盖「百分之百」这种单靠排除量词躲不掉的个例。
 */
const IDIOM_WHITELIST = [
  '百分之百',
  '一半',
  '一样',
  '一下',
  '一些',
  '二次函数',
  '一次函数',
  '一元二次',
  '三角形',
  '四边形',
  '五边形',
  '六边形',
  '八边形',
  '多边形'
]
const IDIOM_HOLDER = (i: number): string => `\uE030${i}\uE031`

/**
 * 本身就带「千 / 百」的单位。不保护的话「千克」会被读成数字 1000 + 单位「克」
 * (2026-09-17 浮力题实测:旁白「0.48 千克」被改成「0.48 1000 克」)。
 * 故意不收带「十」的:「十分钟」「十秒」真的是数字 + 单位。
 */
const COMPOUND_UNITS = ['千克', '千米', '千帕', '千焦', '千瓦', '千伏', '千安', '千欧', '千升', '千赫', '百帕']
const UNIT_HOLDER = (i: number): string => `\uE020${i}\uE021`

export interface SpokenTextResult {
  text: string
  /** 改了什么,给校验报告用;没改就是空数组 */
  fixes: string[]
}

export function normalizeSpokenText(input: string): SpokenTextResult {
  const original = String(input ?? '')
  if (!original.trim()) return { text: original.trim(), fixes: [] }
  const fixes: string[] = []
  let s = original

  // ---- 0. 成语 / 惯用语先保护起来,后面的数字化一律看不到它们 ----
  // 按长度降序,避免短词(如「一半」)先吃掉长词里的字符
  const idiomOrder = IDIOM_WHITELIST.map((idiom, i) => ({ idiom, i })).sort((a, b) => b.idiom.length - a.idiom.length)
  for (const { idiom, i } of idiomOrder) s = s.split(idiom).join(IDIOM_HOLDER(i))

  // ---- 1. 希腊字母 ----
  for (const [re, out] of GREEK_COMPOUND) {
    s = s.replace(re, (m, who: string) => {
      fixes.push(`希腊字母拉丁转写「${m.trim()}」→「${who}的密度」`)
      return out.replace('$1', who)
    })
  }
  const greekRe = new RegExp(`\\b(${Object.keys(GREEK_WORDS).join('|')})\\b`, 'gi')
  s = s.replace(greekRe, (m) => {
    const out = GREEK_WORDS[m.toLowerCase()]
    fixes.push(`希腊字母拉丁转写「${m}」→「${out}」`)
    return out
  })

  // ---- 2. 中文数字 ----
  // 先把「千克」这种自带数词的单位换成占位符,再让占位符本身充当单位参与匹配
  COMPOUND_UNITS.forEach((unit, i) => {
    s = s.split(unit).join(UNIT_HOLDER(i))
  })
  s = s.replace(/百分之/g, PERCENT_HOLDER)
  s = s.replace(new RegExp(`${PERCENT_HOLDER}\\s*(${CN_NUMBER})`, 'g'), (m, num: string) => {
    const n = chineseNumeral(num)
    if (n == null) return m
    fixes.push(`中文数字「百分之${num}」→「百分之 ${n}」`)
    return `${PERCENT_HOLDER} ${n}`
  })
  // 数字 + 单位/量词(「第」开头的序数词不动:第一问、第二步)
  const unitAlt = `${NUM_UNITS}|\uE020\\d+\uE021`
  s = s.replace(new RegExp(`(?<!第)(${CN_NUMBER})\\s*(${unitAlt})`, 'g'), (m, num: string, unit: string) => {
    const n = chineseNumeral(num)
    if (n == null) return m
    const shown = unit.startsWith('\uE020') ? COMPOUND_UNITS[Number(unit.slice(1, -1))] : unit
    fixes.push(`中文数字「${num}${shown}」→「${n} ${shown}」`)
    return `${n} ${unit}`
  })
  // 「比」「分之」后面拖着的那个数(「5 分之四」→「5 分之 4」)
  s = s.replace(new RegExp(`(比|分之)\\s*(${CN_NUMBER})(?![\\u4e00-\\u9fff])`, 'g'), (m, op: string, num: string) => {
    const n = chineseNumeral(num)
    if (n == null) return m
    fixes.push(`中文数字「${op}${num}」→「${op} ${n}」`)
    return `${op} ${n}`
  })
  s = s.replace(new RegExp(PERCENT_HOLDER, 'g'), '百分之')
  s = s.replace(/\uE020(\d+)\uE021/g, (_m, i: string) => COMPOUND_UNITS[Number(i)])

  // ---- 2b. 还原成语 / 惯用语 ----
  for (const { idiom, i } of idiomOrder) s = s.split(IDIOM_HOLDER(i)).join(idiom)

  // ---- 3. 间距归一(与 tex-to-speech 的拼法一致) ----
  s = s
    .replace(/([\u4e00-\u9fff])[ \t]+(?=[\u4e00-\u9fff])/g, '$1')
    .replace(/([\u4e00-\u9fff])(\d)/g, '$1 $2')
    .replace(/(\d)([\u4e00-\u9fff])/g, '$1 $2')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()

  return { text: s, fixes: [...new Set(fixes)] }
}
