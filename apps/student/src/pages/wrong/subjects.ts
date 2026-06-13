/**
 * 错题本学科分组/筛选(FIX3 问题5,纯函数便于单测)
 *
 * 契约现状:WrongBookItem 已正式含 `subject: string`(2026-06-13 批准,源自题目学科)。
 * 前端直接读契约字段做学科分组/筛选;视图仅做容错(subject 可能为空串)。
 * MVP 为数学单科 → 学科集合 ≤1 时优雅退化:不渲染学科筛选(isMultiSubject=false)。
 */
import type { WrongBookItemDto } from '@qiming/contracts';

/** 错题项视图 = 契约 DTO(subject 现为契约正式字段) */
export type WrongBookItemView = WrongBookItemDto;

/** 去重后保留出现顺序的学科列表(忽略空/缺失) */
export function deriveSubjects(items: WrongBookItemView[]): string[] {
  const seen: string[] = [];
  for (const w of items) {
    const s = w.subject?.trim();
    if (s && !seen.includes(s)) seen.push(s);
  }
  return seen;
}

/** 是否需要展示学科筛选:存在 ≥2 个学科才显示(单科退化隐藏) */
export function isMultiSubject(items: WrongBookItemView[]): boolean {
  return deriveSubjects(items).length > 1;
}

/** 按学科筛选;subject=null 表示「全部学科」 */
export function filterBySubject(items: WrongBookItemView[], subject: string | null): WrongBookItemView[] {
  if (subject == null) return items;
  return items.filter((w) => (w.subject ?? '') === subject);
}
