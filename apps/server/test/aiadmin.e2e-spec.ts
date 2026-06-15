/**
 * 验收覆盖(AI 接口管理 · admin 运行态):
 * - GET /admin/ai/config:无运行态/无 env key → source='env'、apiKeyMasked='';角色门禁 admin。
 * - POST /admin/ai/test:测试环境无真实 key → 返回结构化 {ok:false,error}(不抛 500);
 *   运行态指向不可达上游 → 同样结构化失败(网络错被捕获)。
 * - PUT /admin/ai/config:写运行态 → GET source='runtime'、key 脱敏、并发闸 max 同步;
 *   apiKey 留空 → 旧 key 保留(再 GET 仍脱敏、source=runtime),并发可更新。
 * - PUT /admin/ai/routes:逐功能切 real/mock → GET 反映;Redis 覆盖键形状正确
 *   (real=openai_compatible+model:env+fallback mock;mock=默认 mock 条目)。
 * - 并发闸 Semaphore:acquire/release/setMax 行为正确(纯单元)。
 * 隔离纪律:运行态键 a7:ai:provider / a7:ai:routes(全局一把),测试自清。
 */
import { INestApplication } from '@nestjs/common';
import Redis from 'ioredis';
import request from 'supertest';
import { LlmGatewayService } from '../src/ai/llm/llm-gateway.service';
import { PROVIDER_CONFIG_KEY } from '../src/ai/llm/providers/openai-compatible.provider';
import { ROUTES_OVERRIDE_KEY } from '../src/ai/llm/route-table.service';
import { Semaphore } from '../src/ai/llm/semaphore';
import { createApp, createOrg2, dropOrg2, raw, type Org2Fixture } from './fixtures/setup';

