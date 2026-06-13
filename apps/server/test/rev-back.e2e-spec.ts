/**
 * REV-back · 代码审核确认的 7 个后端真问题修复验收(不改 contracts/schema):
 *  #1 学生重置密码吊销其全部 refresh token(旧令牌 refresh → 401)
 *  #2 Prisma 已知异常映射(P2002→409 / P2025→404 / P2003→400 / 22003→400;其余 500)
 *  #3 试卷分值上界(单题 >9999.9 → 400,不再 DB 溢出 500)
 *  #4 /uploads/view-url 归属校验(跨租户/非法 purpose ossKey → 403)
 *  #5 已完成的 homework/in_class 不可重作(再开 → 4502);consolidation 等仍可重做
 *  #6 环节时长:homework/break_time 允许 0,其余仍须 ≥1
 *  #7 已 graded 作答再 review:回写 answers.score 并重算 attempt.score
 * 夹具:13912 号段自建自清(test/fixtures/rev.fixtures.ts);seed 数据只读。
 */
import { INestApplication } from '@nestjs/common';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import request from 'supertest';

// 固定 UPLOAD_ROOT 到临时目录(避免污染仓库),createApp 前设置
const UPLOAD_ROOT = mkdtempSync(join(tmpdir(), 'qiming-rev-'));
process.env.UPLOAD_ROOT = UPLOAD_ROOT;

import { Prisma } from '@prisma/client';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { REV_PASSWORD, RevFixture, createRevOrg, dropRevOrg } from './fixtures/rev.fixtures';
import { createApp, raw } from './fixtures/setup';

