/**
 * 填空混合判分检测(IMPL-back · 2026-06-13 行为约定):
 * blank 题的"参考答案"任一空含 LaTeX 控制符(反斜杠 `\`,如 `\frac`、`\sqrt`)→
 * 视为"公式填空",该题整道走 AI 预批 + 教师复核(与 solution 同管线,answer.isCorrect 置空待批);
 * 否则为"简单填空",保持即时归一化判分。
 *
 * 粒度(MVP 口径,简单清晰):以"整道 answer"为单位 —— 一道填空题多空且混合时,
 * 只要任一空的参考答案含公式即整题走复核(不做逐空拆分判分)。
 *
 * 检测只看题目的参考答案(questions.answer.texts),与学生作答无关,故为题目级属性。
 */

/** 单个文本是否含 LaTeX 控制符(反斜杠) */
export function isFormulaText(s: unknown): boolean {
  return typeof s === 'string' && s.includes('\\');
}

/**
 * 给定题目的 answer(JSON),判断该 blank 题是否需要走复核管线(公式填空)。
 * 仅对 blank 题有意义;非 blank 形状(无 texts 数组)返回 false。
 */
export function blankNeedsReview(answer: unknown): boolean {
  const texts = (answer as { texts?: unknown } | null)?.texts;
  return Array.isArray(texts) && texts.some(isFormulaText);
}

/**
 * 给定题型与题目 answer,判断该题的作答是否需要走 AI 预批 + 教师复核管线:
 * - solution:恒需要(原 A5 口径)
 * - blank:仅当公式填空(参考答案含 LaTeX)
 * - 其余(single/multi):不需要,即时判分
 */
export function questionNeedsReview(type: string, answer: unknown): boolean {
  if (type === 'solution') return true;
  if (type === 'blank') return blankNeedsReview(answer);
  return false;
}
