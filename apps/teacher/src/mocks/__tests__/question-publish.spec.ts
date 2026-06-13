/**
 * C1 round3 #3:编辑"已发布"题不再对 publish 报 400。
 * 真因:EditorPage 的"提交入库"对已 published 题仍调 POST /questions/:id/publish,
 *       后端"仅草稿可入库"→ 400。修复:已入库题只做 PUT 更新、不再 publish;
 *       "提交入库"仅对草稿/新题显示。
 * 本测以"严格后端"(对非草稿 publish → 400)复刻真因,并验证修复后的保存口径:
 *   ① 草稿/新题:PUT/POST + publish → published(可入库);
 *   ② 已入库题:仅 PUT 更新,canPublishQuestion=false → 不调 publish,无 400。
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { createClient } from '@qiming/contracts';
import { handlers } from '../handlers';
import * as D from '../data';
import { canPublishQuestion } from '../../pages/bank/lib/transform';

// 严格后端:复刻真实后端"仅草稿状态可入库"(mock 默认不校验),从有状态 store 取当前状态
const STRICT_PUBLISH = http.post('*/api/v1/questions/:id/publish', ({ params }) => {
  const q = D.questions.find((x) => x.id === Number(params.id));
  if (q && q.status !== 'draft') return HttpResponse.json({ code: 4000, message: '仅草稿状态的题目可入库' }, { status: 400 });
  return undefined; // 草稿/未知 → 交回默认 handler
});

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

const body = () => ({
  type: 'single' as const, stage: '初中', subject: '数学', textbookVersion: '人教版', chapter: '第十九章 一次函数',
  stemLatex: '题干', figures: [], options: [{ label: 'A', contentLatex: '1', isCorrect: true }, { label: 'B', contentLatex: '2', isCorrect: false }],
  answer: { choice: 'A' }, rubric: [], difficulty: 1, tagNodeIds: [101],
});

describe('真因复现:对已 published 题调 publish → 400', () => {
  it('已入库题 publish → 严格后端 400', async () => {
    const published = (await api.get('/questions', { query: { page: 1, size: 50, status: 'published' } })).data.items[0];
    expect(published.status).toBe('published');
    server.use(STRICT_PUBLISH);
    await expect(api.post('/questions/{id}/publish', { params: { id: published.id } }))
      .rejects.toMatchObject({ httpStatus: 400 });
  });
});

describe('修复:编辑已入库题只做 PUT 更新,不再 publish', () => {
  it('canPublishQuestion=false → 跳过 publish,PUT 更新成功,题目仍为 published', async () => {
    const published = (await api.get('/questions', { query: { page: 1, size: 50, status: 'published' } })).data.items[0];
    server.use(STRICT_PUBLISH);

    // 还原 EditorPage 的 save 逻辑:editId 存在 → PUT;allowPublish=false → 不调 publish
    const allowPublish = canPublishQuestion(published.status); // false
    await api.put('/questions/{id}', { params: { id: published.id }, body: body() });
    if (allowPublish) await api.post('/questions/{id}/publish', { params: { id: published.id } }); // 不会执行

    const after = (await api.get('/questions/{id}', { params: { id: published.id } })).data;
    expect(after.status).toBe('published'); // PUT 不改状态,仍入库;且全程无 400
  });

  it('新题:草稿 → 可入库,publish 成功置 published', async () => {
    server.use(STRICT_PUBLISH);
    const created = (await api.post('/questions', { body: body() })).data;
    expect(created.status).toBe('draft');
    expect(canPublishQuestion(created.status)).toBe(true);
    await api.post('/questions/{id}/publish', { params: { id: created.id } }); // 草稿 → 放行
    const after = (await api.get('/questions/{id}', { params: { id: created.id } })).data;
    expect(after.status).toBe('published');
  });
});
