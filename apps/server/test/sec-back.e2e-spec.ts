/**
 * sec-back 安全修复验收(隔离库,BULLMQ_PREFIX=clstest):
 *  #5 并发安全:并发交卷 / 并发 finalize 都只结算一次(错题 wrongCount 只 +1);
 *  #4 批改/讲次归属:同机构「他班」教师访问他人课程的 grading pending/名单/详情/review/
 *     finalize/adopt-ai → 404,讲次写操作(update/segments/publish)→ 404;授课教师正常;
 *  #6 资源 key 归属:作答 photoOssKey 与资源 ossKey 非本机构前缀/异用途/路径穿越 → 400/403。
 */
import { INestApplication } from '@nestjs/common';
import Redis from 'ioredis';
import request from 'supertest';
import { SEC_PASSWORD, SecFixture, createSecOrg, dropSecOrg } from './fixtures/sec.fixtures';
import { createApp, loginStudentById, raw } from './fixtures/setup';

describe('安全修复(并发安全 #5 / 批改讲次归属 #4 / 资源 key 归属 #6)', () => {
  let app: INestApplication;
  let http: any;
  let fx: SecFixture;
  let teacherA: string;
  let teacherB2: string;
  let s1: string;
  let s2: string;

  // 跨用例共享
  let a2AttemptS2: number;
  let solAnswerId: number;

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const login = async (phone: string) => {
    const res = await request(http).post('/api/v1/auth/login').send({ phone, password: SEC_PASSWORD }).expect(200);
    return res.body.data.accessToken as string;
  };

  beforeAll(async () => {
    app = await createApp();
    http = app.getHttpServer();
    fx = await createSecOrg();
    teacherA = await login(fx.teacherAPhone);
    teacherB2 = await login(fx.teacherB2Phone);
    s1 = await loginStudentById(http, fx.s1Id);
    s2 = await loginStudentById(http, fx.s2Id);
  });

  afterAll(async () => {
    await app.close();
    await dropSecOrg(fx.orgId);
    const redis = new Redis(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379/1');
    const prefix = process.env.BULLMQ_PREFIX ?? 'clstest';
    const keys = await redis.keys(`${prefix}:*`);
    if (keys.length) await redis.del(...keys);
    await redis.quit();
    await raw.$disconnect();
  });

  // ================= #5 并发交卷 =================

  it('#5 并发交卷(纯客观卷):一个 200 一个 4502,只结算一次(wrongCount 只 +1)', async () => {
    const start = await request(http).post('/api/v1/student/attempts').set(auth(s1))
      .send({ assignmentId: fx.assignmentA1Id }).expect(200);
    const attemptId = start.body.data.id as number;
    // 答错(正确 B)→ 结算后必入错题本
    await request(http).put(`/api/v1/student/attempts/${attemptId}/answers/${Number(fx.qSingleA1Id)}`)
      .set(auth(s1)).send({ response: { choice: 'A' } }).expect(200);

    // 两个并发交卷请求(不在中间 await,真正并发)
    const settled = await Promise.allSettled([
      request(http).post(`/api/v1/student/attempts/${attemptId}/submit`).set(auth(s1)),
      request(http).post(`/api/v1/student/attempts/${attemptId}/submit`).set(auth(s1)),
    ]);
    const statuses = settled
      .map((r) => (r.status === 'fulfilled' ? (r.value as any).status : 0))
      .sort((a, b) => a - b);
    expect(statuses).toEqual([200, 409]); // 恰一个夺到交卷,另一个 4502

    const at = await raw.attempt.findFirstOrThrow({ where: { id: BigInt(attemptId) } });
    expect(at.status).toBe('graded'); // 纯客观 → 自动出分
    // 错题只入账一次(并发未重复 accountAttempt)
    const entry = await raw.wrongBookEntry.findFirstOrThrow({
      where: { studentId: fx.s1Id, questionId: fx.qSingleA1Id },
    });
    expect(entry.wrongCount).toBe(1);
    expect(await raw.wrongBookEntry.count({ where: { studentId: fx.s1Id, questionId: fx.qSingleA1Id } })).toBe(1);
  });

  // ================= 共享:s2 提交 A2(留待复核) =================

  it('准备:s2 提交 A2(single 答错 + solution 拍照)→ submitted 待复核', async () => {
    const start = await request(http).post('/api/v1/student/attempts').set(auth(s2))
      .send({ assignmentId: fx.assignmentA2Id }).expect(200);
    a2AttemptS2 = start.body.data.id;
    await request(http).put(`/api/v1/student/attempts/${a2AttemptS2}/answers/${Number(fx.qSingleA2Id)}`)
      .set(auth(s2)).send({ response: { choice: 'A' } }).expect(200); // 错
    await request(http).put(`/api/v1/student/attempts/${a2AttemptS2}/answers/${Number(fx.qSolA2Id)}`)
      .set(auth(s2)).send({ response: { photoOssKey: `answer_photo/${Number(fx.orgId)}/202606/s2sol.jpg` } }).expect(200);
    await request(http).post(`/api/v1/student/attempts/${a2AttemptS2}/submit`).set(auth(s2)).expect(200);

    const row = await raw.answer.findFirstOrThrow({
      where: { attemptId: BigInt(a2AttemptS2), questionId: fx.qSolA2Id },
    });
    solAnswerId = Number(row.id);
  });

  // ================= #4 批改归属(同机构他班教师) =================

  it('#4 同机构他班教师 越权批改 → 404;授课教师正常', async () => {
    const A2 = fx.assignmentA2Id;
    // teacherB2(拥有 courseB2,不授 courseA)对 A2 的一切批改操作 → 404
    await request(http).get(`/api/v1/grading/assignments/${A2}/answers`).set(auth(teacherB2)).expect(404);
    await request(http).get(`/api/v1/grading/answers/${solAnswerId}`).set(auth(teacherB2)).expect(404);
    await request(http).put(`/api/v1/grading/answers/${solAnswerId}/review`).set(auth(teacherB2))
      .send({ finalScore: 1 }).expect(404);
    await request(http).post(`/api/v1/grading/assignments/${A2}/finalize`).set(auth(teacherB2)).expect(404);
    await request(http).post(`/api/v1/grading/assignments/${A2}/adopt-ai`).set(auth(teacherB2)).expect(404);

    // pending:teacherB2 看不到 A2 的待复核;teacherA 看得到
    const pendB2 = await request(http).get('/api/v1/grading/pending').set(auth(teacherB2)).expect(200);
    expect((pendB2.body.data as any[]).some((g) => g.assignmentId === A2)).toBe(false);
    const pendA = await request(http).get('/api/v1/grading/pending').set(auth(teacherA)).expect(200);
    expect((pendA.body.data as any[]).some((g) => g.assignmentId === A2)).toBe(true);

    // 授课教师 teacherA 读批改名单/详情正常
    await request(http).get(`/api/v1/grading/assignments/${A2}/answers`).set(auth(teacherA)).expect(200);
    await request(http).get(`/api/v1/grading/answers/${solAnswerId}`).set(auth(teacherA)).expect(200);
  });

  // ================= #4 讲次归属(写操作) =================

  it('#4 同机构他班教师 改/编排/发布他人讲次 → 404;授课教师正常', async () => {
    const L = fx.lessonAId;
    await request(http).put(`/api/v1/lessons/${L}`).set(auth(teacherB2)).send({ title: 'x' }).expect(404);
    await request(http).put(`/api/v1/lessons/${L}/segments`).set(auth(teacherB2))
      .send([{ seq: 1, type: 'lecture', durationMin: 10 }]).expect(404);
    await request(http).post(`/api/v1/lessons/${L}/publish`).set(auth(teacherB2)).expect(404);

    // 授课教师 teacherA 正常编排 + 发布
    await request(http).put(`/api/v1/lessons/${L}`).set(auth(teacherA)).send({ title: 'SEC 第1讲(改)' }).expect(200);
    await request(http).put(`/api/v1/lessons/${L}/segments`).set(auth(teacherA))
      .send([{ seq: 1, type: 'lecture', durationMin: 10 }]).expect(200);
    await request(http).post(`/api/v1/lessons/${L}/publish`).set(auth(teacherA)).expect(200);
  });

  // ================= #6 photoOssKey 归属 =================

  it('#6 作答 photoOssKey 非本机构前缀 / 异用途 / 路径穿越 → 400;合法 → 200', async () => {
    const start = await request(http).post('/api/v1/student/attempts').set(auth(s1))
      .send({ assignmentId: fx.assignmentA2Id }).expect(200);
    const atId = start.body.data.id;
    const put = (key: string) =>
      request(http).put(`/api/v1/student/attempts/${atId}/answers/${Number(fx.qSolA2Id)}`)
        .set(auth(s1)).send({ response: { photoOssKey: key } });

    await put(`answer_photo/${Number(fx.orgId) + 1}/202606/x.jpg`).expect(400); // 他机构前缀
    await put(`resource/${Number(fx.orgId)}/202606/x.jpg`).expect(400); // 异用途 purpose
    await put(`answer_photo/${Number(fx.orgId)}/../x.jpg`).expect(400); // 路径穿越
    await put(`answer_photo/${Number(fx.orgId)}/202606/ok.jpg`).expect(200); // 合法
  });

  // ================= #6 资源 ossKey 归属 =================

  it('#6 资源 ossKey 非本机构前缀 / 异用途 → 403;合法 → 200', async () => {
    const post = (ossKey: string) =>
      request(http).post('/api/v1/resources').set(auth(teacherA))
        .send({ type: 'pdf', name: 'SEC 课件', ossKey, size: 10 });

    await post(`resource/${Number(fx.orgId) + 1}/202606/x.pdf`).expect(403); // 他机构前缀
    await post(`answer_photo/${Number(fx.orgId)}/202606/x.pdf`).expect(403); // 异用途 purpose
    await post(`resource/${Number(fx.orgId)}/202606/ok.pdf`).expect(200); // 合法
  });

  // ================= #5 并发 finalize =================

  it('#5 并发 finalize:只结算一次(s2 两道错题 wrongCount 各只 +1)', async () => {
    // 授课教师复核 solution(给 4 分 < 满分 10 → 入错题本)
    await request(http).put(`/api/v1/grading/answers/${solAnswerId}/review`).set(auth(teacherA))
      .send({ finalScore: 4, comment: '部分正确' }).expect(200);

    // 并发两次 finalize(不在中间 await)
    const results = await Promise.all([
      request(http).post(`/api/v1/grading/assignments/${fx.assignmentA2Id}/finalize`).set(auth(teacherA)),
      request(http).post(`/api/v1/grading/assignments/${fx.assignmentA2Id}/finalize`).set(auth(teacherA)),
    ]);
    results.forEach((r) => expect(r.status).toBe(200)); // 幂等:都成功

    const at = await raw.attempt.findFirstOrThrow({ where: { id: BigInt(a2AttemptS2) } });
    expect(at.status).toBe('graded');
    expect(Number(at.score)).toBe(4); // 客观 0(答错)+ 主观 4

    // 两道错题(single 答错 + solution 未满分)各只入账一次
    const eSingle = await raw.wrongBookEntry.findFirstOrThrow({
      where: { studentId: fx.s2Id, questionId: fx.qSingleA2Id },
    });
    const eSol = await raw.wrongBookEntry.findFirstOrThrow({
      where: { studentId: fx.s2Id, questionId: fx.qSolA2Id },
    });
    expect(eSingle.wrongCount).toBe(1);
    expect(eSol.wrongCount).toBe(1);
  });
});
