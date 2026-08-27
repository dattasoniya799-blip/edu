/**
 * AI 生成课件 e2e([2026-08-22 批准·契约] 4 个 /courseware 端点)。
 *
 * 覆盖:①大纲形状与页数;②自定义风格空描述 400;③mock 路由下建任务 → 轮询 done →
 * 成品落 Resource(type=ppt / meta.pages 完整 / ossKey 归属 resource/{orgId}/)+ 签名 URL 可回读;
 * ④单页失败不中断其他页 + retry 恢复;⑤同机构他教师 / 跨机构 GET job 一律 404(宪法 §7);
 * ⑥student 调 outline 403;⑦ai_calls 记 feature=courseware 的账。
 *
 * 隔离:专属 qiming_cw 库 + 独立 BULLMQ_PREFIX + 手机号 139599 段;运行态键 a7:courseware:*
 * 由 globalTeardown 统一清。生图恒走 mock_image(本套件开头清掉 a7:ai:routes 覆盖并把
 * IMAGE_API_KEY 置为定义态空串 → 默认表 courseware=mock_image),故零网络、确定性。
 */
process.env.IMAGE_API_KEY = '';

import { INestApplication } from '@nestjs/common';
import Redis from 'ioredis';
import request from 'supertest';
import type { CoursewareJobDto, CoursewareOutlinePageDto } from '@qiming/contracts';
import { mockImageFailOnce } from '../src/ai/llm/providers/mock-image.provider';
import { ROUTES_OVERRIDE_KEY } from '../src/ai/llm/route-table.service';
import {
  jobKey,
  jobRateKey,
  outlineRateKey,
  publishLockKey,
  publishRetryKey,
  teacherJobsKey,
  type CoursewareJobPageState,
} from '../src/courseware/courseware.store';
import { createApp, createOrg2, dropOrg2, loginStudentById, raw, type Org2Fixture } from './fixtures/setup';
import { createCwOrg, CW_PASSWORD, dropCwOrg, type CwFixture } from './fixtures/courseware.fixtures';

const SOURCE_TEXT =
  '相似三角形的判定;本节先复习全等三角形,再引出两角相等即相似的判定方法,配一道旗杆测高的例题。';
const STYLE = { id: 'academic_blue' };

