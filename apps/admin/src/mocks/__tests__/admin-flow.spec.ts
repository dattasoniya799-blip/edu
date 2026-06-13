/**
 * 管理员 mock 全链路(msw/node + contracts createClient):
 * 重置学生密码拿到明文 · 课程入班(添加/移出)即时反映名单(IMPL2 #1 #2 验收)
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setupServer } from 'msw/node';
import { createClient } from '@qiming/contracts';
import { handlers } from '../handlers';

const server = setupServer(...handlers);
let token: string | null = null;
const api = createClient({
  baseUrl: 'http://localhost/api/v1',
  getToken: () => token,
  fetchImpl: (...args: Parameters<typeof fetch>) => globalThis.fetch(...args),
});

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());
beforeEach(async () => {
  const login = await api.post('/auth/login', { body: { phone: '13800000001', password: 'Admin@123' } });
  token = login.data.accessToken;
});

describe('重置学生密码', () => {
  it('返回非空明文临时密码', async () => {
    const r = await api.post('/admin/students/{id}/reset-password', { params: { id: 5 } });
    expect(typeof r.data.password).toBe('string');
    expect(r.data.password.length).toBeGreaterThanOrEqual(6);
  });
  it('未知学生 → 4040', async () => {
    await expect(api.post('/admin/students/{id}/reset-password', { params: { id: 99999 } }))
      .rejects.toMatchObject({ code: 4040 });
  });
});

describe('课程入班(添加/移出)', () => {
  it('添加 → 名单出现该生;移出 → 名单恢复', async () => {
    const before = (await api.get('/admin/courses/{id}/roster', { params: { id: 2 } })).data;
    expect(before.some((r) => r.studentId === 5)).toBe(false);

    await api.post('/admin/courses/{id}/students', { params: { id: 2 }, body: { studentIds: [5] } });
    const added = (await api.get('/admin/courses/{id}/roster', { params: { id: 2 } })).data;
    expect(added.some((r) => r.studentId === 5)).toBe(true);
    expect(added.length).toBe(before.length + 1);

    await api.del('/admin/courses/{id}/students/{studentId}', { params: { id: 2, studentId: 5 } });
    const removed = (await api.get('/admin/courses/{id}/roster', { params: { id: 2 } })).data;
    expect(removed.some((r) => r.studentId === 5)).toBe(false);
    expect(removed.length).toBe(before.length);
  });

  it('重复添加幂等(不产生重复行)', async () => {
    await api.post('/admin/courses/{id}/students', { params: { id: 2 }, body: { studentIds: [6, 6] } });
    const roster = (await api.get('/admin/courses/{id}/roster', { params: { id: 2 } })).data;
    expect(roster.filter((r) => r.studentId === 6)).toHaveLength(1);
    // 清理,避免污染后续断言
    await api.del('/admin/courses/{id}/students/{studentId}', { params: { id: 2, studentId: 6 } });
  });
});