describe('REV-back · 后端真问题修复(7 项)', () => {
  let app: INestApplication;
  let http: any;
  let fx: RevFixture;
  let admin: string;
  let teacher: string;
  let s1: string;

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const login = async (phone: string, password: string) => {
    const res = await request(http).post('/api/v1/auth/login').send({ phone, password }).expect(200);
    return res.body.data.accessToken as string;
  };
  /** 学生登录,返回完整令牌对(含 refreshToken,供 #1) */
  const studentLoginFull = async (sid: bigint, password = 'Stu@Rev123') => {
    const { hashPassword } = await import('../src/auth/password.util');
    const u = await raw.user.update({
      where: { id: sid },
      data: { passwordHash: await hashPassword(password), status: 'active' },
    });
    const res = await request(http)
      .post('/api/v1/auth/student/login')
      .send({ studentNo: u.studentNo, password })
      .expect(200);
    return res.body.data as { accessToken: string; refreshToken: string };
  };

  beforeAll(async () => {
    app = await createApp();
    http = app.getHttpServer();
    fx = await createRevOrg();
    admin = await login(fx.adminPhone, REV_PASSWORD);
    teacher = await login(fx.teacherPhone, REV_PASSWORD);
    s1 = (await studentLoginFull(fx.s1Id)).accessToken;
  });

  afterAll(async () => {
    await app.close();
    await dropRevOrg(fx.orgId);
    await raw.$disconnect();
    rmSync(UPLOAD_ROOT, { recursive: true, force: true });
  });

  // ================= #1 重置密码吊销会话 =================
  it('#1 重置学生密码后,其旧 refresh token 失效(401);未被重置者的 refresh 正常(200)', async () => {
    // 正向对照:s1 的 refresh 可用
    const t1 = await studentLoginFull(fx.s1Id);
    await request(http).post('/api/v1/auth/refresh').send({ refreshToken: t1.refreshToken }).expect(200);

    // 目标:s2 登录拿 refresh,管理员重置 s2 密码后,旧 refresh → 401
    const t2 = await studentLoginFull(fx.s2Id);
    await request(http)
      .post(`/api/v1/admin/students/${fx.s2Id}/reset-password`)
      .set(auth(admin))
      .expect(200);
    await request(http).post('/api/v1/auth/refresh').send({ refreshToken: t2.refreshToken }).expect(401);
  });

  // ================= #2 Prisma 异常映射(直测全局过滤器)=================
  it('#2 AllExceptionsFilter 将 Prisma 已知错误映射为合适 HTTP(P2002→409 / P2025→404 / P2003→400 / 22003→400;其余 500)', () => {
    const filter = new AllExceptionsFilter();
    const run = (exc: unknown) => {
      const json = jest.fn((..._args: any[]) => undefined);
      const status = jest.fn((..._args: any[]) => ({ json }));
      const host: any = { switchToHttp: () => ({ getResponse: () => ({ status }) }) };
      filter.catch(exc, host);
      return {
        code: status.mock.calls[0][0] as number,
        body: json.mock.calls[0][0] as { code: number },
      };
    };
    const known = (code: string, message = code) =>
      new Prisma.PrismaClientKnownRequestError(message, { code, clientVersion: '5.22.0' });

    expect(run(known('P2002')).code).toBe(409);
    expect(run(known('P2025')).code).toBe(404);
    expect(run(known('P2003')).code).toBe(400);
    expect(run(known('P2000')).code).toBe(400);
    // 未单独映射的 Prisma 已知错误,但携带 22003(数值溢出)→ 400
    expect(run(known('P2010', 'numeric field overflow (SQLSTATE 22003)')).code).toBe(400);
    // 其余未知错误仍 500,且响应体 {code} 与状态一致
    const generic = run(new Error('boom'));
    expect(generic.code).toBe(500);
    expect(generic.body.code).toBe(500);
  });

  // ================= #3 试卷分值上界 =================
  it('#3 单题分值越界(>9999.9)→ 400(不再 DB 溢出 500);正常分值创建成功', async () => {
    const over = await request(http)
      .post('/api/v1/papers')
      .set(auth(teacher))
      .send({ name: 'REV 越界卷', type: 'practice', questions: [{ questionId: Number(fx.qAId), score: 100000 }] })
      .expect(400);
    expect(over.body.code).toBe(400);

    const ok = await request(http)
      .post('/api/v1/papers')
      .set(auth(teacher))
      .send({
        name: 'REV 正常卷',
        type: 'practice',
        questions: [
          { questionId: Number(fx.qAId), score: 10 },
          { questionId: Number(fx.qBId), score: 10 },
        ],
      })
      .expect(200);
    expect(ok.body.data.totalScore).toBe(20);
    // 清理:该卷未被引用,直接删
    await raw.paperQuestion.deleteMany({ where: { paperId: BigInt(ok.body.data.id) } });
    await raw.paper.deleteMany({ where: { id: BigInt(ok.body.data.id) } });
  });

  // ================= #4 view-url 归属校验 =================
  it('#4 /uploads/view-url 仅放行本机构前缀 ossKey;跨租户/非法 purpose → 403;缺参/穿越 → 400;未登录 → 401', async () => {
    const orgId = Number(fx.orgId);
    const url = (k: string) => `/api/v1/uploads/view-url?ossKey=${encodeURIComponent(k)}`;

    // 本机构 answer_photo → 200
    const ok = await request(http).get(url(`answer_photo/${orgId}/202506/abc123def456.jpg`)).set(auth(s1)).expect(200);
    expect(typeof ok.body.data.url).toBe('string');

    // 跨租户(他机构前缀)→ 403
    await request(http).get(url(`answer_photo/${orgId + 1}/202506/abc.jpg`)).set(auth(s1)).expect(403);
    // 非法 purpose 段 → 403
    await request(http).get(url(`evil/${orgId}/202506/abc.jpg`)).set(auth(s1)).expect(403);
    // 缺参 → 400;路径穿越 → 400
    await request(http).get('/api/v1/uploads/view-url').set(auth(s1)).expect(400);
    await request(http).get(url(`answer_photo/${orgId}/../secret.jpg`)).set(auth(s1)).expect(400);
    // 未登录 → 401
    await request(http).get(url(`answer_photo/${orgId}/202506/abc.jpg`)).expect(401);
  });

  // ================= #5 已完成不可重作 =================
  it('#5 已完成的 homework 不可重开(4502);consolidation 完成后仍可重做', async () => {
    const startBody = (assignmentId: number) => ({ assignmentId });
    const start = (token: string, assignmentId: number) =>
      request(http).post('/api/v1/student/attempts').set(auth(token)).send(startBody(assignmentId));
    const answer = (token: string, attemptId: number, qid: number, choice: string) =>
      request(http)
        .put(`/api/v1/student/attempts/${attemptId}/answers/${qid}`)
        .set(auth(token))
        .send({ response: { choice } })
        .expect(200);
    const submit = (token: string, attemptId: number) =>
      request(http).post(`/api/v1/student/attempts/${attemptId}/submit`).set(auth(token)).expect(200);

    // homework:作答 + 交卷(纯客观 → 自动出分 graded)
    const a1 = await start(s1, fx.hwAssignmentId).expect(200);
    const at1 = a1.body.data.id as number;
    await answer(s1, at1, Number(fx.qAId), 'A');
    await answer(s1, at1, Number(fx.qBId), 'B');
    await submit(s1, at1);
    // 再开 → 业务错误 4502
    const blocked = await start(s1, fx.hwAssignmentId).expect(409);
    expect(blocked.body.code).toBe(4502);

    // consolidation:完成后仍可重开(新 attempt)
    const c1 = await start(s1, fx.conAssignmentId).expect(200);
    const ca1 = c1.body.data.id as number;
    await answer(s1, ca1, Number(fx.qAId), 'A');
    await answer(s1, ca1, Number(fx.qBId), 'B');
    await submit(s1, ca1);
    const c2 = await start(s1, fx.conAssignmentId).expect(200);
    expect(c2.body.data.id).not.toBe(ca1);
    expect(c2.body.data.attemptNo).toBe(2);
    expect(c2.body.data.status).toBe('in_progress');
  });

  // ================= #6 环节时长豁免 =================
  it('#6 环节时长:homework/break_time 允许 durationMin=0;lecture=0 → 400,lecture≥1 → 200', async () => {
    const putSegs = (segs: unknown[]) =>
      request(http).put(`/api/v1/lessons/${fx.lessonId}/segments`).set(auth(teacher)).send(segs);

    await putSegs([
      { seq: 1, type: 'homework', durationMin: 0 },
      { seq: 2, type: 'break_time', durationMin: 0 },
    ]).expect(200);

    await putSegs([{ seq: 1, type: 'lecture', durationMin: 0 }]).expect(400);
    await putSegs([{ seq: 1, type: 'lecture', durationMin: 1 }]).expect(200);
  });

  // ================= #7 review 回写已 graded 作答 =================
  it('#7 已 graded 作答再 review:回写 answers.score 并重算 attempt.score(不再分叉)', async () => {
    // s1 作答主观卷:单选(对,10 分)+ 解答题(文本作答,走复核)
    const a = await request(http)
      .post('/api/v1/student/attempts')
      .set(auth(s1))
      .send({ assignmentId: fx.subAssignmentId })
      .expect(200);
    const attemptId = a.body.data.id as number;
    await request(http)
      .put(`/api/v1/student/attempts/${attemptId}/answers/${Number(fx.qAId)}`)
      .set(auth(s1))
      .send({ response: { choice: 'A' } })
      .expect(200);
    await request(http)
      .put(`/api/v1/student/attempts/${attemptId}/answers/${Number(fx.qSolId)}`)
      .set(auth(s1))
      .send({ response: { text: '由 (a-b)^2>=0 展开即证。' } })
      .expect(200);
    await request(http).post(`/api/v1/student/attempts/${attemptId}/submit`).set(auth(s1)).expect(200);

    // 取解答题作答 id
    const solAnswer = await raw.answer.findFirstOrThrow({
      where: { attemptId: BigInt(attemptId), questionId: fx.qSolId },
    });
    const reviewUrl = `/api/v1/grading/answers/${Number(solAnswer.id)}/review`;

    // 首次复核 5 分 → finalize 出分:attempt graded,objective(10)+subjective(5)=15
    await request(http).put(reviewUrl).set(auth(teacher)).send({ finalScore: 5 }).expect(200);
    await request(http)
      .post(`/api/v1/grading/assignments/${fx.subAssignmentId}/finalize`)
      .set(auth(teacher))
      .expect(200);
    const afterFinalize = await raw.attempt.findFirstOrThrow({ where: { id: BigInt(attemptId) } });
    const solAfter5 = await raw.answer.findFirstOrThrow({ where: { id: solAnswer.id } });
    expect(afterFinalize.status).toBe('graded');
    expect(Number(afterFinalize.score)).toBe(15);
    expect(Number(solAfter5.score)).toBe(5);

    // 已 graded 后再 review 改 8 分 → answers.score 与 attempt.score 同步更新(修复前会停留 15)
    await request(http).put(reviewUrl).set(auth(teacher)).send({ finalScore: 8 }).expect(200);
    const afterReview = await raw.attempt.findFirstOrThrow({ where: { id: BigInt(attemptId) } });
    const solAfter8 = await raw.answer.findFirstOrThrow({ where: { id: solAnswer.id } });
    expect(Number(solAfter8.score)).toBe(8);
    expect(Number(afterReview.subjectiveScore)).toBe(8);
    expect(Number(afterReview.score)).toBe(18);
  });
});
