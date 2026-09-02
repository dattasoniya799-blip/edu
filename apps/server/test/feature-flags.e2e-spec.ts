/**
 * E1 · 内测区与功能分级 e2e(手机号 139610 段 / studentNo 前缀 FF-,自建自清)。
 *
 * 覆盖(任务卡 §7):
 * ① /features/my 下发口径:ga / beta / off × 白名单内外 × 角色;
 * ② admin 改 stage / 白名单(replace 语义 + 同机构校验 + 未知 key 404)+ 变更写审计;
 * ③ 租户隔离:本机构 flag / 白名单不影响他机构;
 * ④ role 门禁:/admin/features* 仅 admin;/features/my 任意已登录角色;
 * ⑤ courseware 4 端点 gate:白名单外 403(4701)/ 名单内、ga 放行到业务层;
 * ⑥ 拍照预批 gate:off 不入预批队列(作答/拍照附件不受影响);beta 白名单内真实入队写 AI 分;
 * ⑦ wrong_redo 堵坑:重做组卷只含客观题;全为主观/公式 → 4503。
 *
 * 生图/大纲恒走 mock(套件开头清 a7:ai:routes 覆盖 + IMAGE_API_KEY 置定义态空串,同 courseware 套件口径)。
 */
process.env.IMAGE_API_KEY = '';

import { INestApplication } from '@nestjs/common';
import Redis from 'ioredis';
import request from 'supertest';
import type { AdminFeatureDto, AssignmentDto, MyFeatureDto } from '@qiming/contracts';
import { ROUTES_OVERRIDE_KEY } from '../src/ai/llm/route-table.service';
import { createApp, createOrg2, dropOrg2, loginStudentById, raw, type Org2Fixture } from './fixtures/setup';
import { createFfOrg, dropFfOrg, FF_PASSWORD, type FfFixture } from './fixtures/feature-flags.fixtures';

const exactKeys = (obj: object, keys: string[]) =>
  expect(Object.keys(obj).sort()).toEqual([...keys].sort());

const MY_FEATURE_KEYS = ['key', 'name', 'stage', 'description'];
const ADMIN_FEATURE_KEYS = ['key', 'name', 'description', 'audienceRole', 'defaultStage', 'stage', 'whitelist', 'knownIssues', 'acceptance'];

async function waitFor<T>(fn: () => Promise<T | null | false | undefined>, label: string, ms = 15000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v as T;
    if (Date.now() - start > ms) throw new Error(`waitFor 超时:${label}`);
    await new Promise((r) => setTimeout(r, 200));
  }
}

