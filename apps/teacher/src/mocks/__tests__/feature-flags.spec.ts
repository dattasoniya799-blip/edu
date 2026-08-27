/**
 * 内测区与功能分级(E1)mock 数据层:
 * /features/my 下发口径(beta 白名单内外 / off / ga 按角色)· courseware 端点硬门禁 403+4701 ·
 * 管理端改阶段与白名单(replace)后目录随之变化。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setupServer } from 'msw/node';
import { ApiError, ERROR_CODES, createClient } from '@qiming/contracts';
import type { MyFeatureDto } from '@qiming/contracts';
import { handlers } from '../handlers';
import * as F from '../features';

const server = setupServer(...handlers);
let token: string | null = null;
const api = createClient({
  baseUrl: 'http://localhost/api/v1',
  getToken: () => token,
  fetchImpl: (...args: Parameters<typeof fetch>) => globalThis.fetch(...args),
});

const loginAs = async (phone: string) => {
  const r = await api.post('/auth/login', { body: { phone, password: 'Teacher@123' } });
  token = r.data.accessToken;
};

beforeAll(async () => {
  server.listen({ onUnhandledRequest: 'error' });
  await loginAs('13800000002'); // 演示教师张明(预置在 ai_courseware 白名单)
});
afterAll(() => server.close());
beforeEach(() => F.resetFeatures());

const myFeatures = async (): Promise<MyFeatureDto[]> => (await api.get('/features/my')).data.features;

describe('GET /features/my 下发口径', () => {
  it('beta + 白名单内 → 下发 ai_courseware(含名称与说明)', async () => {
    const list = await myFeatures();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ key: 'ai_courseware', name: 'AI 生成课件', stage: 'beta' });
    expect(list[0].description).toContain('逐页生图');
  });

  it('photo_pregrade=off → 任何角色都拿不到(学生也不出现)', async () => {
    expect((await myFeatures()).some((f) => f.key === 'photo_pregrade')).toBe(false);
    const stu = await api.post('/auth/student/login', { body: { studentNo: 'S-0001', password: 'Student@123' } });
    const before = token;
    token = stu.data.accessToken;
    expect(await myFeatures()).toEqual([]);
    token = before;
  });

  it('beta + 白名单外 → 不下发', async () => {
    F.featureWhitelist.ai_courseware = [];
    expect(await myFeatures()).toEqual([]);
  });

  it('切 ga → 角色匹配即全量下发(不再看白名单)', async () => {
    F.featureWhitelist.ai_courseware = [];
    F.featureStages.ai_courseware = 'ga';
    const list = await myFeatures();
    expect(list.map((f) => f.key)).toEqual(['ai_courseware']);
    expect(list[0].stage).toBe('ga');
  });

  it('切 off → 白名单内也不下发', async () => {
    F.featureStages.ai_courseware = 'off';
    expect(await myFeatures()).toEqual([]);
  });
});

describe('courseware 端点硬门禁(UI 隐藏不是安全边界)', () => {
  const outline = () =>
    api.post('/courseware/outline', { body: { sourceText: '一次函数的图象平移', style: { id: 'clean' } } });

  it('白名单内 → 放行', async () => {
    await expect(outline()).resolves.toBeDefined();
  });

  it('白名单外 → 403 + 4701 + detail.key', async () => {
    F.featureWhitelist.ai_courseware = [];
    await expect(outline()).rejects.toMatchObject({
      code: ERROR_CODES.FEATURE_NOT_ENABLED,
      httpStatus: 403,
      detail: { key: 'ai_courseware' },
    });
  });

  it('四个端点一致拦截(轮询/重试/建任务也不放过)', async () => {
    F.featureStages.ai_courseware = 'off';
    const calls = [
      outline(),
      api.post('/courseware/jobs', { body: { name: 'x', style: { id: 'clean' }, pages: [] } }),
      api.get('/courseware/jobs/{jobId}', { params: { jobId: 'nope' } }),
      api.post('/courseware/jobs/{jobId}/retry', { params: { jobId: 'nope' } }),
    ];
    for (const call of calls) {
      await expect(call).rejects.toSatisfy(
        (e: unknown) => e instanceof ApiError && e.code === ERROR_CODES.FEATURE_NOT_ENABLED,
      );
    }
  });
});

describe('管理端目录与改动', () => {
  beforeAll(async () => {
    const r = await api.post('/auth/login', { body: { phone: '13800000001', password: 'Admin@123' } });
    token = r.data.accessToken;
  });

  it('GET /admin/features:目录全量 + 当前阶段 + 白名单 + 登记说明', async () => {
    const list = (await api.get('/admin/features')).data;
    expect(list.map((f) => f.key)).toEqual(['ai_courseware', 'photo_pregrade']);
    const cw = list[0];
    expect(cw).toMatchObject({ audienceRole: 'teacher', defaultStage: 'beta', stage: 'beta' });
    expect(cw.whitelist).toEqual([{ userId: 2, name: '张明', role: 'teacher' }]);
    expect(cw.knownIssues.length).toBeGreaterThan(0);
    expect(cw.acceptance.length).toBeGreaterThan(0);
    expect(list[1]).toMatchObject({ audienceRole: 'student', stage: 'off' });
  });

  it('PUT 阶段:未知 key 404,非法取值 400,合法即生效', async () => {
    await expect(api.put('/admin/features/{key}', { params: { key: 'nope' }, body: { stage: 'ga' } }))
      .rejects.toMatchObject({ code: 4040 });
    await expect(api.put('/admin/features/{key}', {
      params: { key: 'photo_pregrade' },
      body: { stage: 'wat' as never },
    })).rejects.toMatchObject({ code: 4000 });

    await api.put('/admin/features/{key}', { params: { key: 'photo_pregrade' }, body: { stage: 'beta' } });
    const list = (await api.get('/admin/features')).data;
    expect(list.find((f) => f.key === 'photo_pregrade')?.stage).toBe('beta');
  });

  it('PUT 白名单是 replace 语义:整表覆写,空数组即清空', async () => {
    await api.put('/admin/features/{key}/whitelist', {
      params: { key: 'ai_courseware' },
      body: { userIds: [3] },
    });
    let cw = (await api.get('/admin/features')).data.find((f) => f.key === 'ai_courseware')!;
    expect(cw.whitelist).toEqual([{ userId: 3, name: '李雯', role: 'teacher' }]); // 原来的张明被覆盖掉

    await api.put('/admin/features/{key}/whitelist', { params: { key: 'ai_courseware' }, body: { userIds: [] } });
    cw = (await api.get('/admin/features')).data.find((f) => f.key === 'ai_courseware')!;
    expect(cw.whitelist).toEqual([]);
  });
});
