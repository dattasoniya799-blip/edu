/**
 * 大纲编辑纯逻辑(向导第 1、2 步)
 * 逐页大纲的增删改序 + 输入校验 + 耗时估算,全部纯函数,vitest 覆盖边界。
 */
import type { CoursewareOutlinePageDto } from '@qiming/contracts';

export const PAGE_COUNT_MIN = 3;
export const PAGE_COUNT_MAX = 20;
export const PAGE_COUNT_DEFAULT = 8;

/**
 * 输入上限(与 apps/server courseware.dto.ts 的 class-validator 逐条对齐,前端提前拦下,
 * 避免教师写满 3000 字点提交才吃一个 400)。改这里之前先看后端 DTO —— 两边必须同数。
 * body/imagePrompt 是后端 2026-08-22 收紧后的值(2000 / 1000),比 openapi 的 maxLength 严。
 */
export const LIMITS = {
  name: 128,
  sourceText: 8000,
  title: 200,
  body: 2000,
  imagePrompt: 1000,
  customText: 1000,
  pages: PAGE_COUNT_MAX,
} as const;
/** 实测 GPT Image 一张约 23 秒,展示时按 25 秒/页向教师报耗时 */
export const SECONDS_PER_PAGE = 25;

export function clampPageCount(n: number): number {
  if (!Number.isFinite(n)) return PAGE_COUNT_DEFAULT;
  return Math.min(PAGE_COUNT_MAX, Math.max(PAGE_COUNT_MIN, Math.round(n)));
}

/** 逐页生图总耗时估算(秒);用于「约需 N×25 秒」提示 */
export function estimateSeconds(pageCount: number): number {
  return Math.max(0, pageCount) * SECONDS_PER_PAGE;
}

/** 秒 → 「约 3 分 20 秒」/「约 45 秒」 */
export function formatEstimate(seconds: number): string {
  if (seconds < 60) return `约 ${seconds} 秒`;
  const min = Math.floor(seconds / 60);
  const sec = seconds % 60;
  return sec === 0 ? `约 ${min} 分钟` : `约 ${min} 分 ${sec} 秒`;
}

export function emptyPage(): CoursewareOutlinePageDto {
  return { title: '', body: '', imagePrompt: '' };
}

/** 第 1 步输入校验(名称 + 文字稿必填,页数范围,各字段长度上限) */
export function validateInput(input: { name: string; sourceText: string; pageCount: number }): string[] {
  const errors: string[] = [];
  if (!input.name.trim()) errors.push('请填写课件名称');
  else if (input.name.trim().length > LIMITS.name) errors.push(`课件名称最多 ${LIMITS.name} 字`);
  if (!input.sourceText.trim()) errors.push('请填写文字稿或本节课内容范围');
  else if (input.sourceText.trim().length > LIMITS.sourceText) errors.push(`文字稿最多 ${LIMITS.sourceText} 字`);
  if (input.pageCount < PAGE_COUNT_MIN || input.pageCount > PAGE_COUNT_MAX) {
    errors.push(`期望页数需在 ${PAGE_COUNT_MIN}–${PAGE_COUNT_MAX} 之间`);
  }
  return errors;
}

/** 第 2 步确认校验:1–20 页,每页需有标题,逐页文本不超上限 */
export function validateOutline(pages: CoursewareOutlinePageDto[]): string[] {
  const errors: string[] = [];
  if (pages.length === 0) return ['大纲至少需要 1 页'];
  if (pages.length > LIMITS.pages) errors.push(`大纲最多 ${LIMITS.pages} 页,请先删掉多余的页`);
  const blank = pages
    .map((p, i) => (p.title.trim() ? 0 : i + 1))
    .filter((n) => n > 0);
  if (blank.length) errors.push(`第 ${blank.join('、')} 页缺少标题`);
  const over = (field: 'title' | 'body' | 'imagePrompt', label: string) => {
    const seqs = pages.map((p, i) => (p[field].length > LIMITS[field] ? i + 1 : 0)).filter((n) => n > 0);
    if (seqs.length) errors.push(`第 ${seqs.join('、')} 页${label}超过 ${LIMITS[field]} 字`);
  };
  over('title', '标题');
  over('body', '要点');
  over('imagePrompt', '画面描述');
  return errors;
}

/** 已达页数上限 → 禁用所有「插入一页」入口(后端 ArrayMaxSize(20) 会直接 400) */
export function canInsertPage(pages: readonly unknown[]): boolean {
  return pages.length < LIMITS.pages;
}

/** 改某页字段(越界 → 原样返回) */
export function updatePage(pages: CoursewareOutlinePageDto[], index: number, patch: Partial<CoursewareOutlinePageDto>): CoursewareOutlinePageDto[] {
  if (index < 0 || index >= pages.length) return pages;
  return pages.map((p, i) => (i === index ? { ...p, ...patch } : p));
}

/**
 * 在 index 位置插入一页(index=0 插到最前、index=length 追加到末尾);
 * 越界索引夹取到 [0, length],保证「在任意位置插入」不会丢页。
 */
export function insertPage(pages: CoursewareOutlinePageDto[], index: number, page: CoursewareOutlinePageDto = emptyPage()): CoursewareOutlinePageDto[] {
  if (!canInsertPage(pages)) return pages; // 已 20 页:插入无效(与后端 ArrayMaxSize 同口径)
  const at = Math.min(pages.length, Math.max(0, index));
  return [...pages.slice(0, at), page, ...pages.slice(at)];
}

/** 删除某页(越界 → 原样返回) */
export function removePage(pages: CoursewareOutlinePageDto[], index: number): CoursewareOutlinePageDto[] {
  if (index < 0 || index >= pages.length) return pages;
  return pages.filter((_, i) => i !== index);
}

/** 上移/下移一页;越界(首页上移、末页下移)→ 原样返回 */
export function movePage(pages: CoursewareOutlinePageDto[], index: number, dir: -1 | 1): CoursewareOutlinePageDto[] {
  const target = index + dir;
  if (index < 0 || index >= pages.length || target < 0 || target >= pages.length) return pages;
  const next = [...pages];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}
