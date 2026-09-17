/**
 * 确定性 LaTeX → 中文口语转换。
 *
 * 两个用途(方案 2026-09-17 §六):
 *  1. 兜底:LLM 漏写板书行的 speech 时,由 tex 直接生成一条能念的文本;
 *  2. 参照:LLM 写了 speech 时,拿转换结果比对——转换结果里有的数字、LLM speech 里没有 → 告警。
 *
 * 实现是一个极小的 LaTeX 扫描器:把公式拆成「块」(chunk),最后按「两边都是汉字就不留空格」
 * 的规则拼起来。这样「4.8 牛乘 10 牛每千克等于 600 帕」这种中英数混排才念得顺。
 * 不求覆盖全部 LaTeX,只求覆盖初中数理化板书行;不认识的宏直接丢掉,绝不把反斜杠念出来。
 */

/** 单字符 / 运算符 → 口语 */
const OPERATORS: Record<string, string> = {
  '=': '等于',
  '+': '加',
  '>': '大于',
  '<': '小于',
  ':': '比',
  '/': '除以',
  ',': '逗号',
  '%': '百分号',
  '°': '度',
  '≈': '约等于',
  '≠': '不等于',
  '≤': '小于等于',
  '≥': '大于等于',
  '×': '乘',
  '÷': '除以',
  '±': '正负',
  '⊥': '垂直于',
  '∥': '平行于',
  '∠': '角',
  '△': '三角形',
  '≌': '全等于',
  '∽': '相似于',
  '∵': '因为',
  '∴': '所以'
}

/** 无参数宏 → 口语 */
const MACROS: Record<string, string> = {
  angle: '角',
  triangle: '三角形',
  perp: '垂直于',
  parallel: '平行于',
  cong: '全等于',
  sim: '相似于',
  simeq: '相似于',
  le: '小于等于',
  leq: '小于等于',
  leqslant: '小于等于',
  ge: '大于等于',
  geq: '大于等于',
  geqslant: '大于等于',
  ne: '不等于',
  neq: '不等于',
  approx: '约等于',
  times: '乘',
  div: '除以',
  cdot: '乘',
  pm: '正负',
  mp: '负正',
  therefore: '所以',
  because: '因为',
  rightarrow: '推出',
  Rightarrow: '推出',
  to: '推出',
  implies: '推出',
  leftrightarrow: '等价于',
  Leftrightarrow: '等价于',
  infty: '无穷',
  circ: '度',
  degree: '度',
  percent: '百分号',
  pi: '派',
  Delta: '德尔塔',
  delta: '德尔塔',
  // 希腊字母按中学课堂的中文读法念,不要让 TTS 去拼英文单词
  rho: '密度',
  alpha: '阿尔法',
  beta: '贝塔',
  gamma: '伽马',
  theta: '西塔',
  lambda: '兰姆达',
  mu: '缪',
  omega: '欧米伽',
  Omega: '欧姆',
  eta: '伊塔',
  sigma: '西格玛',
  varphi: '斐',
  phi: '斐',
  sin: '正弦',
  cos: '余弦',
  tan: '正切',
  log: 'log',
  ln: 'ln',
  cdots: '省略号',
  dots: '省略号',
  ldots: '省略号'
}

/** 只影响排版、不发音的宏 */
const SKIP_MACROS = new Set([
  'left', 'right', 'quad', 'qquad', 'displaystyle', 'textstyle', 'limits', 'nolimits',
  'big', 'Big', 'bigg', 'Bigg', 'bigl', 'bigr', 'Bigl', 'Bigr', 'hspace', 'vspace',
  ' ', ',', ';', ':', '!', '\\', '&', 'nonumber', 'notag', 'boldsymbol', 'mathbb'
])

/** \text{} 里的单位读法(与 tts/speak-text.ts 的口径一致) */
const UNITS: Record<string, string> = {
  N: '牛', Pa: '帕', J: '焦', W: '瓦', kW: '千瓦', kJ: '千焦', kPa: '千帕', MPa: '兆帕',
  m: '米', cm: '厘米', mm: '毫米', dm: '分米', km: '千米',
  kg: '千克', g: '克', mg: '毫克', t: '吨',
  s: '秒', min: '分钟', h: '小时', ms: '毫秒',
  A: '安', mA: '毫安', V: '伏', kV: '千伏', C: '库', F: '法', H: '亨',
  L: '升', mL: '毫升', ml: '毫升',
  mol: '摩尔', K: '开尔文', Hz: '赫兹', kHz: '千赫兹',
  'N/kg': '牛每千克'
}