describe('E1 · 内测区与功能分级(目录下发/管控/门禁/wrong_redo)', () => {
  let app: INestApplication;
  let http: never;
  let redis: Redis;
  let fx: FfFixture;
  let org2: Org2Fixture;
  let admin: string;
  let t1: string;
  let t2: string;
  let s1: string;
  let s2: string;
  let org2Admin: string;
  let org2Teacher: string;

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const login = async (phone: string, password: string): Promise<string> => {
    const res = await request(http).post('/api/v1/auth/login').send({ phone, password }).expect(200);
    return res.body.data.accessToken as string;
  };
  /** admin 设阶段(默认断言 200) */
  const setStage = (key: string, stage: string, expected = 200) =>
    request(http).put(`/api/v1/admin/features/${key}`).set(auth(admin)).send({ stage }).expect(expected);
  /** admin 覆写白名单(replace 语义) */
  const setWhitelist = (key: string, userIds: number[], expected = 200) =>
    request(http).put(`/api/v1/admin/features/${key}/whitelist`).set(auth(admin)).send({ userIds }).expect(expected);
  const myFeatures = async (token: string): Promise<MyFeatureDto[]> => {
    const res = await request(http).get('/api/v1/features/my').set(auth(token)).expect(200);
    return res.body.data.features as MyFeatureDto[];
  };
  const adminList = async (token = admin): Promise<AdminFeatureDto[]> => {
    const res = await request(http).get('/api/v1/admin/features').set(auth(token)).expect(200);
    return res.body.data as AdminFeatureDto[];
  };

  beforeAll(async () => {
    redis = new Redis(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379', { maxRetriesPerRequest: 2 });
    // 清掉可能由 aiadmin 套件留下的运行态路由覆盖 → 回落默认表(文本/生图均 mock,零网络)
    await redis.del(ROUTES_OVERRIDE_KEY);
    app = await createApp();
    http = app.getHttpServer() as never;
    fx = await createFfOrg();
    org2 = await createOrg2();
    admin = await login(fx.adminPhone, FF_PASSWORD);
    t1 = await login(fx.t1Phone, FF_PASSWORD);
    t2 = await login(fx.t2Phone, FF_PASSWORD);
    s1 = await loginStudentById(http, fx.s1Id);
    s2 = await loginStudentById(http, fx.s2Id);
    org2Admin = await login(org2.adminPhone, org2.password);
    org2Teacher = await login(org2.teacherPhone, org2.password);
  });

  afterAll(async () => {
    await app.close(); // 先停 BullMQ worker
    await dropFfOrg(fx.orgId);
    await dropOrg2(org2.orgId);
    const prefix = process.env.BULLMQ_PREFIX ?? 'a5';
    const keys = await redis.keys(`${prefix}:pre_grading:*`);
    if (keys.length) await redis.del(...keys);
    await redis.quit().catch(() => undefined);
    await raw.$disconnect();
  });

  // ================= ① 目录下发 · 默认态 =================

  it('默认态(无 flag 行):ai_courseware=off(2026-08-31 下线)、photo_pregrade=off → 三角色 /features/my 均为空', async () => {
    expect(await myFeatures(admin)).toEqual([]);
    expect(await myFeatures(t1)).toEqual([]);
    expect(await myFeatures(s1)).toEqual([]);
  });

  it('GET /admin/features:目录全量 2 项(字段齐备,默认 stage,空白名单)', async () => {
    const list = await adminList();
    expect(list.map((f) => f.key)).toEqual(['ai_courseware', 'photo_pregrade']);
    for (const f of list) exactKeys(f, ADMIN_FEATURE_KEYS);
    const cw = list.find((f) => f.key === 'ai_courseware')!;
    expect(cw).toMatchObject({ name: 'AI 生成课件', audienceRole: 'teacher', defaultStage: 'off', stage: 'off', whitelist: [] });
    expect(cw.knownIssues.length).toBeGreaterThan(0);
    expect(cw.acceptance.length).toBeGreaterThan(0);
    const pre = list.find((f) => f.key === 'photo_pregrade')!;
    expect(pre).toMatchObject({ name: '拍照预批', audienceRole: 'student', defaultStage: 'off', stage: 'off', whitelist: [] });
  });

  // ================= ④ role 门禁 =================

  it('role 门禁:/admin/features* 仅 admin(teacher GET 403 / student PUT 403);/features/my 任意角色可读', async () => {
    await request(http).get('/api/v1/admin/features').set(auth(t1)).expect(403);
    await request(http).put('/api/v1/admin/features/ai_courseware').set(auth(s1)).send({ stage: 'ga' }).expect(403);
    await request(http).put('/api/v1/admin/features/ai_courseware/whitelist').set(auth(t1)).send({ userIds: [] }).expect(403);
    // /features/my 三角色皆 200(上面用例已覆盖 admin/t1/s1,这里补 s2 与 org2 侧)
    expect(await myFeatures(s2)).toEqual([]);
    expect(await myFeatures(org2Teacher)).toEqual([]);
  });

  // ================= ② admin 管控 =================

  it('PUT whitelist(replace 语义):[t1,t2] → [t2] 整表覆写;白名单项含 userId/姓名/角色', async () => {
    await setWhitelist('ai_courseware', [Number(fx.t1Id), Number(fx.t2Id)]);
    let cw = (await adminList()).find((f) => f.key === 'ai_courseware')!;
    expect(cw.whitelist).toEqual([
      { userId: Number(fx.t1Id), name: 'FF教师一', role: 'teacher' },
      { userId: Number(fx.t2Id), name: 'FF教师二', role: 'teacher' },
    ]);
    await setWhitelist('ai_courseware', [Number(fx.t2Id)]);
    cw = (await adminList()).find((f) => f.key === 'ai_courseware')!;
    expect(cw.whitelist).toEqual([{ userId: Number(fx.t2Id), name: 'FF教师二', role: 'teacher' }]);
    // 落库行数同步收敛为 1(replace 不是叠加)
    expect(await raw.featureAccess.count({ where: { orgId: fx.orgId, featureKey: 'ai_courseware' } })).toBe(1);
  });

  it('beta 下发口径:白名单内可见、白名单外不可见(MyFeature 形状)', async () => {
    await setStage('ai_courseware', 'beta'); // 2026-08-31 起目录默认 off,本用例显式开 beta
    await setWhitelist('ai_courseware', [Number(fx.t1Id)]);
    const mineT1 = await myFeatures(t1);
    expect(mineT1).toHaveLength(1);
    exactKeys(mineT1[0], MY_FEATURE_KEYS);
    expect(mineT1[0]).toMatchObject({ key: 'ai_courseware', name: 'AI 生成课件', stage: 'beta' });
    expect(await myFeatures(t2)).toEqual([]);
  });

  it('ga 下发口径:角色匹配全量下发(白名单外教师可见);角色不匹配(学生)不可见', async () => {
    await setStage('ai_courseware', 'ga');
    const mineT2 = await myFeatures(t2);
    expect(mineT2.map((f) => f.key)).toEqual(['ai_courseware']);
    expect(mineT2[0].stage).toBe('ga');
    expect(await myFeatures(s1)).toEqual([]); // photo_pregrade 仍 off;ai_courseware 面向 teacher
  });

  it('off 下发口径:白名单内也不可见(off=全员下线,仅管理端登记)', async () => {
    await setStage('ai_courseware', 'off');
    expect(await myFeatures(t1)).toEqual([]); // t1 仍在白名单,但 off 优先
    const cw = (await adminList()).find((f) => f.key === 'ai_courseware')!;
    expect(cw.stage).toBe('off'); // 管理端仍全量登记
  });

  it('未知 key → 404;白名单含跨机构/不存在用户 → 400 且不落库', async () => {
    await setStage('no_such_feature', 'ga', 404);
    await setWhitelist('no_such_feature', [], 404);
    await setWhitelist('ai_courseware', [Number(org2.teacherId)], 400); // 跨机构用户
    await setWhitelist('ai_courseware', [999999999], 400); // 不存在
    // 校验失败不改动名单(仍为 t1 一人)
    expect(await raw.featureAccess.count({ where: { orgId: fx.orgId, featureKey: 'ai_courseware' } })).toBe(1);
  });

  // ================= ③ 租户隔离 =================

  it('租户隔离:本机构 stage 覆盖与白名单对他机构不可见、不生效', async () => {
    await setStage('ai_courseware', 'ga');
    // 他机构管理端仍是默认态(off + 空白名单;2026-08-31 起目录默认 off)
    const other = (await adminList(org2Admin)).find((f) => f.key === 'ai_courseware')!;
    expect(other.stage).toBe('off');
    expect(other.whitelist).toEqual([]);
    // 他机构教师不因本机构 ga 而可见
    expect(await myFeatures(org2Teacher)).toEqual([]);
    // flag 行只落在本机构
    expect(await raw.featureFlag.count({ where: { orgId: org2.orgId } })).toBe(0);
  });

  // ================= ⑤ courseware 4 端点 gate =================

  const OUTLINE_BODY = { sourceText: 'FF 相似三角形判定讲稿。', pageCount: 3, style: { id: 'academic_blue' } };
  const JOB_BODY = {
    name: 'FF · gate 放行验证',
    style: { id: 'academic_blue' },
    pages: [{ title: 'FF 第 1 页', body: '要点一。\n要点二。\n要点三。', imagePrompt: '判定示意图' }],
  };

  it('courseware gate 拦截:beta 白名单外教师调 4 端点 → 403 FEATURE_NOT_ENABLED(4701)', async () => {
    await setStage('ai_courseware', 'beta');
    await setWhitelist('ai_courseware', []);
    // 惰性构造:supertest 的 Test 在构造时即计算目标端口,预构建一批会共享/提前关闭监听
    const calls = [
      () => request(http).post('/api/v1/courseware/outline').set(auth(t1)).send(OUTLINE_BODY),
      () => request(http).post('/api/v1/courseware/jobs').set(auth(t1)).send(JOB_BODY),
      () => request(http).get('/api/v1/courseware/jobs/ffffffffffffffffffffffff').set(auth(t1)),
      () => request(http).post('/api/v1/courseware/jobs/ffffffffffffffffffffffff/retry').set(auth(t1)),
    ];
    for (const call of calls) {
      const res = await call().expect(403);
      expect(res.body.code).toBe(4701);
      expect(res.body.detail).toEqual({ key: 'ai_courseware' });
    }
  });

  it('courseware gate 放行:白名单内 4 端点均到达业务层;同阶段白名单外仍 403', async () => {
    await setWhitelist('ai_courseware', [Number(fx.t1Id)]);
    // outline 真跑 mock 文本 LLM → 200 且逐页齐备
    const outline = await request(http).post('/api/v1/courseware/outline').set(auth(t1)).send(OUTLINE_BODY).expect(200);
    expect((outline.body.data.pages as unknown[]).length).toBe(3);
    // getJob / retry:过 gate 后到达业务层 → 未知 job 404(4602),不再是 403
    const notFound = await request(http).get('/api/v1/courseware/jobs/ffffffffffffffffffffffff').set(auth(t1)).expect(404);
    expect(notFound.body.code).toBe(4602);
    const retry = await request(http).post('/api/v1/courseware/jobs/ffffffffffffffffffffffff/retry').set(auth(t1)).expect(404);
    expect(retry.body.code).toBe(4602);
    // 建任务(mock 生图)→ 200 返回 jobId
    const job = await request(http).post('/api/v1/courseware/jobs').set(auth(t1)).send(JOB_BODY).expect(200);
    expect(job.body.data.jobId).toMatch(/^[a-f0-9]{24}$/);
    // 白名单外对照:同一时刻 t2 仍被拦
    const denied = await request(http).post('/api/v1/courseware/outline').set(auth(t2)).send(OUTLINE_BODY).expect(403);
    expect(denied.body.code).toBe(4701);
  });

  it('courseware gate 放行:ga 阶段白名单外教师也放行;学生仍被 role 门禁挡(403 非 4701)', async () => {
    await setStage('ai_courseware', 'ga');
    await setWhitelist('ai_courseware', []);
    const res = await request(http).get('/api/v1/courseware/jobs/ffffffffffffffffffffffff').set(auth(t2)).expect(404);
    expect(res.body.code).toBe(4602);
    // 学生角色:RolesGuard 先于 gate → 403 但不是 FEATURE_NOT_ENABLED
    const stu = await request(http).post('/api/v1/courseware/outline').set(auth(s1)).send(OUTLINE_BODY).expect(403);
    expect(stu.body.code).not.toBe(4701);
  });

  // ================= ⑥ 拍照预批 gate =================

  let s2PreAttemptId: number;

  it('photo_pregrade=off:公式填空作答照常落库待人工复核,但不入预批队列(无 AI 分)', async () => {
    await setStage('photo_pregrade', 'off');
    const start = await request(http).post('/api/v1/student/attempts').set(auth(s2))
      .send({ assignmentId: fx.preAssignmentId }).expect(200);
    s2PreAttemptId = start.body.data.id as number;
    const r = await request(http)
      .put(`/api/v1/student/attempts/${s2PreAttemptId}/answers/${Number(fx.qFormulaId)}`)
      .set(auth(s2)).send({ response: { texts: ['\\frac{1}{2}'] } }).expect(200);
    expect(r.body.data.judged).toBe(false); // 作答能力不受门禁影响,照常进复核管线
    const ans = await raw.answer.findFirstOrThrow({
      where: { attemptId: BigInt(s2PreAttemptId), questionId: fx.qFormulaId },
    });
    expect(ans.isCorrect).toBeNull();
    // 留出 worker 时间再断言:未入队 → 无任何 AI 预批记录
    await new Promise((res) => setTimeout(res, 1200));
    const rec = await raw.gradingRecord.findFirst({ where: { answerId: ans.id } });
    expect(rec?.aiScore ?? null).toBeNull();
  });

  it('photo_pregrade=off:solution 拍照作为作答附件不受影响(photoOssKey 照常落库)', async () => {
    const key = `answer_photo/${Number(fx.orgId)}/2026-08/ff-e2e.jpg`;
    const r = await request(http)
      .put(`/api/v1/student/attempts/${s2PreAttemptId}/answers/${Number(fx.qSolutionId)}`)
      .set(auth(s2)).send({ response: { photoOssKey: key } }).expect(200);
    expect(r.body.data.judged).toBe(false);
    const ans = await raw.answer.findFirstOrThrow({
      where: { attemptId: BigInt(s2PreAttemptId), questionId: fx.qSolutionId },
    });
    expect((ans.response as { photoOssKey?: string }).photoOssKey).toBe(key);
  });

  it('photo_pregrade=beta+白名单:公式填空作答真实入队,AI 预批写 grading_records', async () => {
    await setStage('photo_pregrade', 'beta');
    await setWhitelist('photo_pregrade', [Number(fx.s1Id)]);
    const start = await request(http).post('/api/v1/student/attempts').set(auth(s1))
      .send({ assignmentId: fx.preAssignmentId }).expect(200);
    const attemptId = start.body.data.id as number;
    await request(http)
      .put(`/api/v1/student/attempts/${attemptId}/answers/${Number(fx.qFormulaId)}`)
      .set(auth(s1)).send({ response: { texts: ['\\frac{1}{2}'] } }).expect(200);
    const ans = await raw.answer.findFirstOrThrow({
      where: { attemptId: BigInt(attemptId), questionId: fx.qFormulaId },
    });
    const rec = await waitFor(
      () => raw.gradingRecord.findFirst({ where: { answerId: ans.id, aiScore: { not: null } } }),
      '白名单学生的预批任务完成',
    );
    expect(Number(rec.aiScore)).toBeGreaterThanOrEqual(0);
  });

  // ================= ⑦ wrong_redo 堵坑 =================

  it('redo-all:错题含客观+主观+公式 → 重做卷只组客观题(1 题),主观/公式被过滤', async () => {
    const res = await request(http).post('/api/v1/student/wrong-book/redo-all').set(auth(s1)).expect(200);
    const assignment = res.body.data as AssignmentDto;
    expect(assignment.kind).toBe('wrong_redo');
    expect(assignment.questionCount).toBe(1);
    const pqs = await raw.paperQuestion.findMany({ where: { paperId: BigInt(assignment.paperId) } });
    expect(pqs.map((pq) => String(pq.questionId))).toEqual([String(fx.qSingleId)]);
  });

  it('错题全为主观/公式:单题 redo 与 redo-all 均业务错误 4503(不建空卷)', async () => {
    const single = await request(http)
      .post(`/api/v1/student/wrong-book/${fx.s2SolutionEntryId}/redo`).set(auth(s2)).expect(409);
    expect(single.body.code).toBe(4503);
    const all = await request(http).post('/api/v1/student/wrong-book/redo-all').set(auth(s2)).expect(409);
    expect(all.body.code).toBe(4503);
  });

  // ================= ② 审计 =================

  it('审计:stage 与白名单变更均写 audit_logs(action/detail 可追溯)', async () => {
    const stageLogs = await raw.auditLog.findMany({
      where: { orgId: fx.orgId, action: 'admin.feature.stage_update' },
      orderBy: { id: 'desc' },
    });
    expect(stageLogs.length).toBeGreaterThan(0);
    expect((stageLogs[0].detail as { key?: string }).key).toBeDefined();
    const wlLogs = await raw.auditLog.findMany({
      where: { orgId: fx.orgId, action: 'admin.feature.whitelist_update' },
      orderBy: { id: 'desc' },
    });
    expect(wlLogs.length).toBeGreaterThan(0);
    const detail = wlLogs[0].detail as { key?: string; userIds?: number[] };
    expect(detail.key).toBe('photo_pregrade');
    expect(detail.userIds).toEqual([Number(fx.s1Id)]);
  });
});
