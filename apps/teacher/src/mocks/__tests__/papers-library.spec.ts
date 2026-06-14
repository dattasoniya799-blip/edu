/**
 * 试卷库数据层(paper-lib):页面依赖 GET /papers(全量,客户端按 type 过滤)+ GET /papers/{id}(详情)。
 * 验证 mock 数据三类齐全、可不带 type 取全部、type 过滤精确、详情含题目。
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setupServer } from 'msw/node';
import { createClient } from '@qiming/contracts';
import type { PaperDto } from '@qiming/contracts';
import { handlers } from '../handlers';

const server = setupServer(...handlers);
let token: string | null = null;
const api = createClient({
  baseUrl: 'http://localhost/api/v1',
  getToken: () => token,
  fetchImpl: (...args: Parameters<typeof fetch>) => globalThis.fetch(...args),
});

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
beforeEach(async () => {
  const login = await api.post('/auth/login', { body: { phone: '13800000002', password: 'Teacher@123' } });
  token = login.data.accessToken;
});

describe('GET /papers(试卷库列表)', () => {
  it('不带 type → 取全部,三类齐全', async () => {
    const r = await api.get('/papers', { query: { page: 1, size: 200 } });
    const items = (r.data as { items: PaperDto[]; total: number }).items;
    expect(items.length).toBeGreaterThanOrEqual(4);
    const types = new Set(items.map((p) => p.type));
    expect(types.has('practice')).toBe(true);
    expect(types.has('homework')).toBe(true);
    expect(types.has('exam')).toBe(true);
  });

  it('type=exam → 仅考试,且 totalScore = Σ题分', async () => {
    const r = await api.get('/papers', { query: { type: 'exam' } });
    const items = (r.data as { items: PaperDto[] }).items;
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((p) => p.type === 'exam')).toBe(true);
    for (const p of items) {
      expect(p.totalScore).toBe(p.questions.reduce((s, q) => s + q.score, 0));
    }
  });

  it('含 draft 草稿卷(状态可区分)', async () => {
    const r = await api.get('/papers', { query: { page: 1, size: 200 } });
    const items = (r.data as { items: PaperDto[] }).items;
    expect(items.some((p) => p.status === 'draft')).toBe(true);
    expect(items.some((p) => p.status === 'published')).toBe(true);
  });
});

describe('GET /papers/{id}(详情展开)', () => {
  it('返回题目列表(seq/score/stemLatex)', async () => {
    const r = await api.get('/papers/{id}', { params: { id: 1 } });
    const paper = r.data as PaperDto;
    expect(paper.id).toBe(1);
    expect(paper.questions.length).toBeGreaterThan(0);
    expect(paper.questions[0]).toHaveProperty('stemLatex');
    expect(paper.questions[0]).toHaveProperty('seq');
  });

  it('不存在的卷 → 404', async () => {
    await expect(api.get('/papers/{id}', { params: { id: 99999 } })).rejects.toMatchObject({ code: 4040 });
  });
});