describe('AI 生成课件 · 大纲/生图任务/重试/租户隔离([2026-08-22 契约])', () => {
  let app: INestApplication;
  let http: never;
  let redis: Redis;
  let fx: CwFixture;
  let org2: Org2Fixture;
  let t1: string;
  let t2: string;
  let s1: string;
  let other: string;

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const login = async (phone: string, password: string): Promise<string> => {
    const res = await request(http).post('/api/v1/auth/login').send({ phone, password }).expect(200);
    return res.body.data.accessToken as string;
  };

  /** 轮询到满足条件(mock 出图很快,200ms 一轮足够) */
  const pollJob = async (
    token: string,
    jobId: string,
    until: (d: CoursewareJobDto) => boolean,
    timeoutMs = 20_000,
  ): Promise<CoursewareJobDto> => {
    const deadline = Date.now() + timeoutMs;
    let last: CoursewareJobDto | null = null;
    while (Date.now() < deadline) {
      const res = await request(http).get(`/api/v1/courseware/jobs/${jobId}`).set(auth(token)).expect(200);
      last = res.body.data as CoursewareJobDto;
      if (until(last)) return last;
      await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error(`轮询超时,最后一次响应:${JSON.stringify(last)}`);
  };

  /**
   * [2026-08-22 audit-fix-server · P1-10] 建任务前清掉该教师的限流计数与在飞任务集合。
   * 生产口径是 3 次/10 分钟 + 在飞 3 个;本套件一路要建七八个任务,逐用例复位计数器
   * 才能既保留真实限流实现、又让其余用例互不干扰(限流本身有独立用例覆盖)。
   */
  const resetLimits = async (teacherId: bigint) => {
    await redis.del(
      jobRateKey(Number(teacherId)),
      outlineRateKey(Number(teacherId)),
      teacherJobsKey(Number(fx.orgId), Number(teacherId)),
    );
  };

  const createJob = async (token: string, body: Record<string, unknown>): Promise<string> => {
    await resetLimits(fx.t1Id);
    const res = await request(http).post('/api/v1/courseware/jobs').set(auth(token)).send(body).expect(200);
    return res.body.data.jobId as string;
  };

  /** 直接读运行态某页(白盒:验超时折算/条件写等 Redis 侧行为) */
  const readPage = async (jobId: string, seq: number): Promise<CoursewareJobPageState> =>
    JSON.parse((await redis.hget(jobKey(jobId), `p:${seq}`))!) as CoursewareJobPageState;

  const writePage = async (jobId: string, page: CoursewareJobPageState): Promise<void> => {
    await redis.hset(jobKey(jobId), `p:${page.seq}`, JSON.stringify(page));
  };

  const outlinePages = (count: number): CoursewareOutlinePageDto[] =>
    Array.from({ length: count }, (_, i) => ({
      title: `CW 第 ${i + 1} 页 · 相似判定`,
      body: `第一条要点(第 ${i + 1} 页)。\n第二条要点。\n第三条要点。`,
      imagePrompt: `右栏画第 ${i + 1} 页的判定示意图,标出对应角`,
    }));

  beforeAll(async () => {
    redis = new Redis(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379', { maxRetriesPerRequest: 2 });
    // 清掉可能由 aiadmin 套件留下的运行态路由覆盖 → 回落默认表(courseware=mock_image)
    await redis.del(ROUTES_OVERRIDE_KEY);
    mockImageFailOnce.reset();
    app = await createApp();
    http = app.getHttpServer() as never;
    fx = await createCwOrg();
    org2 = await createOrg2();
    // E1 前置:/courseware/* 挂 ai_courseware 门禁(默认 beta=仅白名单)。跨租户教师也须先过
    // 自己机构的 gate,才能验到"跨机构 GET job → 404"的归属语义(而非被 403 挡在门口)。
    await raw.featureFlag.create({ data: { orgId: org2.orgId, key: 'ai_courseware', stage: 'beta' } });
    await raw.featureAccess.create({ data: { orgId: org2.orgId, featureKey: 'ai_courseware', userId: org2.teacherId } });
    t1 = await login(fx.t1Phone, CW_PASSWORD);
    t2 = await login(fx.t2Phone, CW_PASSWORD);
    other = await login(org2.teacherPhone, org2.password);
    s1 = await loginStudentById(http, fx.s1Id);
  });

  afterAll(async () => {
    mockImageFailOnce.reset();
    await app.close();
    await dropCwOrg(fx.orgId);
    await dropOrg2(org2.orgId);
    await redis.quit().catch(() => undefined);
    await raw.$disconnect();
  });

  // ================= ① 大纲 =================
  it('POST /courseware/outline:页数=pageCount,每页 title/body/imagePrompt 齐备(body 为 3~5 条要点)', async () => {
    const res = await request(http)
      .post('/api/v1/courseware/outline')
      .set(auth(t1))
      .send({ sourceText: SOURCE_TEXT, pageCount: 6, style: STYLE, lessonId: Number(fx.lessonId), kpNodeId: Number(fx.kpNodeId) })
      .expect(200);
    const pages = res.body.data.pages as CoursewareOutlinePageDto[];
    expect(pages).toHaveLength(6);
    for (const p of pages) {
      expect(Object.keys(p).sort()).toEqual(['body', 'imagePrompt', 'title']);
      expect(p.title.length).toBeGreaterThan(0);
      expect(p.imagePrompt.length).toBeGreaterThan(0);
      const bullets = p.body.split('\n').filter(Boolean);
      expect(bullets.length).toBeGreaterThanOrEqual(3);
      expect(bullets.length).toBeLessThanOrEqual(5);
    }
    // 知识点上下文进了主题词,末页恒为小结
    expect(pages[0].title).toContain(fx.kpNodeName);
    expect(pages[5].title).toContain('小结');
  });

  it('POST /courseware/outline:pageCount 缺省 → 8 页', async () => {
    const res = await request(http)
      .post('/api/v1/courseware/outline')
      .set(auth(t1))
      .send({ sourceText: SOURCE_TEXT, style: STYLE })
      .expect(200);
    expect((res.body.data.pages as unknown[]).length).toBe(8);
  });

  // ================= ② 入参校验 =================
  it('自定义风格空描述 → 400(空串与纯空白都拦)', async () => {
    await request(http)
      .post('/api/v1/courseware/outline')
      .set(auth(t1))
      .send({ sourceText: SOURCE_TEXT, style: { id: 'custom' } })
      .expect(400);
    await request(http)
      .post('/api/v1/courseware/outline')
      .set(auth(t1))
      .send({ sourceText: SOURCE_TEXT, style: { id: 'custom', customText: '   ' } })
      .expect(400);
    await request(http)
      .post('/api/v1/courseware/jobs')
      .set(auth(t1))
      .send({ name: 'CW 自定义风格', style: { id: 'custom', customText: '' }, pages: outlinePages(2) })
      .expect(400);
    // 自定义风格给了描述 → 放行
    await request(http)
      .post('/api/v1/courseware/outline')
      .set(auth(t1))
      .send({ sourceText: SOURCE_TEXT, style: { id: 'custom', customText: '暖色手绘、圆角、木质纹理' } })
      .expect(200);
  });

  it('建任务入参:name 空 / pages 空 / pages 超 20 页 → 400', async () => {
    const base = { style: STYLE };
    await request(http).post('/api/v1/courseware/jobs').set(auth(t1))
      .send({ ...base, name: '  ', pages: outlinePages(2) }).expect(400);
    await request(http).post('/api/v1/courseware/jobs').set(auth(t1))
      .send({ ...base, name: 'CW 空页', pages: [] }).expect(400);
    await request(http).post('/api/v1/courseware/jobs').set(auth(t1))
      .send({ ...base, name: 'CW 超页', pages: outlinePages(21) }).expect(400);
  });

  // ================= ③ 全流程 =================
  it('建任务 → 轮询 done → 成品落 Resource(type=ppt / meta.pages 完整 / ossKey 归属本机构)', async () => {
    const jobId = await createJob(t1, {
      name: 'CW · 相似三角形的判定',
      style: STYLE,
      lessonId: Number(fx.lessonId),
      kpNodeId: Number(fx.kpNodeId),
      pages: outlinePages(3),
    });
    expect(jobId).toMatch(/^[a-f0-9]{24}$/);

    const done = await pollJob(t1, jobId, (d) => d.status === 'done' || d.status === 'failed');
    expect(done.status).toBe('done');
    expect(done.jobId).toBe(jobId); // 契约要求出参带 jobId(teacher mock 曾漏)
    expect(done.total).toBe(3);
    expect(done.done).toBe(3);
    expect(done.pages.map((p) => p.seq)).toEqual([1, 2, 3]);
    expect(done.pages.every((p) => p.status === 'done' && !!p.imageUrl)).toBe(true);
    expect(done.resourceId).toBeGreaterThan(0);

    // 落库成品
    const resource = await raw.resource.findFirst({ where: { orgId: fx.orgId, id: BigInt(done.resourceId!) } });
    expect(resource).not.toBeNull();
    expect(resource!.type).toBe('ppt');
    expect(resource!.name).toBe('CW · 相似三角形的判定');
    expect(resource!.ownerId).toBe(fx.t1Id);
    expect(resource!.kpNodeId).toBe(fx.kpNodeId);
    expect(Number(resource!.size)).toBeGreaterThan(0);
    expect(resource!.ossKey.startsWith(`resource/${Number(fx.orgId)}/`)).toBe(true);

    const meta = resource!.meta as {
      kind: string; styleId: string; styleName: string;
      pages: { seq: number; title: string; body: string; imageOssKey: string }[];
    };
    expect(meta.kind).toBe('ai_courseware');
    expect(meta.styleId).toBe('academic_blue');
    expect(meta.styleName).toBe('清爽学院蓝');
    expect(meta.pages).toHaveLength(3);
    expect(meta.pages.map((p) => p.seq)).toEqual([1, 2, 3]);
    for (const p of meta.pages) {
      expect(p.title.length).toBeGreaterThan(0);
      expect(p.body.length).toBeGreaterThan(0);
      expect(p.imageOssKey.startsWith(`resource/${Number(fx.orgId)}/`)).toBe(true);
      expect(p.imageOssKey.endsWith('.png')).toBe(true);
    }
    expect(meta.pages[0].imageOssKey).toBe(resource!.ossKey); // 封面 = 第 1 页

    // 签名 URL 可回读,且落盘的确是合法 PNG 字节
    const url = new URL(done.pages[0].imageUrl!);
    const file = await request(http).get(`${url.pathname}${url.search}`).expect(200);
    expect(file.body.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  }, 30_000);

  // ================= ⑦ 计量 =================
  // [2026-08-22 audit-fix-server · P2-26] 原先直接对本 org 全部 courseware 计量行断言
  // `every(status==='ok')`,依赖它排在失败注入用例**之前**;调换顺序或开随机化就会挂。
  // 改为本用例自建一个 job,只对「本次调用产生的行」(id 大于建任务前的水位)断言。
  it('ai_calls 记了 feature=courseware 的账(逐页一条,provider=mock_image,带 lessonId 归因)', async () => {
    const before = await raw.aiCall.aggregate({ where: { orgId: fx.orgId }, _max: { id: true } });
    const watermark = before._max.id ?? BigInt(0);

    const jobId = await createJob(t1, {
      name: 'CW · 计量归因',
      style: STYLE,
      lessonId: Number(fx.lessonId),
      pages: outlinePages(2),
    });
    const done = await pollJob(t1, jobId, (d) => d.status === 'done' || d.status === 'failed');
    expect(done.status).toBe('done');

    const calls = await raw.aiCall.findMany({
      where: { orgId: fx.orgId, feature: 'courseware', id: { gt: watermark } },
    });
    expect(calls).toHaveLength(2);
    expect(calls.every((c) => c.provider === 'mock_image' && c.model === 'mock-image-v1')).toBe(true);
    expect(calls.every((c) => c.status === 'ok' && c.tokensIn > 0)).toBe(true);
    expect(calls.every((c) => c.userId === fx.t1Id)).toBe(true);
    // [P2-19] 生图这步也带讲次归因(此前只有 outline 那步传了 lessonId)
    expect(calls.every((c) => c.lessonId === fx.lessonId)).toBe(true);
  }, 30_000);

  // ================= ④ 单页失败 + 重试 =================
  it('单页失败不中断其他页,retry 后恢复并落库成品', async () => {
    mockImageFailOnce.reset();
    mockImageFailOnce.arm(2); // 第 2 页首次生图抛错,重试即成功
    const jobId = await createJob(t1, { name: 'CW · 失败重试', style: STYLE, pages: outlinePages(3) });

    const failed = await pollJob(t1, jobId, (d) => d.status === 'failed' || d.status === 'done');
    expect(failed.status).toBe('failed');
    expect(failed.done).toBe(2);
    expect(failed.pages.find((p) => p.seq === 2)!.status).toBe('failed');
    expect(failed.pages.find((p) => p.seq === 2)!.imageUrl).toBeNull();
    // 其他页照常完成
    expect(failed.pages.filter((p) => p.seq !== 2).every((p) => p.status === 'done' && !!p.imageUrl)).toBe(true);
    expect(failed.resourceId).toBeNull();

    const retry = await request(http).post(`/api/v1/courseware/jobs/${jobId}/retry`).set(auth(t1)).expect(200);
    expect(retry.body).toEqual({ code: 0, message: 'ok', data: null });

    const done = await pollJob(t1, jobId, (d) => d.status === 'done' || d.status === 'failed');
    expect(done.status).toBe('done');
    expect(done.done).toBe(3);
    expect(done.resourceId).toBeGreaterThan(0);
    mockImageFailOnce.reset();
  }, 30_000);

  // ================= ⑤ 归属/租户隔离 =================
  it('同机构他教师 / 跨机构教师 GET job 与 retry 一律 404(宪法 §7)', async () => {
    const jobId = await createJob(t1, { name: 'CW · 归属校验', style: STYLE, pages: outlinePages(1) });
    await pollJob(t1, jobId, (d) => d.status === 'done' || d.status === 'failed');

    await request(http).get(`/api/v1/courseware/jobs/${jobId}`).set(auth(t2)).expect(404);
    await request(http).get(`/api/v1/courseware/jobs/${jobId}`).set(auth(other)).expect(404);
    await request(http).post(`/api/v1/courseware/jobs/${jobId}/retry`).set(auth(t2)).expect(404);
    await request(http).post(`/api/v1/courseware/jobs/${jobId}/retry`).set(auth(other)).expect(404);
    // 本人仍可读
    await request(http).get(`/api/v1/courseware/jobs/${jobId}`).set(auth(t1)).expect(200);
  }, 30_000);

  it('不存在/非法 jobId → 404(不泄露存在性)', async () => {
    await request(http).get('/api/v1/courseware/jobs/deadbeefdeadbeefdeadbeef').set(auth(t1)).expect(404);
    await request(http).get('/api/v1/courseware/jobs/not-a-job-id').set(auth(t1)).expect(404);
  });

  // ============ ⑧ [audit-fix-server · S1] 额度超限时 courseware 被封 ============
  it('机构月额度用尽 + 默认策略 disable_qa → 建任务的逐页生图被封(页 failed,不产生成品)', async () => {
    const period = new Date().toISOString().slice(0, 7);
    const costKey = `a7:ai:cost:${Number(fx.orgId)}:${period}`;
    await raw.aiQuota.create({
      data: { orgId: fx.orgId, period, monthlyLimit: 1, alertThreshold: 80, overPolicy: 'disable_qa' },
    });
    await redis.set(costKey, '999');
    try {
      const jobId = await createJob(t1, { name: 'CW · 超额封禁', style: STYLE, pages: outlinePages(2) });
      const res = await pollJob(t1, jobId, (d) => d.status === 'failed' || d.status === 'done');
      expect(res.status).toBe('failed');
      expect(res.done).toBe(0);
      expect(res.resourceId).toBeNull();
      // 页失败原因来自网关的额度熔断(4504 的 message),不是生图上游错误
      const page = await readPage(jobId, 1);
      expect(page.status).toBe('failed');
      expect(page.error).toContain('额度');
    } finally {
      await redis.del(costKey);
      await raw.aiQuota.deleteMany({ where: { orgId: fx.orgId } });
    }
  }, 30_000);

  // ======= ⑨ [audit-fix-server · P0-2] 全页 done 但落库失败 → retry 可恢复 =======
  it('落库失败(全页 done / resourceId 为空)→ status 不报 done,retry 触发补偿后恢复', async () => {
    const jobId = await createJob(t1, { name: 'CW · 落库补偿', style: STYLE, pages: outlinePages(2) });
    const done = await pollJob(t1, jobId, (d) => d.status === 'done' || d.status === 'failed');
    expect(done.status).toBe('done');
    const goodResourceId = done.resourceId!;

    // 复现「createResource 抛错」后的现场:成品不在库、resourceId 为空、落库锁已被释放
    //(P0-2 修复口径:catch 分支 DEL 锁再 rethrow,原先是挂满 1h 谁都救不了)。
    // 先占住补偿节流键,好观察「卡住态」本身。
    await raw.resource.delete({ where: { id: BigInt(goodResourceId) } });
    await redis.hdel(jobKey(jobId), 'resourceId');
    await redis.del(publishLockKey(jobId));
    await redis.set(publishRetryKey(jobId), '1', 'EX', 30);

    // 全页 done 但没落库 → 绝不能报 done(前端会据此告诉教师「已存入资源库」)
    const stuck = await request(http).get(`/api/v1/courseware/jobs/${jobId}`).set(auth(t1)).expect(200);
    const stuckJob = stuck.body.data as CoursewareJobDto;
    expect(stuckJob.status).toBe('running');
    expect(stuckJob.done).toBe(2);
    expect(stuckJob.resourceId).toBeNull();

    // retry:无失败页时主动走一次落库判定(原先 enqueue([]) 直接 return,永不再触发)
    await redis.del(publishRetryKey(jobId));
    await request(http).post(`/api/v1/courseware/jobs/${jobId}/retry`).set(auth(t1)).expect(200);

    const recovered = await pollJob(t1, jobId, (d) => d.status === 'done');
    expect(recovered.status).toBe('done');
    expect(recovered.resourceId).toBeGreaterThan(0);
    const resource = await raw.resource.findFirst({
      where: { orgId: fx.orgId, id: BigInt(recovered.resourceId!) },
    });
    expect(resource).not.toBeNull();
    expect(resource!.name).toBe('CW · 落库补偿');
  }, 40_000);

  // ==== ⑩ [audit-fix-server · P0-3] worker 中断:超时 pending 折算 failed 放出重试口 ====
  it('pending 页超时未结算 → 派生为 failed(重试口出现),retry 后恢复并落库', async () => {
    const jobId = await createJob(t1, { name: 'CW · 超时折算', style: STYLE, pages: outlinePages(2) });
    await pollJob(t1, jobId, (d) => d.status === 'done' || d.status === 'failed');

    // 复现「worker 取件后被 OOM/发布重启打断」:该页回到 pending,startedAt 停在 30 分钟前
    const page = await readPage(jobId, 2);
    await writePage(jobId, {
      ...page,
      status: 'pending',
      startedAt: new Date(Date.now() - 30 * 60_000).toISOString(),
      imageOssKey: null,
      bytes: 0,
      error: null,
    });
    // 成品尚未落库的现场:清 resourceId + 释放落库权(第一次完成时已占过)
    await redis.hdel(jobKey(jobId), 'resourceId');
    await redis.del(publishLockKey(jobId), publishRetryKey(jobId));

    const stale = await request(http).get(`/api/v1/courseware/jobs/${jobId}`).set(auth(t1)).expect(200);
    const staleJob = stale.body.data as CoursewareJobDto;
    // 运行态仍是 pending,但对外派生成 failed —— 前端 canRetry 为真,「重试失败页」按钮出现
    expect((await readPage(jobId, 2)).status).toBe('pending');
    expect(staleJob.status).toBe('failed');
    expect(staleJob.pages.find((p) => p.seq === 2)!.status).toBe('failed');
    expect(staleJob.pages.find((p) => p.seq === 2)!.imageUrl).toBeNull();

    await request(http).post(`/api/v1/courseware/jobs/${jobId}/retry`).set(auth(t1)).expect(200);
    const recovered = await pollJob(t1, jobId, (d) => d.status === 'done' || d.status === 'failed');
    expect(recovered.status).toBe('done');
    expect(recovered.resourceId).toBeGreaterThan(0);
  }, 40_000);

  // ============ ⑪ [audit-fix-server · P1-10] 限流 ============
  it('建任务 4 次/10 分钟 → 第 4 次 4603(HTTP 429);未知 style.id → 400', async () => {
    await resetLimits(fx.t1Id);
    const body = { name: 'CW · 限流', style: STYLE, pages: outlinePages(1) };
    for (let i = 0; i < 3; i += 1) {
      await request(http).post('/api/v1/courseware/jobs').set(auth(t1)).send(body).expect(200);
    }
    const res = await request(http).post('/api/v1/courseware/jobs').set(auth(t1)).send(body).expect(429);
    expect(res.body.code).toBe(4603);
    await resetLimits(fx.t1Id);

    // [P2-15] 未知风格 id 不再静默回退默认风格
    await request(http).post('/api/v1/courseware/jobs').set(auth(t1))
      .send({ name: 'CW · 野风格', style: { id: 'chalk' }, pages: outlinePages(1) }).expect(400);
    await request(http).post('/api/v1/courseware/outline').set(auth(t1))
      .send({ sourceText: SOURCE_TEXT, style: { id: 'chalk' } }).expect(400);
    await resetLimits(fx.t1Id);
  }, 40_000);

  // ================= ⑥ 角色门禁 =================
  it('student 调 4 个端点一律 403', async () => {
    await request(http).post('/api/v1/courseware/outline').set(auth(s1))
      .send({ sourceText: SOURCE_TEXT, style: STYLE }).expect(403);
    await request(http).post('/api/v1/courseware/jobs').set(auth(s1))
      .send({ name: 'x', style: STYLE, pages: outlinePages(1) }).expect(403);
    await request(http).get('/api/v1/courseware/jobs/deadbeefdeadbeefdeadbeef').set(auth(s1)).expect(403);
    await request(http).post('/api/v1/courseware/jobs/deadbeefdeadbeefdeadbeef/retry').set(auth(s1)).expect(403);
  });
});
