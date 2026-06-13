/**
 * 错题本学科分组/筛选(FIX3 问题5,纯函数便于单测)
 *
 * 契约现状:WrongBookItem 无 subject 字段(见 README「契约变更申请 FIX3-1」)。
 * 前端按 view 类型读取可选 subject:mock 已先行附带(取自题目 subject);契约落地即对齐。
 * MVP 为数学单科 → 学科集合 ≤1 时优雅退化:不渲染学科筛选(isMultiSubject=false)。
 */
import type { WrongBookItemDto } from '@qiming/contracts';

/** 错题项视图:契约外的可选 subject(前端容忍缺失) */
export type WrongBookItemView = WrongBookItemDto & { subject?: string };

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
