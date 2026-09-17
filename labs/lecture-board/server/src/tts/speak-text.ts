/**
 * 朗读文本规范化(合成前必经;播放器比对 clip.text 用原文,规范化只发生在合成侧)。
 * - 去【】(总结页重点词标记)
 * - 数学/物理符号转口语:⊥ ∥ ∠ ° √ ² ³ ≈ ≠ ≥ ≤ × ÷ Δ ρ π △ ≌ ∽ ∵ ∴ ± = − + - · 下标数字 带圈数字 °C
 * - 连续大写字母按字母分开读(OB → O B);单个大写字母(N / J)与大小写混合单位(Pa / kW / MPa)保留
 * 表里没有的符号由 findUnreadSymbols 探出来,进报告补表。
 */

/** 单个符号 → 口语(顺序无关) */
const SYMBOLS: Array<[RegExp, string]> = [
  [/[【】]/g, ''],
  [/°C|℃/g, '摄氏度'],
  [/⊥/g, '垂直于'],
  [/∥|‖/g, '平行于'],
  [/∠/g, '角'],
  [/°/g, '度'],
  [/√/g, '根号'],
  [/²/g, '平方'],
  [/³/g, '立方'],
  [/≈/g, '约等于'],
  [/≠/g, '不等于'],
  [/≥|≧|⩾/g, '大于等于'],
  [/≤|≦|⩽/g, '小于等于'],
  [/≌/g, '全等于'],
  [/∽/g, '相似于'],
  [/×|\*/g, '乘'],
  [/÷/g, '除以'],
  [/Δ/g, '德尔塔'],
  // 希腊字母按中学课堂的中文读法(2026-09-17:原来的 'rho' 会被 TTS 拼成英文单词)
  [/ρ/g, '密度'],
  [/α/g, '阿尔法'],
  [/β/g, '贝塔'],
  [/γ/g, '伽马'],
  [/θ/g, '西塔'],
  [/ω/g, '欧米伽'],
  [/σ/g, '西格玛'],
  [/λ/g, '兰姆达'],
  [/π/g, '派'],
  [/±/g, '正负'],
  [/∵/g, '因为'],
  [/∴/g, '所以'],
  [/∞/g, '无穷'],
  [/=/g, '等于'],
  [/>/g, '大于'],
  [/</g, '小于']
]
const SUBSCRIPT = '₀₁₂₃₄₅₆₇₈₉'
/** 带圈数字 ①–⑳(方程/式子编号,板书题里「把②代入①」)→ 中文数词 */
const CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳'
const CN_NUM = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二', '十三', '十四', '十五', '十六', '十七', '十八', '十九', '二十']

/** 大小写混合、但含连续大写的单位,不拆字母 */
const PROTECTED_UNITS = ['MPa', 'GPa', 'kPa', 'hPa', 'MW', 'GW', 'MHz', 'GHz', 'kHz', 'MV', 'MN', 'MJ', 'MeV', 'keV', 'mAh']

export function toSpeakText(text: string): string {
  let s = String(text ?? '')
  // 下标数字 → 普通数字(F₁ → F1)
  s = s.replace(/[₀₁₂₃₄₅₆₇₈₉]/g, (ch) => String(SUBSCRIPT.indexOf(ch)))
  // 带圈数字 → 中文数词(②式 → 二式;把②代入① → 把二代入一)
  s = s.replace(/[①-⑳]/g, (ch) => CN_NUM[CIRCLED.indexOf(ch)])
  // △ABC → 三角形ABC(△ 单独出现也读三角形)
  s = s.replace(/△/g, '三角形')
  for (const [re, out] of SYMBOLS) s = s.replace(re, out)
  // 间隔号 2·3 → 乘(仅数字/字母之间;中文书名间隔号不动)
  s = s.replace(/(?<=[0-9A-Za-z)])\s*·\s*(?=[0-9A-Za-z(])/g, '乘')
  // 减号 / 负号:− 与 - 同样处理。左边是数/字母/右括号/汉字(x平方-1)且右边是数/字母/左括号 → 减;否则右边跟数字 → 负
  s = s.replace(/(?<=[0-9A-Za-z)\]\u4e00-\u9fff])\s*[−-]\s*(?=[0-9A-Za-z([])/g, (m) => (/\s/.test(m[0]) ? ' 减 ' : '减'))
  s = s.replace(/(?<![0-9A-Za-z)\]\u4e00-\u9fff])[−-](?=\s*[0-9])/g, '负')
  // 加号:两边都是数/字母/括号/汉字(浮力+重力)才读「加」
  s = s.replace(/(?<=[0-9A-Za-z)\]\u4e00-\u9fff])\s*\+\s*(?=[0-9A-Za-z([\u4e00-\u9fff])/g, (m) => (/\s/.test(m[0]) ? ' 加 ' : '加'))
  // 连续大写字母按字母分开读;先把受保护单位换成占位(私用区字符,旁白里不会出现)
  const holders: string[] = []
  s = s.replace(new RegExp(`\\b(${PROTECTED_UNITS.join('|')})\\b`, 'g'), (unit) => {
    holders.push(unit)
    return `\uE000${holders.length - 1}\uE001`
  })
  s = s.replace(/[A-Z]{2,}(?![a-z])/g, (run) => run.split('').join(' '))
  s = s.replace(/\uE000(\d+)\uE001/g, (_m, i: string) => holders[Number(i)])
  // 空格收敛
  s = s.replace(/[ \t]{2,}/g, ' ').replace(/^ | $/g, '')
  return s
}

/**
 * 规范化后仍留着的「TTS 大概念不好」的字符:非中文、非 ASCII 字母数字、非常见中英文标点。去重按出现顺序。
 * 用来跑示例剧本 / 新剧本,漏的符号进 SYMBOLS 表。
 */
export function findUnreadSymbols(text: string): string[] {
  const ok = /[\u3400-\u4dbf\u4e00-\u9fff\u3000-\u303f\uff00-\uffef\u2018\u2019\u201c\u201d\u2014\u2026\u00b7A-Za-z0-9\s,.;:!?()%'"/-]/
  const seen: string[] = []
  for (const ch of String(text ?? '')) {
    if (ok.test(ch) || seen.includes(ch)) continue
    seen.push(ch)
  }
  return seen
}