/** 「基底 + 中文下标」的固定读法;查不到的走通用「下标的基底」语序 */
const SUBSCRIPT_PAIRS: Record<string, string> = {
  '\\rho|水': '水的密度',
  '\\rho|液': '液体的密度',
  '\\rho|物': '物体的密度',
  '\\rho|水银': '水银的密度',
  'F|浮': '浮力',
  'F|合': '合力',
  'F|拉': '拉力',
  'F|压': '压力',
  'F|摩': '摩擦力',
  'G|总': '总重力',
  'G|物': '物体的重力',
  'V|排': '排开液体的体积',
  'V|物': '物体的体积',
  'V|水': '水的体积',
  'p|水': '水的压强',
  'S|底': '底面积',
  'S|受': '受力面积',
  'W|总': '总功',
  'W|有': '有用功',
  'W|额': '额外功',
  'h|水': '水的深度',
  'm|水': '水的质量',
  'm|物': '物体的质量',
  't|总': '总时间'
}

/** 汉字与中日韩标点(join 时两边都是它就不加空格) */
const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\u3000-\u303f\uff01-\uff60]/

/** 运算词:碰到 `-` 时用来判断念「减」还是「负」 */
const OPERATOR_WORDS = new Set(Object.values(OPERATORS).concat(Object.values(MACROS), ['分之', '根号', '次根号', '次方']))

interface Atom {
  kind: 'value' | 'unit' | 'op' | 'skip'
  /** 原文(下标查表用) */
  raw: string
  chunks: string[]
  /** kind='unit' 时的单位原文 */
  unitText?: string
  next: number
}

function isSpace(ch: string): boolean {
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r'
}

/** 从 `{` 处读一个配平的组,返回内容与右花括号之后的位置 */
function readGroup(s: string, at: number): { body: string; next: number } {
  let depth = 0
  for (let i = at; i < s.length; i++) {
    if (s[i] === '\\') { i++; continue }
    if (s[i] === '{') depth++
    else if (s[i] === '}') {
      depth--
      if (depth === 0) return { body: s.slice(at + 1, i), next: i + 1 }
    }
  }
  return { body: s.slice(at + 1), next: s.length }
}

/** 跳过空白后,读下一个「参数」(一个组 / 一个宏 / 一个字符)的原文 */
function readArgRaw(s: string, at: number): { raw: string; next: number } {
  let i = at
  while (i < s.length && isSpace(s[i])) i++
  if (i >= s.length) return { raw: '', next: i }
  if (s[i] === '{') {
    const g = readGroup(s, i)
    return { raw: g.body, next: g.next }
  }
  if (s[i] === '\\') {
    let j = i + 1
    while (j < s.length && /[A-Za-z]/.test(s[j])) j++
    if (j === i + 1) j = i + 2
    return { raw: s.slice(i, j), next: j }
  }
  return { raw: s[i], next: i + 1 }
}

/** 单位:`kg/m` + 指数 3 → 「千克每立方米」;`m` + 2 → 「平方米」 */
export function readUnit(text: string, exponent = 0): string {
  const prefix = exponent === 2 ? '平方' : exponent === 3 ? '立方' : ''
  const parts = text.split('/').map((p) => p.trim()).filter(Boolean)
  if (!parts.length) return text
  const say = (u: string): string => UNITS[u] ?? u
  if (parts.length === 1) return prefix + say(parts[0])
  const head = say(parts[0])
  const tail = parts.slice(1).map((p, i) => (i === parts.length - 2 ? prefix + say(p) : say(p)))
  return head + '每' + tail.join('每')
}

/**
 * 上标内容 → 口语块。
 * 底数是纯数字时一律念「的 N 次方」(科学记数法 10³ 读「10 的 3 次方」);
 * 底数是字母/符号时 2、3 念「的平方」「的立方」。
 */
function exponentChunks(raw: string, numericBase = false): string[] {
  const t = raw.trim()
  if (t === '\\circ' || t === '°' || t === 'o') return ['度']
  if (/^-?\d+$/.test(t)) {
    const n = Number(t)
    if (!numericBase && n === 2) return ['的平方']
    if (!numericBase && n === 3) return ['的立方']
    if (n < 0) return ['的负', String(-n), '次方']
    return ['的', String(n), '次方']
  }
  const inner = convertChunks(t)
  return inner.length ? ['的', ...inner, '次方'] : []
}

