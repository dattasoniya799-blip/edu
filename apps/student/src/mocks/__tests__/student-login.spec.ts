/**
 * 学生学号 + 密码登录(新契约 /auth/student/login):
 * 正确学号密码 → 拿到 token + me;错误密码 / 未知学号 → 4010;token 可访问 /me
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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

describe('学生密码登录', () => {
  it('学号 + 正确密码 → 签发 token,me.role=student', async () => {
    const r = await api.post('/auth/student/login', { body: { studentNo: 'S-0001', password: 'Student@123' } });
    expect(r.data.me.role).toBe('student');
    expect(r.data.me.name).toBe('林小满');
    expect(r.data.accessToken).toBeTruthy();
    token = r.data.accessToken;
    const me = await api.get('/me');
    expect(me.data.id).toBe(r.data.me.id);
  });

  it('密码错误 → 4010', async () => {
    await expect(api.post('/auth/student/login', { body: { studentNo: 'S-0001', password: 'wrong' } }))
      .rejects.toMatchObject({ code: 4010 });
  });

  it('未知学号 → 4010', async () => {
    await expect(api.post('/auth/student/login', { body: { studentNo: 'S-9999', password: 'Student@123' } }))
      .rejects.toMatchObject({ code: 4010 });
  });
});
