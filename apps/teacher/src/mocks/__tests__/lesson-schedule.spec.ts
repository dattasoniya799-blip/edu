/**
 * 讲次排期 mock 全链路(msw/node + contracts createClient):
 * 「我的课程」设置/调整上课时间 → PUT /lessons/{id}(scheduledStart/scheduledEnd)读回往返;
 * 400 口径同 A4 服务端(合并现值后 start 必须早于 end)。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupServer } from 'msw/node';
import type { LessonDto } from '@qiming/contracts';
import { createClient } from '@qiming/contracts';
import { handlers } from '../handlers';
import { schedulePayload, scheduleFormFrom } from '../../pages/course/lib/schedule';

const server = setupServer(...handlers);
let token: string | null = null;
const api = createClient({
  baseUrl: 'http://localhost/api/v1',
  getToken: () => token,
  fetchImpl: (...args: Parameters<typeof fetch>) => globalThis.fetch(...args),
});

const LESSON = 5; // seed 中未结课 draft 讲次

beforeAll(async () => {
  server.listen({ onUnhandledRequest: 'error' });
  const login = await api.post('/auth/login', { body: { phone: '13800000002', password: 'Teacher@123' } });
  token = login.data.accessToken;
});
afterAll(() => server.close());

async function getLesson(): Promise<LessonDto> {
  return (await api.get('/lessons/{id}', { params: { id: LESSON } })).data as LessonDto;
}

describe('讲次排期(PUT /lessons/{id} scheduledStart/scheduledEnd)', () => {
  it('设置标题与起止时间后可读回,且与表单往返一致', async () => {
    const body = schedulePayload({ title: '一次函数与方程、不等式(改)', date: '2026-07-18', start: '09:30', end: '11:30' });
    await api.put('/lessons/{id}', { params: { id: LESSON }, body });

    const after = await getLesson();
    expect(after.title).toBe('一次函数与方程、不等式(改)');
    expect(after.scheduledStart).toBe(body.scheduledStart);
    expect(after.scheduledEnd).toBe(body.scheduledEnd);
    // 读回讲次再拆表单 = 原输入(调整时间时预填正确)
    expect(scheduleFormFrom(after)).toEqual({
      title: '一次函数与方程、不等式(改)', date: '2026-07-18', start: '09:30', end: '11:30',
    });
  });

  it('结束不晚于开始 → 400 拒绝且不落库', async () => {
    const before = await getLesson();
    // schedulePayload 不做先后校验(由 validateSchedule 承担),这里构造非法 body 验证 mock 的服务端口径
    const bad = schedulePayload({ title: before.title, date: '2026-07-18', start: '11:30', end: '09:30' });
    await expect(
      api.put('/lessons/{id}', { params: { id: LESSON }, body: bad }),
    ).rejects.toThrow('scheduledStart 必须早于 scheduledEnd');

    const after = await getLesson();
    expect(after.scheduledStart).toBe(before.scheduledStart);
    expect(after.scheduledEnd).toBe(before.scheduledEnd);
  });

  it('只传其一时与现值合并校验(仅改开始时间到结束之后 → 400)', async () => {
    const before = await getLesson();
    const lateStart = new Date(new Date(before.scheduledEnd as string).getTime() + 3600e3).toISOString();
    await expect(
      api.put('/lessons/{id}', { params: { id: LESSON }, body: { scheduledStart: lateStart } }),
    ).rejects.toThrow('scheduledStart 必须早于 scheduledEnd');
  });
});
