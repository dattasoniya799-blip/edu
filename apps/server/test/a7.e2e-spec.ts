/**
 * 验收覆盖(任务卡 A7 · AI 网关:供应商抽象 + 计量 + 四能力):
 * - mock 下计量字段完整(全归因)且 费用 = 单价 × token 可手算(对账路由表单价);
 * - /ai/qa SSE 流式 + 引导模式输出审查(检出最终答案模式 → 拦截重写,策略在配置文件);
 * - 限流 6 次/分/学生,第 7 次返回业务码 4501;
 * - 预批走 A5 真实 BullMQ 链路(AI_GATEWAY 已绑 LlmPreGradeGateway),
 *   输出严格符合 grading_records 结构(JSON Schema 校验)+ photo 占位经 OCR 接口(local stub);
 * - 切路由表(Redis 覆盖键)不重启生效 + fallback 切换;
 * - 超额 over_policy=disable_qa:关答疑、保预批;达 alert_threshold 写 audit_logs 一条(仅一次);
 * - 真实 provider(openai_compatible)只验请求构造,不发真实网络;
 * - 伴学旁白/学情诊断模板版 + LLM 开关;跨租户 404 与角色门禁(宪法 §7)。
 */
import { INestApplication } from '@nestjs/common';
import Redis from 'ioredis';
import request from 'supertest';
import { num, periodOf, round4 } from '../src/admin/helpers';
import { CompanionService } from '../src/ai/features/companion.service';
import { DiagnosisService } from '../src/ai/features/diagnosis.service';
import { LlmPreGradeGateway, PRE_GRADE_OUTPUT_SCHEMA } from '../src/ai/features/pre-grading.gateway';
import { validateJsonSchema } from '../src/ai/features/json-schema';
import { qaTailKey } from '../src/ai/features/qa.service';
import { loadAiConfigJson, loadAiConfigText } from '../src/ai/config-loader';
import { alertKey, costKey } from '../src/ai/llm/llm-gateway.service';
import { OpenAiCompatibleProvider } from '../src/ai/llm/providers/openai-compatible.provider';
import { ROUTES_OVERRIDE_KEY } from '../src/ai/llm/route-table.service';
import type { Pricing, RouteTable } from '../src/ai/llm/types';
import { runAsUser } from '../src/common/tenant-context';
import { A7_PASSWORD, A7_RUBRIC, A7Fixture, createA7Org, dropA7Org } from './fixtures/a7.fixtures';
import { createApp, loginStudentById, raw } from './fixtures/setup';

interface SseEvent {
  event: string;
  data: Record<string, unknown>;
}

/** 解析 SSE 文本流(openapi:event=delta data={"text"};event=done data={"requestId"}) */
function parseSse(text: string): SseEvent[] {
  return text
    .split('\n\n')
    .filter((b) => b.trim())
    .map((block) => ({
      event: /event: (.+)/.exec(block)?.[1] ?? '',
      data: JSON.parse(/data: (.+)/.exec(block)?.[1] ?? 'null'),
    }));
}

const joinDeltas = (events: SseEvent[]) =>
  events.filter((e) => e.event === 'delta').map((e) => e.data.text as string).join('');

/** 轮询等待异步任务(BullMQ 真实执行,口径同 a5 spec) */
async function waitFor<T>(fn: () => Promise<T | null | false | undefined>, label: string, ms = 15000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v as T;
    if (Date.now() - start > ms) throw new Error(`waitFor 超时:${label}`);
    await new Promise((r) => setTimeout(r, 200));
  }
}

