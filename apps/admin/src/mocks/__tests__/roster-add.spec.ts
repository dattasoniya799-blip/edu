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

/**
 * C1 round3 #1:任意"有可选学生"的课程都能正确列候选并入班。
 * 三种课按真实流程(GET 名单 → GET 学生页 → 候选 = 页 − active 名单)分别验收:
 *  ① group 满班(course 1):候选为空(都已在课);移出一人后该人重新成为候选并可加回。
 *  ② 一对一(course 2,已含 1 生):其余学生均为候选,可入班(此前卡片直跳档案、入班 UI 不可达)。
 *  ③ 新建课程:名单空 → 候选 = 全部学生,可入班。
 */
async function candidatesOf(courseId: number) {
  const roster = (await api.get('/admin/courses/{id}/roster', { params: { id: courseId } })).data;
  const page = (await api.get('/admin/students', { query: { page: 1, size: 50 } })).data.items;
  return { roster, cands: candidateStudents(page, roster), pageSize: page.length };
}

describe('三种课都能正确列候选并入班(round3 #1)', () => {
  it('group 班:active 在册生不在候选;移出后可重新入班,加回后不再是候选', async () => {
    const full = await candidatesOf(1);
    const victim = full.roster.find((r) => r.status === 'active')!.studentId;
    expect(full.cands.some((s) => s.id === victim)).toBe(false); // active 在册 → 非候选
    await api.del('/admin/courses/{id}/students/{studentId}', { params: { id: 1, studentId: victim } });
    const after = await candidatesOf(1);
    expect(after.cands.some((s) => s.id === victim)).toBe(true); // 移出后重新成为候选
    await api.post('/admin/courses/{id}/students', { params: { id: 1 }, body: { studentIds: [victim] } });
    const back = await candidatesOf(1);
    expect(back.cands.some((s) => s.id === victim)).toBe(false); // 加回后不再是候选
  });

  it('一对一(course 2,已含 1 生):其余学生为候选且可入班', async () => {
    const before = await candidatesOf(2);
    expect(before.roster.length).toBeGreaterThanOrEqual(1);
    expect(before.cands.length).toBe(before.pageSize - before.roster.filter((r) => r.status === 'active').length);
    expect(before.cands.length).toBeGreaterThan(0);
    const pick = before.cands[0].id;
    await api.post('/admin/courses/{id}/students', { params: { id: 2 }, body: { studentIds: [pick] } });
    const roster = (await api.get('/admin/courses/{id}/roster', { params: { id: 2 } })).data;
    expect(roster.some((r) => r.studentId === pick)).toBe(true);
    await api.del('/admin/courses/{id}/students/{studentId}', { params: { id: 2, studentId: pick } }); // 清理
  });

  it('新建课程:名单空 → 候选为全部学生,可入班', async () => {
    const created = await api.post('/admin/courses', {
      body: { name: 'round3 新课', classType: 'group', subject: '数学', stage: '初中', teacherId: 2, totalLessons: 10 },
    });
    const nid = created.data.id;
    const fresh = await candidatesOf(nid);
    expect(fresh.roster).toHaveLength(0);
    expect(fresh.cands.length).toBe(fresh.pageSize); // 全部学生可选
    await api.post('/admin/courses/{id}/students', { params: { id: nid }, body: { studentIds: [fresh.cands[0].id] } });
    const roster = (await api.get('/admin/courses/{id}/roster', { params: { id: nid } })).data;
    expect(roster.some((r) => r.studentId === fresh.cands[0].id)).toBe(true);
  });
});
