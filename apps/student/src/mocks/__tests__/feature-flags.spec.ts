/**
 * 内测区与功能分级(E1)· 学生侧 mock 数据层:
 * photo_pregrade 默认 off → /features/my 对学生下发空表;切 beta 后按白名单下发。
 * 另断言讲次时间线报文已不含 mock 自造的 resources 字段(「回看课件」入口连同该字段一并删除)。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setupServer } from 'msw/node';
import { createClient } from '@qiming/contracts';
import { handlers } from '../handlers';
import * as D from '../data';
import * as F from '../features';

const server = setupServer(...handlers);
let token: string | null = null;
const api = createClient({
  baseUrl: 'http://localhost/api/v1',
  getToken: () => token,
  fetchImpl: (...args: Parameters<typeof fetch>) => globalThis.fetch(...args),
});

beforeAll(async () => {
  server.listen({ onUnhandledRequest: 'error' });
  const r = await api.post('/auth/student/login', { body: { studentNo: 'S-0001', password: 'Student@123' } });
  token = r.data.accessToken;
});
afterAll(() => server.close());
beforeEach(() => F.resetFeatures());

const myFeatures = async () => (await api.get('/features/my')).data.features;

describe('拍照预批门禁(photo_pregrade)', () => {
  it('默认 off → 学生拿到空目录(作业流里不出现任何预批展示)', async () => {
    expect(await myFeatures()).toEqual([]);
  });

  it('切 beta 但不在白名单 → 仍不下发', async () => {
    F.featureStages.photo_pregrade = 'beta';
    expect(await myFeatures()).toEqual([]);
  });

  it('切 beta 且在白名单 → 下发,stage=beta', async () => {
    F.featureStages.photo_pregrade = 'beta';
    F.featureWhitelist.photo_pregrade = [D.ME_STUDENT.id];
    const list = await myFeatures();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ key: 'photo_pregrade', name: '拍照预批', stage: 'beta' });
  });

  it('教师向的 ai_courseware 不会漏给学生', async () => {
    F.featureStages.ai_courseware = 'ga';
    expect((await myFeatures()).some((f) => f.key === 'ai_courseware')).toBe(false);
  });
});

describe('讲次时间线报文', () => {
  it('不再带 mock 自造的 resources 字段(契约本无此字段)', async () => {
    const timeline = (await api.get('/student/courses/{id}/lessons', { params: { id: 1 } })).data as unknown[];
    expect(timeline.length).toBeGreaterThan(0);
    for (const item of timeline) {
      expect(Object.keys(item as object)).toEqual(['lesson', 'myHomework', 'sessionId']);
    }
  });
});
