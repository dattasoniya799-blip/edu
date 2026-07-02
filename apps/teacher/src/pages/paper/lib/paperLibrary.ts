/**
 * 试卷库纯逻辑:类型中文/徽标色、状态文案、按 type+试卷名过滤、分类计数(vitest 覆盖)。
 * 中文口径沿用项目既有:practice=随堂练 / homework=课后作业 / exam=考试(seed 与讲次编排同口径)。
 */
import type { PaperDto, PaperType } from '@qiming/contracts';

/** 后端 PaperListQueryDto.size 的上限;试卷库按该上限分页拉齐全量。 */
export const PAPER_LIBRARY_PAGE_SIZE = 50;

type PaperPage = { items: PaperDto[]; total: number };

export async function collectPaperPages(fetchPage: (page: number, size: number) => Promise<PaperPage>): Promise<PaperDto[]> {
  const all: PaperDto[] = [];
  let page = 1;
  let total = Number.POSITIVE_INFINITY;

  while (all.length < total) {
    const r = await fetchPage(page, PAPER_LIBRARY_PAGE_SIZE);
    all.push(...r.items);
    total = r.total;
    if (r.items.length === 0) break;
    page += 1;
  }

  return all;
}

/** 试卷类型 → 中文(项目既有口径,勿另造) */
export const PAPER_TYPE_LABEL: Record<PaperType, string> = {
  practice: '随堂练',
  homework: '课后作业',
  exam: '考试',
};

/** 试卷类型 → 徽标语义色(design-tokens 语义名,禁裸十六进制) */
export const PAPER_TYPE_TONE: Record<PaperType, 'primary' | 'orange' | 'violet'> = {
  practice: 'primary',
  homework: 'orange',
  exam: 'violet',
};

/** 试卷状态 → 中文(草稿 / 已发布) */
export function paperStatusLabel(status: string): string {
  return status === 'published' ? '已发布' : '草稿';
}

/** 页签维度:全部 + 三类 type */
export type PaperTab = 'all' | PaperType;

/** 页签顺序与文案(全部在前,后接三类) */
export const PAPER_TABS: { key: PaperTab; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'practice', label: PAPER_TYPE_LABEL.practice },
  { key: 'homework', label: PAPER_TYPE_LABEL.homework },
  { key: 'exam', label: PAPER_TYPE_LABEL.exam },
];

/**
 * 按页签(type)+ 试卷名关键词过滤(纯客户端)。
 * 关键词忽略首尾空白、大小写不敏感;空关键词不过滤。
 */
export function filterPapers(papers: PaperDto[], tab: PaperTab, keyword: string): PaperDto[] {
  const kw = keyword.trim().toLowerCase();
  return papers.filter(
    (p) => (tab === 'all' || p.type === tab) && (kw === '' || p.name.toLowerCase().includes(kw)),
  );
}

/** 各页签计数(页签角标用;all = 总数) */
export function countByType(papers: PaperDto[]): Record<PaperTab, number> {
  const counts: Record<PaperTab, number> = { all: papers.length, practice: 0, homework: 0, exam: 0 };
  for (const p of papers) counts[p.type] += 1;
  return counts;
}
