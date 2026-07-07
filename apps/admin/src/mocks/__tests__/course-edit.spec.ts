/**
 * 编辑课程 mock 全链路(msw/node + contracts createClient):
 * 「课程与班级 · 编辑课程」→ PUT /admin/courses/{id}(含调总讲次数 = 追加/缩减讲次的排课路径)
 * → 列表读回反映修改;404 口径同 A2 服务端。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupServer } from 'msw/node';
import type { CourseDto } from '@qiming/contracts';
import { createClient } from '@qiming/contracts';
import { handlers } from '../handlers';

const server = setupServer(...handlers);
let token: string | null = null;
const api = createClient({
  baseUrl: 'http://localhost/api/v1',
  getToken: () => token,
  fetchImpl: (...args: Parameters<typeof fetch>) => globalThis.fetch(...args),
});

beforeAll(async () => {
  server.listen({ onUnhandledRequest: 'error' });
  const login = await api.post('/auth/login', { body: { phone: '13800000001', password: 'Admin@123' } });
  token = login.data.accessToken;
});
afterAll(() => server.close());

async function findCourse(id: number): Promise<CourseDto | undefined> {
  const r = await api.get('/admin/courses', { query: { page: 1, size: 50 } });
  return (r.data.items as CourseDto[]).find((c) => c.id === id);
}

describe('编辑课程(PUT /admin/courses/{id})', () => {
  it('改名 + 调大总讲次(追加讲次)+ 换教师,列表读回一致', async () => {
    const before = await findCourse(1);
    expect(before).toBeTruthy();
    await api.put('/admin/courses/{id}', {
      params: { id: 1 },
      body: {
        name: '初二数学提高班(秋季续报)', classType: before!.classType, subject: before!.subject,
        stage: before!.stage, teacherId: 3, totalLessons: before!.totalLessons + 5,
      },
    });
    const after = await findCourse(1);
    expect(after?.name).toBe('初二数学提高班(秋季续报)');
    expect(after?.totalLessons).toBe(before!.totalLessons + 5);
    expect(after?.teacherName).toBe('李雯');
  });

  it('课程不存在 → 404', async () => {
    await expect(api.put('/admin/courses/{id}', {
      params: { id: 999 },
      body: { name: 'x', classType: 'group', subject: '数学', stage: '初中', teacherId: 2, totalLessons: 10 },
    })).rejects.toThrow('课程不存在');
  });

  it('教师不存在 → 404 且不落库', async () => {
    const before = await findCourse(1);
    await expect(api.put('/admin/courses/{id}', {
      params: { id: 1 },
      body: { name: '不应生效', classType: 'group', subject: '数学', stage: '初中', teacherId: 999, totalLessons: 10 },
    })).rejects.toThrow('教师不存在');
    const after = await findCourse(1);
    expect(after?.name).toBe(before!.name);
  });
});
