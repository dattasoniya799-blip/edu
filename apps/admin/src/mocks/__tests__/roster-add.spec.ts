/**
 * C3 #1:管理员入班「添加学生」候选拉取(真因 + 修复验收)
 * 真因:候选请求 size=100 超后端单页上限 50 → 真实后端 400 被吞成空候选 + 误导「都已在课程」。
 * 本测以「严格后端」(size>50 → 400)断言:① 合法 size=50 正常返回;② 关键字搜索使 >50 学生可选到;
 *    ③ 候选 = 本页学生 − active 名单(分页过滤)。
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { createClient } from '@qiming/contracts';
import { handlers } from '../handlers';
import { candidateStudents } from '../../lib/roster';

// 严格后端:复刻真实后端的单页上限 50(mock handlers 默认不校验)
const STRICT_SIZE_CAP = http.get('*/api/v1/admin/students', ({ request }) => {
  const size = Number(new URL(request.url).searchParams.get('size') ?? 20);
  if (size > 50) return HttpResponse.json({ code: 4000, message: 'size 超过上限 50' }, { status: 400 });
  return undefined; // 交回默认 handler
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
  const login = await api.post('/auth/login', { body: { phone: '13800000001', password: 'Admin@123' } });
  token = login.data.accessToken;
});

describe('候选请求 size 必须合法(≤50)', () => {
  it('真因复现:size=100 → 真实后端 400(此前被吞成空候选)', async () => {
    server.use(STRICT_SIZE_CAP);
    await expect(api.get('/admin/students', { query: { page: 1, size: 100 } }))
      .rejects.toMatchObject({ code: 4000, httpStatus: 400 });
  });

  it('修复:size=50 → 正常返回学生分页', async () => {
    server.use(STRICT_SIZE_CAP);
    const r = await api.get('/admin/students', { query: { page: 1, size: 50 } });
    expect(r.data.items.length).toBeGreaterThan(0);
    expect(typeof r.data.total).toBe('number');
  });
});

describe('关键字搜索(使 >50 学生也能选到)', () => {
  it('按姓名搜索命中目标学生', async () => {
    const r = await api.get('/admin/students', { query: { page: 1, size: 50, keyword: '吴佳怡' } });
    expect(r.data.items.every((s) => s.name.includes('吴佳怡'))).toBe(true);
    expect(r.data.items.some((s) => s.name === '吴佳怡')).toBe(true);
  });

  it('按学号搜索命中目标学生', async () => {
    const r = await api.get('/admin/students', { query: { page: 1, size: 50, keyword: 'S-0003' } });
    expect(r.data.items.some((s) => s.studentNo === 'S-0003')).toBe(true);
  });
});

describe('候选 = 本页学生 − 当前课程 active 名单', () => {
  it('已在课程的 active 学生被排除,其余可入班', async () => {
    const r = await api.get('/admin/students', { query: { page: 1, size: 50 } });
    const page = r.data.items;
    const enrolledId = page[0].id;
    const roster = [{ studentId: enrolledId, status: 'active' }];
    const cands = candidateStudents(page, roster);
    expect(cands.some((s) => s.id === enrolledId)).toBe(false);
    expect(cands.length).toBe(page.length - 1);
  });
});
