/**
 * 批改名单端点(C1GAP-front · #B)mock 全链路:
 * GET /grading/assignments/{id}/answers 列待复核/已复核 → 切换 → 详情 → review 后 pending→graded 刷新。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setupServer } from 'msw/node';
import type { GradingAnswerBriefDto, GradingItemDto } from '@qiming/contracts';
import { createClient } from '@qiming/contracts';
import { handlers } from '../handlers';
import * as D from '../data';

const server = setupServer(...handlers);
let token: string | null = null;
const api = createClient({
  baseUrl: 'http://localhost/api/v1',
  getToken: () => token,
  fetchImpl: (...args: Parameters<typeof fetch>) => globalThis.fetch(...args),
});

beforeAll(async () => {
  server.listen({ onUnhandledRequest: 'error' });
  const login = await api.post('/auth/login', { body: { phone: '13800000002', password: 'Teacher@123' } });
  token = login.data.accessToken;
});
afterAll(() => server.close());

// 每条用例后复位 seed(review 会改 finalScore)
beforeEach(() => {
  for (const g of D.gradingAnswers) { g.finalScore = null; g.comment = null; }
  D.gradingState.finalized = false;
});

const listAnswers = async (id: number, status?: 'pending' | 'graded') =>
  (await api.get('/grading/assignments/{id}/answers', { params: { id }, query: status ? { status } : undefined })).data as GradingAnswerBriefDto[];

describe('批改名单端点驱动切换/复核', () => {
  it('列名单:4 份待复核,含 studentName/seq/aiScore,status=pending', async () => {
    const list = await listAnswers(1);
    expect(list).toHaveLength(4);
    expect(list.every((b) => b.status === 'pending')).toBe(true);
    expect(list[0]).toMatchObject({ answerId: 41, studentName: '许诺', aiScore: 7 });
    expect(list.every((b) => typeof b.seq === 'number')).toBe(true);
  });

  it('点一项 → GET /grading/answers/{answerId} 看详情复核', async () => {
    const list = await listAnswers(1);
    const detail = (await api.get('/grading/answers/{id}', { params: { id: list[0].answerId } })).data as GradingItemDto;
    expect(detail.answerId).toBe(41);
    expect(detail.rubric.reduce((s, r) => s + r.score, 0)).toBe(10);
    expect(detail.aiSteps.length).toBeGreaterThan(0);
  });

  it('review 后该项 pending→graded,名单刷新且 finalScore 回填', async () => {
    await api.put('/grading/answers/{id}/review', { params: { id: 41 }, body: { finalScore: 8, comment: '还原方向已纠正' } });
    const after = await listAnswers(1);
    const b41 = after.find((b) => b.answerId === 41)!;
    expect(b41.status).toBe('graded');
    expect(b41.finalScore).toBe(8);
    expect(after.filter((b) => b.status === 'pending')).toHaveLength(3);
  });

  it('只看 pending:status=pending 仅返回待复核项', async () => {
    await api.put('/grading/answers/{id}/review', { params: { id: 41 }, body: { finalScore: 8 } });
    const pendingOnly = await listAnswers(1, 'pending');
    expect(pendingOnly.map((b) => b.answerId)).not.toContain(41);
    expect(pendingOnly).toHaveLength(3);
    const gradedOnly = await listAnswers(1, 'graded');
    expect(gradedOnly.map((b) => b.answerId)).toEqual([41]);
  });

  it('无主观题的作业 → 空名单', async () => {
    const list = await listAnswers(999);
    expect(list).toEqual([]);
  });
});
