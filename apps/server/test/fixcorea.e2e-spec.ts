/**
 * fix-core A 验收(后端核心 5 项):
 * A1 客观题判定后锁题:判错→再 PUT 同题→409(4502);成绩按首次判定。
 * A2 答疑跨题串扰:tail key 加 questionId 维度 —— 题 A 对话后问题 B 的构造消息不含题 A 尾巴。
 * A3 studentHours 登录门禁:经 API 收窄窗口到排除当前时刻 → 学生登录 403 → 恢复 → 成功。
 * A4 StudentHoursDto 校验:25:99(格式非法)与 start>=end 均 400。
 * A5 QA 内部独白泄漏兜底:mock 泄漏「（思考过程…」→ 输出审查整段替换为引导话术。
 *
 * 隔离:E2E_LLM_ISOLATION=1 强制 mock 供应商;夹具手机号 139592 号段;自建自清。
 */
import { INestApplication } from '@nestjs/common';
import Redis from 'ioredis';
import request from 'supertest';
import { num } from '../src/admin/helpers';
import { loadAiConfigJson } from '../src/ai/config-loader';
import { MOCK_ECHO_TAIL_PREFIX, MOCK_ECHO_TAIL_TRIGGER, MOCK_META_LEAK_TRIGGER } from '../src/ai/llm/providers/mock.provider';
import { createApp, raw } from './fixtures/setup';
import {
  createFixAOrg,
  dropFixAOrg,
  FIXA_PASSWORD,
  FIXA_STUDENT_PASSWORD,
  FixAFixture,
} from './fixtures/fixcorea.fixtures';

interface SseEvent {
  event: string;
  data: Record<string, unknown>;
}
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