/** 读一个原子(宏 / 组 / 数字字母串 / 汉字串 / 单字符) */
function readAtom(s: string, at: number): Atom {
  const ch = s[at]
  if (ch === '{') {
    const g = readGroup(s, at)
    return { kind: 'value', raw: g.body, chunks: convertChunks(g.body), next: g.next }
  }
  if (ch === '}' || ch === '$' || ch === '&') return { kind: 'skip', raw: ch, chunks: [], next: at + 1 }
  if (ch === '\\') {
    let j = at + 1
    while (j < s.length && /[A-Za-z]/.test(s[j])) j++
    if (j === at + 1) j = at + 2 // \, \; \! \\ 这类单符号宏
    const name = s.slice(at + 1, j)
    if (name === 'text' || name === 'mathrm' || name === 'mathbf' || name === 'mathit' || name === 'operatorname') {
      const arg = readArgRaw(s, j)
      return { kind: 'unit', raw: '\\' + name, chunks: [], unitText: arg.raw, next: arg.next }
    }
    if (name === 'frac' || name === 'dfrac' || name === 'tfrac' || name === 'cfrac') {
      const a = readArgRaw(s, j)
      const b = readArgRaw(s, a.next)
      return { kind: 'value', raw: '\\frac', chunks: [...convertChunks(b.raw), '分之', ...convertChunks(a.raw)], next: b.next }
    }
    if (name === 'sqrt') {
      let i = j
      let degree = ''
      while (i < s.length && isSpace(s[i])) i++
      if (s[i] === '[') {
        const close = s.indexOf(']', i)
        if (close > 0) { degree = s.slice(i + 1, close).trim(); i = close + 1 }
      }
      const arg = readArgRaw(s, i)
      const body = convertChunks(arg.raw)
      return { kind: 'value', raw: '\\sqrt', chunks: degree ? [degree, '次根号', ...body] : ['根号', ...body], next: arg.next }
    }
    if (SKIP_MACROS.has(name)) return { kind: 'skip', raw: '\\' + name, chunks: [], next: j }
    const word = MACROS[name]
    if (word) return { kind: OPERATOR_WORDS.has(word) ? 'op' : 'value', raw: '\\' + name, chunks: [word], next: j }
    return { kind: 'skip', raw: '\\' + name, chunks: [], next: j } // 不认识的宏丢掉,不念反斜杠
  }
  if (/[0-9A-Za-z]/.test(ch)) {
    let j = at
    while (j < s.length && /[0-9A-Za-z.]/.test(s[j])) j++
    let run = s.slice(at, j)
    while (run.endsWith('.')) { run = run.slice(0, -1); j-- }
    return { kind: 'value', raw: run, chunks: [run], next: j }
  }
  if (CJK.test(ch)) {
    let j = at
    while (j < s.length && CJK.test(s[j])) j++
    const run = s.slice(at, j)
    return { kind: 'value', raw: run, chunks: [run], next: j }
  }
  if (ch === '(' || ch === ')' || ch === '[' || ch === ']' || ch === '|') {
    return { kind: 'value', raw: ch, chunks: [ch], next: at + 1 }
  }
  const op = OPERATORS[ch]
  if (op) return { kind: 'op', raw: ch, chunks: [op], next: at + 1 }
  return { kind: 'skip', raw: ch, chunks: [], next: at + 1 }
}

function convertChunks(src: string): string[] {
  const out: string[] = []
  let i = 0
  let lastWasValue = false
  while (i < src.length) {
    const ch = src[i]
    if (isSpace(ch)) { i++; continue }
    if (ch === '-' || ch === '−' || ch === '–') {
      out.push(lastWasValue ? '减' : '负')
      lastWasValue = false
      i++
      continue
    }
    if (ch === '*') { out.push('乘'); lastWasValue = false; i++; continue }
    if (ch === '^') {
      const arg = readArgRaw(src, i + 1)
      out.push(...exponentChunks(arg.raw))
      i = arg.next
      lastWasValue = true
      continue
    }
    const atom = readAtom(src, i)
    i = atom.next
    if (atom.kind === 'skip') continue

    // 下标先结合(F_浮),再看上标(m^2)
    let chunks = atom.chunks
    let unitExponent = 0
    if (src[i] === '_') {
      const sub = readArgRaw(src, i + 1)
      i = sub.next
      chunks = subscriptChunks(atom.raw, chunks, sub.raw)
    }
    if (src[i] === '^') {
      const sup = readArgRaw(src, i + 1)
      i = sup.next
      if (atom.kind === 'unit' && /^-?\d+$/.test(sup.raw.trim())) unitExponent = Number(sup.raw.trim())
      else chunks = [...chunks, ...exponentChunks(sup.raw, /^\d+(\.\d+)?$/.test(atom.raw))]
    }
    if (atom.kind === 'unit') chunks = [readUnit(atom.unitText ?? '', unitExponent)]

    out.push(...chunks)
    lastWasValue = atom.kind !== 'op'
  }
  return out.filter(Boolean)
}

