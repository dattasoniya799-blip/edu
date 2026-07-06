import { describe, expect, it } from 'vitest';
import type { QuestionDto } from '@qiming/contracts';
import {
  QUESTION_PICKER_MAX_PAGES,
  QUESTION_PICKER_PAGE_SIZE,
  collectQuestionPages,
  resolveDefaultSubject,
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

/** 用一个内存题库造 fetchPage:1-based page,按 size 切片,total 恒为题库总数;记录 subject 透传 */
const pagedFetcher = (all: QuestionDto[]) => {
  const calls: { page: number; size: number; subject?: string }[] = [];
  const fetchPage = async (page: number, size: number, subject?: string) => {
    calls.push({ page, size, subject });
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

  it('subject 透传给每一页 fetchPage(服务端按学科过滤,减少翻页量)', async () => {
    const { fetchPage, calls } = pagedFetcher(bank(120));
    await collectQuestionPages(fetchPage, '物理');
    expect(calls).toHaveLength(3);
    expect(calls.every((c) => c.subject === '物理')).toBe(true);
  });

  it('未传 subject → 每页 subject 为 undefined(不过滤)', async () => {
    const { fetchPage, calls } = pagedFetcher(bank(10));
    await collectQuestionPages(fetchPage);
    expect(calls[0].subject).toBeUndefined();
  });
});

describe('resolveDefaultSubject', () => {
  const courses = [
    { id: 1, subject: '数学' },
    { id: 2, subject: '物理' },
    { id: 3, subject: '化学' },
  ];

  it('取讲次所属课程的学科作默认预选', () => {
    expect(resolveDefaultSubject(courses, 2)).toBe('物理');
    expect(resolveDefaultSubject(courses, 3)).toBe('化学');
  });

  it('课程不存在(异常)→ 空串(=全部学科)', () => {
    expect(resolveDefaultSubject(courses, 999)).toBe('');
    expect(resolveDefaultSubject([], 1)).toBe('');
  });
});