describe('fix-core A(后端核心 5 项)', () => {
  let app: INestApplication;
  let http: any;
  let redis: Redis;
  let fx: FixAFixture;
  let adminToken: string;
  let studentToken: string;

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const studentLoginReq = () =>
    request(http).post('/api/v1/auth/student/login').send({ studentNo: fx.studentNo, password: FIXA_STUDENT_PASSWORD });
  const askQa = (token: string, body: Record<string, unknown>) =>
    request(http).post('/api/v1/ai/qa').set(auth(token)).send(body);
  const putSettings = (body: Record<string, unknown>) =>
    request(http).put('/api/v1/admin/settings').set(auth(adminToken)).send(body);
  const clearRl = async () => {
    const keys = await redis.keys('a7:ai:qa:rl:*');
    if (keys.length) await redis.del(...keys);
  };

  beforeAll(async () => {
    redis = new Redis(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379');
    app = await createApp();
    http = app.getHttpServer();
    fx = await createFixAOrg();

    const login = await request(http).post('/api/v1/auth/login').send({ phone: fx.adminPhone, password: FIXA_PASSWORD }).expect(200);
    adminToken = login.body.data.accessToken;
    // 窗口全天放开时先取到学生 token(A3 后续仅切换登录门禁,不影响既签发 token)
    studentToken = (await studentLoginReq().expect(200)).body.data.accessToken;
  });

  afterAll(async () => {
    // 清本套件写入的 a7:ai:qa:* 键 + 夹具数据
    const keys = await redis.keys(`a7:ai:qa:*:${num(fx.orgId)}:${num(fx.studentId)}*`);
    if (keys.length) await redis.del(...keys);
    await clearRl();
    await dropFixAOrg(fx.orgId);
    await redis.quit();
    await app.close();
  });

  // ================= A1 =================
  describe('A1 客观题判定后锁题', () => {
    let attemptId: number;

    it('开始作答 → 单选判错:即时下发正确答案', async () => {
      const start = await request(http).post('/api/v1/student/attempts').set(auth(studentToken))
        .send({ assignmentId: fx.assignmentId }).expect(200);
      attemptId = start.body.data.id;

      const wrong = await request(http)
        .put(`/api/v1/student/attempts/${attemptId}/answers/${num(fx.singleQuestionId)}`)
        .set(auth(studentToken)).send({ response: { choice: 'B' } }).expect(200);
      expect(wrong.body.data.judged).toBe(true);
      expect(wrong.body.data.isCorrect).toBe(false);
      expect(wrong.body.data.correctAnswer).toBe('A'); // 契约:判错下发正确答案(保留)
    });

    it('同题再 PUT 改对 → 409(4502)判定后不可再作答', async () => {
      const redo = await request(http)
        .put(`/api/v1/student/attempts/${attemptId}/answers/${num(fx.singleQuestionId)}`)
        .set(auth(studentToken)).send({ response: { choice: 'A' } }).expect(409);
      expect(redo.body.code).toBe(4502);
      expect(redo.body.message).toContain('判定');
    });

    it('交卷:成绩按首次判定(错)→ 客观分 0,该题 isCorrect 仍为 false', async () => {
      const submit = await request(http).post(`/api/v1/student/attempts/${attemptId}/submit`).set(auth(studentToken)).expect(200);
      const at = submit.body.data;
      expect(at.objectiveScore).toBe(0);
      const ans = at.answers.find((a: any) => a.questionId === num(fx.singleQuestionId));
      expect(ans.isCorrect).toBe(false);
      expect(ans.score).toBe(0);
    });
  });

  // ================= A2 =================
  describe('A2 答疑跨题串扰(tail key 加 questionId 维度)', () => {
    const MARKER = '独有标记UNICORNAAA';

    beforeAll(async () => { await clearRl(); });

    it('题 A 对话后,问题 B 的构造消息不含题 A 尾巴', async () => {
      // 1) 就题 A 提问一句带独有标记 → 尾巴落在 tail:...:qA
      await askQa(studentToken, { questionId: num(fx.qAId), message: `关于题A我卡住了(${MARKER})` }).expect(200);

      // 2) 切到题 B 提问(回显构造消息里的对话尾巴)→ 不应含题 A 的标记
      const onB = await askQa(studentToken, { questionId: num(fx.qBId), message: MOCK_ECHO_TAIL_TRIGGER }).expect(200);
      const echoB = joinDeltas(parseSse(onB.text));
      expect(echoB).toContain(MOCK_ECHO_TAIL_PREFIX); // 命中回显路径(而非被审查改写)
      expect(echoB).not.toContain(MARKER); // 关键断言:换题后无旧题尾巴

      // 3) 正向对照:回到题 A 回显 → 应含题 A 标记(证明尾巴机制确实按 questionId 隔离生效)
      const onA = await askQa(studentToken, { questionId: num(fx.qAId), message: MOCK_ECHO_TAIL_TRIGGER }).expect(200);
      const echoA = joinDeltas(parseSse(onA.text));
      expect(echoA).toContain(MARKER);
    });
  });

  // ================= A5 =================
  describe('A5 QA 内部独白泄漏兜底', () => {
    beforeAll(async () => { await clearRl(); });

    it('mock 输出「（思考过程…」→ 输出审查整段替换为引导话术', async () => {
      const res = await askQa(studentToken, { questionId: num(fx.qAId), message: MOCK_META_LEAK_TRIGGER }).expect(200);
      const text = joinDeltas(parseSse(res.text));
      const review = loadAiConfigJson<{ rewrite: string }>('qa-review.json');
      expect(text).toBe(review.rewrite);
      expect(text).not.toContain('思考过程');
    });
  });

  // ================= A4 =================
  describe('A4 StudentHoursDto 校验', () => {
    it('25:99 格式非法 → 400', async () => {
      await putSettings({ studentHours: { start: '25:99', end: '26:00' } }).expect(400);
    });
    it('start >= end → 400', async () => {
      const res = await putSettings({ studentHours: { start: '22:00', end: '20:00' } }).expect(400);
      expect(res.body.message).toContain('学习时段不合法');
    });
    it('合法窗口 06:00-22:30 → 200', async () => {
      await putSettings({ studentHours: { start: '06:00', end: '22:30' } }).expect(200);
    });
  });

  // ================= A3 =================
  describe('A3 studentHours 登录门禁', () => {
    // 收窄到排除"当前时刻"的窗口(留足余量,避免分钟漂移);始终 start<end 且不跨零点
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const excludeWin = nowMin > 120 ? { start: '00:00', end: '00:30' } : { start: '23:00', end: '23:30' };

    afterAll(async () => {
      // 恢复全天放开,避免影响其它套件(同库并行/后续)的学生登录
      await putSettings({ studentHours: { start: '00:00', end: '23:59' } }).expect(200);
    });

    it('窗口排除当前时刻 → 学生登录 403(文案含时段)', async () => {
      await putSettings({ studentHours: excludeWin }).expect(200);
      const res = await studentLoginReq().expect(403);
      expect(res.body.message).toContain('休息时段');
      expect(res.body.message).toContain(excludeWin.start);
    });

    it('恢复全天窗口 → 学生登录成功', async () => {
      await putSettings({ studentHours: { start: '00:00', end: '23:59' } }).expect(200);
      await studentLoginReq().expect(200);
    });
  });
});