describe('AI 网关:供应商抽象 + 计量 + 四能力(A7)', () => {
  let app: INestApplication;
  let http: any;
  let fx: A7Fixture;
  let admin: string;
  let teacher: string;
  let s1: string;
  let s2: string;
  let studentB: string;
  let redis: Redis;
  let pricing: Record<string, Pricing>;

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const askQa = (token: string, body: Record<string, unknown>) =>
    request(http).post('/api/v1/ai/qa').set(auth(token)).send(body);

  /** 手算口径:费用 = tokens/1000 × 路由表单价(验收项) */
  const manualCost = (model: string, tokensIn: number, tokensOut: number) => {
    const p = pricing[model] ?? pricing.default;
    return round4((tokensIn / 1000) * p.inPer1k + (tokensOut / 1000) * p.outPer1k);
  };

  const lastAiCall = (feature: string) =>
    raw.aiCall.findFirstOrThrow({ where: { orgId: fx.orgId, feature: feature as never }, orderBy: { id: 'desc' } });

  beforeAll(async () => {
    // 确保 openai_compatible 处于"未配 key"状态(healthy=false 用例的前提)
    delete process.env.LLM_API_KEY;
    delete process.env.LLM_MODEL;
    redis = new Redis(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379');
    // 防御性清理:上一轮异常中断可能残留的全局覆盖键/限流键
    await cleanupA7Keys();
    app = await createApp();
    http = app.getHttpServer();
    fx = await createA7Org();
    pricing = loadAiConfigJson<RouteTable>('ai-routes.default.json').pricing;

    const login = async (phone: string) => {
      const res = await request(http).post('/api/v1/auth/login').send({ phone, password: A7_PASSWORD }).expect(200);
      return res.body.data.accessToken as string;
    };
    const studentLogin = async (_orgId: bigint, sid: bigint, _fp?: string) =>
      loginStudentById(http, sid);
    admin = await login(fx.adminPhone);
    teacher = await login(fx.teacherPhone);
    s1 = await studentLogin(fx.orgId, fx.s1Id, 'a7-fp-1');
    s2 = await studentLogin(fx.orgId, fx.s2Id, 'a7-fp-2');
    studentB = await studentLogin(fx.orgBId, fx.studentBId, 'a7-fp-b');
  });

  async function cleanupA7Keys() {
    const keys = await redis.keys('a7:ai:*');
    if (keys.length) await redis.del(...keys);
  }

  afterEach(async () => {
    // 用例间互不污染:清限流计数(60s 窗口跨用例残留会影响计数断言)
    const keys = await redis.keys('a7:ai:qa:rl:*');
    if (keys.length) await redis.del(...keys);
    delete process.env.AI_COMPANION_USE_LLM;
    delete process.env.AI_DIAGNOSIS_USE_LLM;
  });

  afterAll(async () => {
    await app.close(); // 先停 BullMQ worker,再清数据
    await dropA7Org(fx.orgId, fx.orgBId);
    await cleanupA7Keys(); // a7: 前缀纪律,测试自清
    await redis.quit();
    await raw.$disconnect();
  });

  // ================= 计量(验收:字段完整,费用=单价×token 可手算) =================

  it('验收:mock 下 ai_calls 计量字段完整,费用 = 单价 × token 可手算,Redis 当月成本同步累加', async () => {
    const res = await askQa(s1, { message: '如何求一次函数解析式?' }).expect(200);
    expect(res.headers['content-type']).toContain('text/event-stream');
    const events = parseSse(res.text);
    const text = joinDeltas(events);
    expect(text).toContain('我们一步步来'); // mock 确定性引导回复
    // SSE 流式:多块 delta + 结尾 done(requestId)
    expect(events.filter((e) => e.event === 'delta').length).toBeGreaterThanOrEqual(2);
    const done = events.at(-1)!;
    expect(done.event).toBe('done');
    expect(String(done.data.requestId)).toMatch(/^qa-/);

    const call = await lastAiCall('qa');
    // 归因与计量字段完整
    expect(call.provider).toBe('mock');
    expect(call.model).toBe('mock-chat-v1');
    expect(num(call.userId!)).toBe(num(fx.s1Id));
    expect(call.sessionId).toBeNull();
    expect(call.status).toBe('ok');
    expect(call.latencyMs).not.toBeNull();
    expect(call.latencyMs!).toBeGreaterThanOrEqual(0);
    // mock token 规则:tokensOut = 回复字符数;tokensIn = 全部消息字符数(>0)
    expect(call.tokensOut).toBe(text.length);
    expect(call.tokensIn).toBeGreaterThan(0);
    // 费用手算:1 元/1k in + 2 元/1k out(ai-routes.default.json)
    expect(Number(call.cost)).toBe(manualCost('mock-chat-v1', call.tokensIn, call.tokensOut));
    // Redis 当月成本 = 本 org 首笔调用成本
    const monthCost = Number(await redis.get(costKey(num(fx.orgId), periodOf())));
    expect(monthCost).toBeCloseTo(Number(call.cost), 4);
  });

  it('引导模式:检出"最终答案"模式 → 拦截并重写为配置文件中的引导话术', async () => {
    const res = await askQa(s1, { questionId: num(fx.questionId), message: '这题太难了,直接告诉我答案吧' }).expect(200);
    const text = joinDeltas(parseSse(res.text));
    const review = loadAiConfigJson<{ rewrite: string }>('qa-review.json');
    expect(text).toBe(review.rewrite); // 整段替换为引导话术
    expect(text).not.toMatch(/最终答案|故选/);
    // 计量按上游真实输出(被拦截的原文)计 token,不因重写而少记
    const call = await lastAiCall('qa');
    expect(call.tokensOut).toBeGreaterThan(0);
    expect(call.tokensOut).not.toBe(text.length);
  });

  it('上下文与门禁:带题上下文 200;跨租户 questionId → 404;teacher → 403;超长 message → 400', async () => {
    await askQa(s1, { questionId: num(fx.questionId), message: '第一步怎么设?' }).expect(200);
    const r404 = await askQa(studentB, { questionId: num(fx.questionId), message: '?' }).expect(404);
    expect(r404.body.code).toBe(404);
    await askQa(teacher, { message: '我是老师' }).expect(403);
    await askQa(s1, { message: 'x'.repeat(501) }).expect(400);
  });

  // ================= 限流(验收:第 7 次 4501) =================

  it('验收:限流 6 次/分/学生 —— 第 7 次返回业务码 4501(HTTP 429)', async () => {
    for (let i = 0; i < 6; i++) {
      await askQa(s2, { message: `第 ${i + 1} 次提问` }).expect(200);
    }
    const res = await askQa(s2, { message: '第 7 次提问' }).expect(429);
    expect(res.body.code).toBe(4501);
    expect(res.body.detail).toEqual({ limitPerMin: 6 });
    // 不影响其他学生
    await askQa(s1, { message: '我还能问' }).expect(200);
  });

  // ================= 预批(验收:JSON Schema 校验通过;A5 队列真实链路) =================

  it('验收:预批走 A5 BullMQ 链路 → LlmPreGradeGateway(mock)→ grading_records 结构严格符合 Schema', async () => {
    const start = await request(http).post('/api/v1/student/attempts').set(auth(s1))
      .send({ assignmentId: fx.assignmentId }).expect(200);
    const attemptId = start.body.data.id as number;
    await request(http)
      .put(`/api/v1/student/attempts/${attemptId}/answers/${num(fx.questionId)}`)
      .set(auth(s1)).send({ response: { text: '设 y=kx+b,代入两点 √2,解得 k=2,b=3。' } }).expect(200);
    await request(http).post(`/api/v1/student/attempts/${attemptId}/submit`).set(auth(s1)).expect(200);

    const ansRow = await raw.answer.findFirstOrThrow({
      where: { attemptId: BigInt(attemptId), questionId: fx.questionId },
    });
    const rec = await waitFor(
      () => raw.gradingRecord.findFirst({ where: { answerId: ansRow.id, aiScore: { not: null } } }),
      'pre_grading 任务完成',
    );
    // mock 规则:第 1 步恒 ok + √2 标记 → 步骤 1、2 通过 = 3+4 = 7 分
    expect(Number(rec.aiScore)).toBe(7);
    expect(rec.aiSteps).toEqual([
      { step: 1, ok: true },
      { step: 2, ok: true },
      { step: 3, ok: false, comment: `未完成:${A7_RUBRIC[2].desc}` },
    ]);
    expect(rec.aiErrorTags).toEqual([A7_RUBRIC[2].desc]);

    // 落库结构再过一遍 JSON Schema(snake_case 镜像,设计文档 §8.2 契约)
    const snake = {
      ai_score: Number(rec.aiScore),
      steps: rec.aiSteps,
      error_tags: rec.aiErrorTags,
    };
    expect(validateJsonSchema(snake, PRE_GRADE_OUTPUT_SCHEMA)).toEqual([]);
    // 非法形状必须报错(校验器有效性自证)
    expect(validateJsonSchema({ ai_score: -1, steps: [{ step: 1.5, ok: 'yes' }] }, PRE_GRADE_OUTPUT_SCHEMA)).not.toEqual([]);

    // 预批计量:feature=pre_grading 行存在且归因/费用口径一致
    const call = await lastAiCall('pre_grading');
    expect(call.provider).toBe('mock');
    expect(call.model).toBe('mock-grader-v1');
    expect(call.status).toBe('ok');
    expect(Number(call.cost)).toBe(manualCost('mock-grader-v1', call.tokensIn, call.tokensOut));
  });

  it('预批 photo 占位 → OCR 接口(local stub,无 √ 标记 → 仅第 1 步得分)', async () => {
    const gateway = app.get(LlmPreGradeGateway);
    const out = await runAsUser({ uid: 0, orgId: num(fx.orgId), role: 'admin' }, () =>
      gateway.preGrade(
        { ocrText: '[photo:a7/scan-001.jpg]', referenceAnswer: '$y=2x+3$', rubric: A7_RUBRIC },
        { orgId: num(fx.orgId), feature: 'pre_grading' },
      ),
    );
    expect(out.aiScore).toBe(A7_RUBRIC[0].score);
    expect(out.steps.map((s) => s.ok)).toEqual([true, false, false]);
    expect(out.errorTags).toEqual([A7_RUBRIC[1].desc, A7_RUBRIC[2].desc]);
  });

  // ================= 路由表(验收:切换不重启生效)与 fallback =================

  it('验收:切路由表不重启生效 —— Redis 覆盖键写入后 /ai/health 与计量即时反映,删除即回滚', async () => {
    const before = await request(http).get('/api/v1/ai/health').set(auth(admin)).expect(200);
    const qaBefore = before.body.data.providers.find((p: any) => p.feature === 'qa');
    expect(qaBefore).toEqual({ feature: 'qa', provider: 'mock', model: 'mock-chat-v1', healthy: true });

    await redis.set(ROUTES_OVERRIDE_KEY, JSON.stringify({ routes: { qa: { provider: 'mock', model: 'mock-chat-mini' } } }));
    const after = await request(http).get('/api/v1/ai/health').set(auth(admin)).expect(200);
    expect(after.body.data.providers.find((p: any) => p.feature === 'qa').model).toBe('mock-chat-mini');

    const res = await askQa(s1, { message: '切模型后再问一次' }).expect(200);
    const text = joinDeltas(parseSse(res.text));
    const call = await lastAiCall('qa');
    expect(call.model).toBe('mock-chat-mini');
    // 新模型单价(0.5/1 元每 1k)立即生效,费用仍可手算
    expect(call.tokensOut).toBe(text.length);
    expect(Number(call.cost)).toBe(manualCost('mock-chat-mini', call.tokensIn, call.tokensOut));

    await redis.del(ROUTES_OVERRIDE_KEY);
    const rollback = await request(http).get('/api/v1/ai/health').set(auth(admin)).expect(200);
    expect(rollback.body.data.providers.find((p: any) => p.feature === 'qa').model).toBe('mock-chat-v1');
  });

  it('fallback:主路由供应商故障 → 自动切 fallback,计量记实际命中的 provider/model', async () => {
    await redis.set(ROUTES_OVERRIDE_KEY, JSON.stringify({
      routes: { qa: { provider: 'mock', model: 'mock-broken', fallback: { provider: 'mock', model: 'mock-chat-v1' } } },
    }));
    try {
      const res = await askQa(s1, { message: '主路由坏了还能答吗' }).expect(200);
      expect(joinDeltas(parseSse(res.text))).toContain('我们一步步来');
      const call = await lastAiCall('qa');
      expect(call.model).toBe('mock-chat-v1');
      expect(call.status).toBe('ok');
    } finally {
      await redis.del(ROUTES_OVERRIDE_KEY);
    }
  });

  // ================= 真实 provider 适配器(只验请求构造,不做真实网络调用) =================

  it('openai_compatible:env 读 LLM_API_KEY/LLM_BASE_URL/LLM_MODEL,OpenAI 兼容请求构造正确', async () => {
    const provider = app.get(OpenAiCompatibleProvider);
    expect(provider.healthy()).toBe(false); // 未配 key

    process.env.LLM_API_KEY = 'sk-test-123';
    process.env.LLM_BASE_URL = 'https://llm.example.com/v1/';
    process.env.LLM_MODEL = 'vendor-default-model';
    try {
      expect(provider.healthy()).toBe(true);
      const built = provider.buildRequest({
        model: 'env',
        messages: [{ role: 'system', content: 's' }, { role: 'user', content: 'hi' }],
        stream: true,
      });
      expect(built.url).toBe('https://llm.example.com/v1/chat/completions');
      expect(built.headers.authorization).toBe('Bearer sk-test-123');
      expect(built.headers['content-type']).toBe('application/json');
      expect(built.body.model).toBe('vendor-default-model'); // model=env → 取 LLM_MODEL
      expect(built.body.stream).toBe(true);
      expect(built.body.stream_options).toEqual({ include_usage: true });
      expect(built.body.messages).toHaveLength(2);

      const nonStream = provider.buildRequest({ model: 'explicit-model', messages: [], stream: false });
      expect(nonStream.body.model).toBe('explicit-model'); // 路由表显式模型名优先
      expect(nonStream.body.stream_options).toBeUndefined();
    } finally {
      delete process.env.LLM_API_KEY;
      delete process.env.LLM_BASE_URL;
      delete process.env.LLM_MODEL;
    }
  });

  it('/ai/health:路由指到未配 key 的 openai_compatible → healthy=false;student → 403', async () => {
    await redis.set(ROUTES_OVERRIDE_KEY, JSON.stringify({
      routes: { diagnosis: { provider: 'openai_compatible', model: 'env' } },
    }));
    try {
      const res = await request(http).get('/api/v1/ai/health').set(auth(admin)).expect(200);
      const diag = res.body.data.providers.find((p: any) => p.feature === 'diagnosis');
      expect(diag).toEqual({ feature: 'diagnosis', provider: 'openai_compatible', model: 'env', healthy: false });
    } finally {
      await redis.del(ROUTES_OVERRIDE_KEY);
    }
    await request(http).get('/api/v1/ai/health').set(auth(s1)).expect(403);
  });

  // ================= 成本护栏(验收:over_policy + alert_threshold) =================

  it('验收:达 alert_threshold 写一条 audit_logs(仅一次);超额 over_policy=disable_qa 关答疑、保预批', async () => {
    const period = periodOf();
    const cKey = costKey(num(fx.orgId), period);
    await raw.aiQuota.create({
      data: { orgId: fx.orgId, period, monthlyLimit: 1, alertThreshold: 50, overPolicy: 'disable_qa' },
    });
    try {
      // 当月成本 0.4(未达 50% 阈值 0.5,未超额 1.0)→ 本次调用计费后跨过阈值
      await redis.set(cKey, '0.4');
      await askQa(s1, { questionId: num(fx.questionId), message: '阈值前的最后一问' }).expect(200);
      const alerts = await raw.auditLog.findMany({ where: { orgId: fx.orgId, action: 'ai.quota.alert' } });
      expect(alerts).toHaveLength(1);
      expect((alerts[0].detail as any).monthlyLimit).toBe(1);

      // 强制超额 → 答疑被关(4504),且不再重复告警
      await redis.set(cKey, '5');
      const blocked = await askQa(s1, { message: '超额后还能问吗' }).expect(409);
      expect(blocked.body.code).toBe(4504);
      expect(blocked.body.detail).toEqual({ feature: 'qa', overPolicy: 'disable_qa' });
      expect(await raw.auditLog.count({ where: { orgId: fx.orgId, action: 'ai.quota.alert' } })).toBe(1);

      // 保预批:同一超额状态下 pre_grading 不受 disable_qa 影响
      const gateway = app.get(LlmPreGradeGateway);
      const out = await runAsUser({ uid: 0, orgId: num(fx.orgId), role: 'admin' }, () =>
        gateway.preGrade(
          { ocrText: '全对 √2 √3', referenceAnswer: '', rubric: A7_RUBRIC },
          { orgId: num(fx.orgId), feature: 'pre_grading' },
        ),
      );
      expect(out.aiScore).toBe(10);
    } finally {
      await raw.aiQuota.deleteMany({ where: { orgId: fx.orgId } });
      await redis.del(cKey, alertKey(num(fx.orgId), period));
    }
  });

  // ================= 伴学旁白 / 学情诊断(模板 MVP + LLM 开关) =================

  it('伴学旁白:模板实现(配置文件,≤80 字);开 LLM 开关后经网关计量 feature=class_companion', async () => {
    const companion = app.get(CompanionService);
    const text = await companion.narration({
      orgId: num(fx.orgId),
      kind: 'answer_correct',
      vars: { topic: '一次函数', name: '小明' },
    });
    expect(text).toContain('一次函数');
    expect(text.length).toBeLessThanOrEqual(80);

    process.env.AI_COMPANION_USE_LLM = 'true';
    const llmText = await runAsUser({ uid: 0, orgId: num(fx.orgId), role: 'admin' }, () =>
      companion.narration({ orgId: num(fx.orgId), kind: 'idle', vars: {}, trace: { sessionId: 99 } }),
    );
    expect(llmText.length).toBeLessThanOrEqual(80);
    const call = await lastAiCall('class_companion');
    expect(call.provider).toBe('mock');
    expect(num(call.sessionId!)).toBe(99); // 课堂归因维度可传递
  });

  it('学情诊断:模板摘要含薄弱点与建议;无薄弱点时给均衡话术', async () => {
    const diagnosis = app.get(DiagnosisService);
    const out = await diagnosis.diagnose({
      orgId: num(fx.orgId), studentId: num(fx.s1Id), days: 30, attemptCount: 12, wrongCount: 4,
      weakNodes: [{ name: '一次函数解析式', mastery: 40 }, { name: '图象平移', mastery: 55 }],
    });
    expect(out.summary).toContain('一次函数解析式');
    expect(out.summary).toContain('40');
    expect(out.suggestion).toContain('一次函数解析式');

    const balanced = await diagnosis.diagnose({
      orgId: num(fx.orgId), studentId: num(fx.s1Id), days: 30, attemptCount: 3, wrongCount: 0, weakNodes: [],
    });
    expect(balanced.summary).toContain('掌握均衡');
    expect(balanced.suggestion).toBeNull();
  });

  it('QA 对话尾部(最近 6 条)写入 Redis 并带入下一轮上下文(成本护栏 §8.3 裁剪口径)', async () => {
    const key = qaTailKey(num(fx.orgId), num(fx.s1Id));
    const len = await redis.llen(key);
    expect(len).toBeGreaterThan(0);
    expect(len).toBeLessThanOrEqual(6); // 只留最近 6 条
    const message = '再帮我看一步';
    await askQa(s1, { message }).expect(200);
    const call = await lastAiCall('qa');
    // mock token 规则下 tokensIn = 各消息字符数之和;严格大于 系统提示词+本句
    // → 证明对话尾部确实进入了上下文
    const promptLen = loadAiConfigText('qa-guided-prompt.md').length;
    expect(call.tokensIn).toBeGreaterThan(promptLen + message.length);
  });
});
