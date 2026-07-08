/**
 * 走查回归验收(后端 · fix-flow-server):
 *  S1 POST /student/attempts 幂等:并发两次创建同一作业 attempt → 两次都 200 且同一 attempt,库中仅 1 行。
 *  S3 GET /grading/pending 不依赖"有待批主观题":学生跳过 solution 交卷 → 混合卷 attempt 停 submitted、
 *     0 待批 → 该作业仍出现在 pending(pendingCount=0);空待批时 finalize 仍可出分。
 *  S4 布置作业允许任意已发布试卷:用 practice 类型 published 卷创建 homework 作业 → 200。
 *  S5 currentLesson=已结束讲次数:排定结束时间已过(未开直播)也计入 → 期望 2/3。
 *  S6 课件授权正例:被授权学生换取回看 URL → 200;view-url 归属校验(本机构 200 / 他机构 403);
 *     物理文件缺失 → 下载端 404(前端可优雅降级)。
 * 注:S2(纯客观卷交卷自动出分)在 main 已实现且由 a5/sec-back/asg-teacher/rev-back 覆盖,本卷不再重复。
 */
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createFixgOrg, dropFixgOrg, FIXG_PASSWORD, FixgFixture } from './fixtures/fixg.fixtures';
import { createApp, loginStudentById, raw } from './fixtures/setup';

const PENDING_KEYS = ['assignmentId', 'paperName', 'pendingCount', 'aiAvgScore'];

