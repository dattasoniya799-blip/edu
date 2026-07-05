import { describe, expect, it } from 'vitest';
import type { QuestionDto } from '@qiming/contracts';
import {
  QUESTION_PICKER_MAX_PAGES,
  QUESTION_PICKER_PAGE_SIZE,
  collectQuestionPages,
} from '../questionLibrary';

const mkQuestion = (id: number): QuestionDto => ({
  id,
  type: 'single',
  stemLatex: `题 ${id}`,
  options: [],
  answer: 'A',
  analysisLatex: '',
  difficulty: 3,
  status: 'published',
  tags: [],
  stats: { correctRate: null },
} as unknown as QuestionDto);

/** 造 n 道题,供分页切片 */
const bank = (n: number): QuestionDto[] => Array.from({ length: n }, (_, i) => mkQuestion(i + 1));

/** 用一个内存题库造 fetchPage:1-based page,按 size 切片,total 恒为题库总数 */
const pagedFetcher = (all: QuestionDto[]) => {
  const calls: { page: number; size: number }[] = [];
  const fetchPage = async (page: number, size: number) => {
    calls.push({ page, size });
    const start = (page - 1) * size;
    return { items: all.slice(start, start + size), total: all.length };
  };
  return { fetchPage, calls };
};

describe('collectQuestionPages', () => {
  it('按 50/页拉齐全部 published 题(143 题 → 3 页,不遗漏尾页)', async () => {
    const { fetchPage, calls } = pagedFetcher(bank(143));
    const { questions, truncated } = await collectQuestionPages(fetchPage);

    expect(QUESTION_PICKER_PAGE_SIZE).toBe(50);
    expect(questions).toHaveLength(143);
    expect(questions.map((q) => q.id)[142]).toBe(143); // 尾题在内
    expect(truncated).toBe(false);
    expect(calls).toEqual([
      { page: 1, size: 50 },
      { page: 2, size: 50 },
      { page: 3, size: 50 },
    ]);
  });

  it('恰好整页(100 题)不多翻一次空页', async () => {
    const { fetchPage, calls } = pagedFetcher(bank(100));
    const { questions, truncated } = await collectQuestionPages(fetchPage);
    expect(questions).toHaveLength(100);
    expect(truncated).toBe(false);
    expect(calls.map((c) => c.page)).toEqual([1, 2]);
  });

  it('空题库 → 空数组,一次请求即停', async () => {
    const { fetchPage, calls } = pagedFetcher(bank(0));
    const { questions, truncated } = await collectQuestionPages(fetchPage);
    expect(questions).toEqual([]);
    expect(truncated).toBe(false);
    expect(calls).toHaveLength(1);
  });

  it('触及页数上限则截断并标记 truncated', async () => {
    const overflow = QUESTION_PICKER_MAX_PAGES * QUESTION_PICKER_PAGE_SIZE + 50;
    const { fetchPage, calls } = pagedFetcher(bank(overflow));
    const { questions, truncated } = await collectQuestionPages(fetchPage);

    expect(questions).toHaveLength(QUESTION_PICKER_MAX_PAGES * QUESTION_PICKER_PAGE_SIZE);
    expect(truncated).toBe(true);
    expect(calls).toHaveLength(QUESTION_PICKER_MAX_PAGES);
  });
});
