/**
 * AI 接口管理 mock 数据层(msw/node + contracts createClient):
 * 取数渲染 · 保存调对端点 · 真假开关映射 · 测试连接。
 * 覆盖页面对 GET/PUT /admin/ai/config、GET/PUT /admin/ai/routes、POST /admin/ai/test 的契约用法。
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

describe('供应商配置 GET/PUT', () => {
  it('GET 回脱敏 key + 生效来源', async () => {
    const r = await api.get('/admin/ai/config');
    expect(r.data.apiKeyMasked).toMatch(/\*\*\*\*/); // 绝不回明文
    expect(r.data.apiKeyMasked).not.toMatch(/sk-live|sk-real/);
    expect(['runtime', 'env']).toContain(r.data.source);
    expect(typeof r.data.baseUrl).toBe('string');
    expect(typeof r.data.concurrency).toBe('number');
  });

  it('PUT 改 baseUrl/model/concurrency 后重新 GET 可见,且来源转 runtime', async () => {
    await api.put('/admin/ai/config', {
      body: { baseUrl: 'https://api.test.local/v1', model: 'test-model', concurrency: 16 },
    });
    const after = await api.get('/admin/ai/config');
    expect(after.data.baseUrl).toBe('https://api.test.local/v1');
    expect(after.data.model).toBe('test-model');
    expect(after.data.concurrency).toBe(16);
    expect(after.data.source).toBe('runtime');
  });

  it('PUT 给了 apiKey → 脱敏串更新且仍不含明文;留空 → 保留旧脱敏串', async () => {
    const before = (await api.get('/admin/ai/config')).data.apiKeyMasked;

    // 留空(不传 apiKey):脱敏串不变
    await api.put('/admin/ai/config', { body: { baseUrl: 'https://a/v1', model: 'm', concurrency: 8 } });
    expect((await api.get('/admin/ai/config')).data.apiKeyMasked).toBe(before);

    // 给新 key:脱敏串变化、不回明文、末尾对应新 key 尾段
    await api.put('/admin/ai/config', { body: { baseUrl: 'https://a/v1', model: 'm', concurrency: 8, apiKey: 'sk-abc123def456ZZZZZ' } });
    const masked = (await api.get('/admin/ai/config')).data.apiKeyMasked;
    expect(masked).not.toContain('sk-abc123def456ZZZZZ');
    expect(masked).toMatch(/\*\*\*\*/);
    expect(masked.endsWith('ZZZZZ')).toBe(true);
  });
});

describe('功能真假路由 GET/PUT', () => {
  it('GET 四功能均为 real|mock', async () => {
    const r = await api.get('/admin/ai/routes');
    for (const key of ['qa', 'pre_grading', 'class_companion', 'diagnosis'] as const) {
      expect(['real', 'mock']).toContain(r.data[key]);
    }
  });

  it('PUT 开关映射 real↔mock 后重新 GET 一致', async () => {
    const cur = (await api.get('/admin/ai/routes')).data;
    // 模拟页面把 diagnosis 打开为 real、qa 关为 mock
    const next = { ...cur, diagnosis: 'real' as const, qa: 'mock' as const };
    await api.put('/admin/ai/routes', { body: next });
    const after = (await api.get('/admin/ai/routes')).data;
    expect(after.diagnosis).toBe('real');
    expect(after.qa).toBe('mock');
    expect(after.pre_grading).toBe(cur.pre_grading);
  });
});

describe('测试连接 POST', () => {
  it('返回 ok + 延迟 + 回文', async () => {
    const r = await api.post('/admin/ai/test', { body: {} });
    expect(r.data.ok).toBe(true);
    expect(typeof r.data.latencyMs).toBe('number');
    expect(r.data.sample).toBe('ok');
    expect(r.data.error).toBeNull();
  });
});