describe('走查回归 S1/S3/S4/S5/S6(后端)', () => {
  let app: INestApplication;
  let http: any;
  let fx: FixgFixture;
  let teacher: string;
  let s1: string;

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  beforeAll(async () => {
    app = await createApp();
    http = app.getHttpServer();
    fx = await createFixgOrg();
    const res = await request(http).post('/api/v1/auth/login')
      .send({ phone: fx.teacherPhone, password: FIXG_PASSWORD }).expect(200);
    teacher = res.body.data.accessToken;
    s1 = await loginStudentById(http, fx.s1Id);
  });

  afterAll(async () => {
    await app.close();
    await dropFixgOrg(fx.orgId);
    await raw.$disconnect();
  });

  // ================= S1:并发开始作答幂等 =================
  it('S1:并发两次 POST /student/attempts(同一作业)→ 两次都 200 且同一 attempt,库中仅 1 行', async () => {
    const [r1, r2] = await Promise.all([
      request(http).post('/api/v1/student/attempts').set(auth(s1)).send({ assignmentId: fx.asgObjId }),
      request(http).post('/api/v1/student/attempts').set(auth(s1)).send({ assignmentId: fx.asgObjId }),
    ]);
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(r1.body.data.id).toBe(r2.body.data.id); // 同一 attempt(幂等)
    const count = await raw.attempt.count({
      where: { assignmentId: BigInt(fx.asgObjId), studentId: fx.s1Id },
    });
    expect(count).toBe(1); // 撞唯一约束的一路被幂等收敛,不产生第二行

    // 再次调用仍返回同一 in_progress attempt(断点续答语义)
    const r3 = await request(http).post('/api/v1/student/attempts').set(auth(s1))
      .send({ assignmentId: fx.asgObjId }).expect(200);
    expect(r3.body.data.id).toBe(r1.body.data.id);
  });

  // ================= S3:pending 不依赖待批主观题 + 空待批可 finalize =================
  it('S3:学生只答客观、跳过 solution 交卷 → 混合卷 attempt 停 submitted', async () => {
    const start = await request(http).post('/api/v1/student/attempts').set(auth(s1))
      .send({ assignmentId: fx.asgMixedId }).expect(200);
    const atId = start.body.data.id as number;
    // 仅作答客观题(答对 B),solution 跳过不答 → 无 solution 作答行
    await request(http).put(`/api/v1/student/attempts/${atId}/answers/${Number(fx.qSingleId)}`)
      .set(auth(s1)).send({ response: { choice: 'B' } }).expect(200);
    const sub = await request(http).post(`/api/v1/student/attempts/${atId}/submit`).set(auth(s1)).expect(200);
    expect(sub.body.data.status).toBe('submitted'); // 混合卷(含 solution)→ 不自动出分
  });

  it('S3:该作业出现在教师 /grading/pending(pendingCount=0,零待批)', async () => {
    const res = await request(http).get('/api/v1/grading/pending').set(auth(teacher)).expect(200);
    const group = (res.body.data as any[]).find((g) => g.assignmentId === fx.asgMixedId);
    expect(group).toBeDefined(); // 跳过没答主观题也必须可见(否则教师无从 finalize)
    expect(Object.keys(group).sort()).toEqual([...PENDING_KEYS].sort());
    expect(group.pendingCount).toBe(0);
    expect(group.aiAvgScore).toBeNull();
  });

  it('S3:空待批时 finalize 仍可出分 → attempt graded、客观分入账', async () => {
    await request(http).post(`/api/v1/grading/assignments/${fx.asgMixedId}/finalize`).set(auth(teacher)).expect(200);
    const at = await raw.attempt.findFirstOrThrow({
      where: { assignmentId: BigInt(fx.asgMixedId), studentId: fx.s1Id },
    });
    expect(at.status).toBe('graded');
    expect(Number(at.score)).toBe(5); // 客观 5 + 主观(未答)0
    // finalize 后不再是 submitted → 退出 pending
    const res = await request(http).get('/api/v1/grading/pending').set(auth(teacher)).expect(200);
    expect((res.body.data as any[]).some((g) => g.assignmentId === fx.asgMixedId)).toBe(false);
  });

  // ================= S4:practice 卷可布置为 homework 作业 =================
  it('S4:用 practice 类型 published 卷创建 homework 作业 → 200(服务端不限制 paper type)', async () => {
    const res = await request(http).post('/api/v1/assignments').set(auth(teacher))
      .send({ paperId: fx.paperPracticeId, kind: 'homework', target: { courseId: Number(fx.courseId) } })
      .expect(200);
    expect(res.body.data.paperId).toBe(fx.paperPracticeId);
    expect(res.body.data.kind).toBe('homework');
  });

  // ================= S5:currentLesson=已结束讲次数 =================
  it('S5:课程卡 currentLesson=已结束讲次数(时间已过/finished 计入,未来 draft 不计)→ 2/3', async () => {
    const t = await request(http).get('/api/v1/teacher/courses').set(auth(teacher)).expect(200);
    const cT = (t.body.data as any[]).find((c) => c.id === Number(fx.courseId));
    expect(cT).toBeDefined();
    expect(cT.totalLessons).toBe(3);
    expect(cT.currentLesson).toBe(2); // L1(时间已过,ready)+ L2(finished);L3 未来 draft 不计

    const st = await request(http).get('/api/v1/student/courses').set(auth(s1)).expect(200);
    const cS = (st.body.data as any[]).find((c) => c.id === Number(fx.courseId));
    expect(cS.currentLesson).toBe(2); // 学生端同口径
  });

  // ================= S6:课件授权正例 + 归属校验 + 缺失文件 404 =================
  it('S6:被授权学生换取课件回看 URL → 200(不再 403)', async () => {
    const res = await request(http).get(`/api/v1/student/resources/${fx.resourceId}/view`).set(auth(s1)).expect(200);
    expect(typeof res.body.data.url).toBe('string');
    expect(res.body.data.url).toContain('/student/resources/local/');
    expect(res.body.data.expiresAt).toEqual(expect.any(String));

    // 物理文件不存在 → 下载端 404(前端可优雅降级),而非 403
    const path = res.body.data.url.replace(/^https?:\/\/[^/]+/, '');
    await request(http).get(path).expect(404);
  });

  it('S6:GET /uploads/view-url 归属校验 —— 本机构 canonical key 200,他机构 key 403', async () => {
    const ok = await request(http).get('/api/v1/uploads/view-url')
      .query({ ossKey: fx.resourceOssKey }).set(auth(s1)).expect(200);
    expect(typeof ok.body.data.url).toBe('string');

    // 他机构 orgId 段 → 403(纵深防御,归属校验保留)
    await request(http).get('/api/v1/uploads/view-url')
      .query({ ossKey: `resource/999999/demo/x.html` }).set(auth(s1)).expect(403);
  });
});