describe('AI 接口管理:运行态 LLM 配置 + 真假路由 + 测试连接(admin)', () => {
  let app: INestApplication;
  let http: any;
  let fx: Org2Fixture;
  let admin: string;
  let teacher: string;
  let redis: Redis;

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const REAL_KEY = 'sk-realkeyABCD1234';

  async function cleanupKeys() {
    await redis.del(PROVIDER_CONFIG_KEY, ROUTES_OVERRIDE_KEY);
  }

  beforeAll(async () => {
    // 测试环境保证无真实 key(env 兜底口径为空、固定 base);ConfigService.get 先读 process.env,
    // 故"置空串"而非 delete —— 避免回落到被 Prisma 灌入的演示 key(见 .env 注释)。
    const env = process.env as Record<string, string | undefined>;
    env.LLM_API_KEY = '';
    env.LLM_BASE_URL = 'https://api.openai.com/v1';
    env.LLM_MODEL = '';
    redis = new Redis(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379');
    await cleanupKeys(); // 防御:上轮残留
    app = await createApp();
    http = app.getHttpServer();
    fx = await createOrg2();

    const login = async (phone: string) => {
      const res = await request(http).post('/api/v1/auth/login').send({ phone, password: fx.password }).expect(200);
      return res.body.data.accessToken as string;
    };
    admin = await login(fx.adminPhone);
    teacher = await login(fx.teacherPhone);
  });

  afterAll(async () => {
    await app.close();
    await dropOrg2(fx.orgId);
    await cleanupKeys();
    await redis.quit();
    await raw.$disconnect();
  });

  // ================= 角色门禁 =================
  it('门禁:teacher 读 /admin/ai/config → 403', async () => {
    await request(http).get('/api/v1/admin/ai/config').set(auth(teacher)).expect(403);
  });

  // ================= GET config(env 兜底) =================
  it('GET config:无运行态/无 env key → source=env、apiKeyMasked 为空、默认并发 8', async () => {
    const res = await request(http).get('/api/v1/admin/ai/config').set(auth(admin)).expect(200);
    const d = res.body.data;
    expect(d.source).toBe('env');
    expect(d.apiKeyMasked).toBe('');
    expect(d.concurrency).toBe(8);
    expect(d.baseUrl).toBe('https://api.openai.com/v1');
    expect(d.model).toBe('');
  });

  // ================= POST test(无 key → 结构化失败,不抛 500) =================
  it('POST test:无配置 key → {ok:false,error},绝不 500', async () => {
    const res = await request(http).post('/api/v1/admin/ai/test').set(auth(admin)).send({}).expect(200);
    const d = res.body.data;
    expect(d.ok).toBe(false);
    expect(typeof d.error).toBe('string');
    expect(d.error).toContain('未配置');
    expect(d.sample).toBeNull();
    expect(typeof d.latencyMs).toBe('number');
  });

  // ================= PUT config → runtime + 脱敏 + 并发闸 =================
  it('PUT config:写运行态 → GET source=runtime、key 脱敏(绝不明文)、并发闸 max 同步', async () => {
    await request(http)
      .put('/api/v1/admin/ai/config')
      .set(auth(admin))
      .send({ baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat', apiKey: REAL_KEY, concurrency: 12 })
      .expect(200);

    const res = await request(http).get('/api/v1/admin/ai/config').set(auth(admin)).expect(200);
    const d = res.body.data;
    expect(d.source).toBe('runtime');
    expect(d.baseUrl).toBe('https://api.deepseek.com');
    expect(d.model).toBe('deepseek-chat');
    expect(d.concurrency).toBe(12);
    // 脱敏:前缀+****+后4位,且绝不回明文/中段
    expect(d.apiKeyMasked).toBe('sk-****1234');
    expect(d.apiKeyMasked).not.toBe(REAL_KEY);
    expect(d.apiKeyMasked).not.toContain('realkey');

    // 并发闸 max 同步更新到网关单例
    expect(app.get(LlmGatewayService).concurrencyMax()).toBe(12);
    // 审计落库
    const log = await raw.auditLog.findFirst({ where: { orgId: fx.orgId, action: 'admin.ai_config.update' }, orderBy: { id: 'desc' } });
    expect(log).not.toBeNull();
  });

  // ================= PUT config apiKey 留空 → 旧 key 保留 =================
  it('PUT config:apiKey 留空 → 旧 key 保留(再 GET 仍脱敏、source=runtime),并发可更新', async () => {
    await request(http)
      .put('/api/v1/admin/ai/config')
      .set(auth(admin))
      .send({ baseUrl: 'https://api.deepseek.com/v2', model: 'deepseek-chat', concurrency: 6 })
      .expect(200);

    const res = await request(http).get('/api/v1/admin/ai/config').set(auth(admin)).expect(200);
    const d = res.body.data;
    expect(d.source).toBe('runtime');
    expect(d.baseUrl).toBe('https://api.deepseek.com/v2');
    expect(d.concurrency).toBe(6);
    expect(d.apiKeyMasked).toBe('sk-****1234'); // 旧 key 仍在

    // 底层运行态 JSON 仍保有原始明文 key(未被空覆盖)
    const rawCfg = JSON.parse((await redis.get(PROVIDER_CONFIG_KEY))!);
    expect(rawCfg.apiKey).toBe(REAL_KEY);
    expect(app.get(LlmGatewayService).concurrencyMax()).toBe(6);
  });

  // ================= POST test(运行态指向不可达上游 → 结构化网络失败) =================
  it('POST test:运行态指向不可达上游 → {ok:false,error}(网络错被捕获,不抛 500)', async () => {
    await request(http)
      .put('/api/v1/admin/ai/config')
      .set(auth(admin))
      .send({ baseUrl: 'http://127.0.0.1:9/v1', model: 'x', apiKey: 'sk-fakefakefake1234', concurrency: 4 })
      .expect(200);

    const res = await request(http).post('/api/v1/admin/ai/test').set(auth(admin)).send({ feature: 'qa' }).expect(200);
    const d = res.body.data;
    expect(d.ok).toBe(false);
    expect(typeof d.error).toBe('string');
    expect(d.error.length).toBeGreaterThan(0);
    expect(d.sample).toBeNull();
    expect(d.latencyMs).toBeGreaterThanOrEqual(0);
  });

  // ================= PUT routes real/mock → GET 反映 + 覆盖键形状 =================
  it('PUT routes:逐功能切 real/mock → GET 反映,且 Redis 覆盖键形状正确', async () => {
    await request(http)
      .put('/api/v1/admin/ai/routes')
      .set(auth(admin))
      .send({ qa: 'real', pre_grading: 'mock', class_companion: 'real', diagnosis: 'mock' })
      .expect(200);

    const res = await request(http).get('/api/v1/admin/ai/routes').set(auth(admin)).expect(200);
    expect(res.body.data).toEqual({ qa: 'real', pre_grading: 'mock', class_companion: 'real', diagnosis: 'mock' });

    const override = JSON.parse((await redis.get(ROUTES_OVERRIDE_KEY))!);
    // real → openai_compatible + model:env + fallback 回该 feature 的 mock 模型
    expect(override.routes.qa).toEqual({
      provider: 'openai_compatible',
      model: 'env',
      fallback: { provider: 'mock', model: 'mock-chat-v1' },
    });
    expect(override.routes.class_companion).toEqual({
      provider: 'openai_compatible',
      model: 'env',
      fallback: { provider: 'mock', model: 'mock-chat-mini' },
    });
    // mock → 默认 mock 条目(pre_grading 无 fallback)
    expect(override.routes.pre_grading).toEqual({ provider: 'mock', model: 'mock-grader-v1', fallback: null });

    // 审计落库
    const log = await raw.auditLog.findFirst({ where: { orgId: fx.orgId, action: 'admin.ai_routes.update' }, orderBy: { id: 'desc' } });
    expect(log).not.toBeNull();
  });

  it('PUT routes:全切回 mock → GET 全 mock', async () => {
    await request(http)
      .put('/api/v1/admin/ai/routes')
      .set(auth(admin))
      .send({ qa: 'mock', pre_grading: 'mock', class_companion: 'mock', diagnosis: 'mock' })
      .expect(200);
    const res = await request(http).get('/api/v1/admin/ai/routes').set(auth(admin)).expect(200);
    expect(res.body.data).toEqual({ qa: 'mock', pre_grading: 'mock', class_companion: 'mock', diagnosis: 'mock' });
  });

  // ================= 并发闸 Semaphore(纯单元) =================
  it('Semaphore:超过 max 的 acquire 阻塞,release/扩容后放行,FIFO', async () => {
    const sem = new Semaphore(2);
    await sem.acquire(); // 1
    await sem.acquire(); // 2(满)
    expect(sem.inFlight()).toBe(2);

    let third = false;
    const p3 = sem.acquire().then(() => { third = true; });
    await new Promise((r) => setTimeout(r, 20));
    expect(third).toBe(false); // 仍阻塞

    sem.release(); // 放行第 3 个
    await p3;
    expect(third).toBe(true);
    expect(sem.inFlight()).toBe(2);

    // 扩容立即放行新等待者
    let fourth = false;
    const p4 = sem.acquire().then(() => { fourth = true; });
    await new Promise((r) => setTimeout(r, 20));
    expect(fourth).toBe(false);
    sem.setMax(4);
    await p4;
    expect(fourth).toBe(true);

    // setMax 下限保护
    sem.setMax(0);
    expect(sem.getMax()).toBe(1);
  });
});