/** 下标里的 \text{水} / \mathrm{浮} 剥成 水 / 浮,好让 SUBSCRIPT_PAIRS 查得到(模型两种写法都出) */
function unwrapText(raw: string): string {
  let out = raw.trim()
  for (let i = 0; i < 3; i++) {
    const m = out.match(/^\\(?:text|mathrm|mathbf|mathit)\s*\{([\s\S]*)\}$/)
    if (!m) break
    out = m[1].trim()
  }
  return out
}

function subscriptChunks(baseRaw: string, baseChunks: string[], subRaw: string): string[] {
  const sub = unwrapText(subRaw)
  const pair = SUBSCRIPT_PAIRS[`${baseRaw}|${sub}`]
  if (pair) return [pair]
  if (/^-?\d+$/.test(sub)) return [...baseChunks, sub]
  const subChunks = convertChunks(sub)
  if (!subChunks.length) return baseChunks
  return [...subChunks, '的', ...baseChunks]
}

function joinChunks(chunks: string[]): string {
  let out = ''
  for (const c of chunks) {
    if (!c) continue
    if (!out) { out = c; continue }
    const left = out[out.length - 1]
    const right = c[0]
    out += CJK.test(left) && CJK.test(right) ? c : ' ' + c
  }
  return out.trim()
}

/** 主入口:一行 tex → 一句能念的中文;永不抛错,认不出的部分丢掉 */
export function texToSpeech(tex: string): string {
  const src = String(tex ?? '').replace(/\$+/g, ' ').trim()
  if (!src) return ''
  try {
    return joinChunks(convertChunks(src))
  } catch {
    return src.replace(/\\[A-Za-z]+/g, ' ').replace(/[{}^_$\\]/g, ' ').replace(/\s{2,}/g, ' ').trim()
  }
}

/** speech 里还留着 LaTeX 记号吗(校验器用:speech 必须是纯口语) */
export function texHasLatexMarkup(text: string): boolean {
  return /[\\{}^_$]/.test(String(text ?? ''))
}

const CN_DIGITS: Record<string, number> = { 〇: 0, 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }
const CN_UNITS: Record<string, number> = { 十: 10, 百: 100, 千: 1000 }

/** 「四十五」→ 45,「九十」→ 90,「零点五」→ 0.5;认不出返回 null */
export function chineseNumeralToNumber(text: string): number | null {
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

/**
 * 文本里的数值集合。中文数字也算进来:老师口播写「四十度」、板书写 40°,
 * 意思一样,不该报成「speech 漏了数字」(比对用,不改原文)。
 */
export function numbersIn(text: string): string[] {
  const src = String(text ?? '')
  const out: string[] = []
  for (const m of src.match(/\d+(?:\.\d+)?/g) ?? []) out.push(m.replace(/^(\d+)\.0+$/, '$1'))
  for (const m of src.match(/[〇零一二两三四五六七八九十百千]+(?:点[〇零一二三四五六七八九]+)?/g) ?? []) {
    const n = chineseNumeralToNumber(m)
    if (n != null) out.push(String(n))
  }
  return out
}

/**
 * 拿确定性转换结果当参照,挑出 LLM 版 speech 漏掉的数字。
 * 只报数字:措辞差异是允许的(老师本来就会换说法),数值漏了才是事故。
 */
export function speechMissingNumbers(llmSpeech: string, referenceSpeech: string): string[] {
  const have = new Set(numbersIn(llmSpeech))
  const missing: string[] = []
  for (const n of numbersIn(referenceSpeech)) {
    if (!have.has(n) && !missing.includes(n)) missing.push(n)
  }
  return missing
}
