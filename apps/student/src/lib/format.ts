/** 学生端展示格式化(纯函数,便于单测) */

/**
 * 正确率展示:后端 weekStats.correctRate 是 0–1 比值(与 mastery 的 0–100 口径不同),
 * 渲染为整数百分比字符串。null → 占位「—」。
 * 例:0.75 → "75%";0 → "0%";null → "—"。
 */
export function formatCorrectRate(ratio: number | null | undefined): string {
  if (ratio == null) return '—';
  return `${Math.round(ratio * 100)}%`;
}
