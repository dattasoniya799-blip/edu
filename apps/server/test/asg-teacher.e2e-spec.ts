/**
 * Assignment teacher 锚点验收(经用户批准的 schema 变更,迁移 0002):
 *  ① [红线] 定向作业(consolidation,target=studentIds,无讲次)归属创建教师:
 *     出现在 A 的 GET /assignments 总览与 /grading/pending;
 *     他师 B 读其 名单/answers/详情/review/finalize/adopt-ai/progress → 404;
 *  ② 学生自发 wrong_redo(teacherId=null 且无 course 锚点):不出现在任何教师
 *     pending/总览,任何教师对其读写 → 404(含 solution 题时会停在 submitted,如实记录);
 *  ③ 回填兼容口径:teacherId=null + lesson 锚点的"老作业"→ 授课教师可见可操作,他师 404。
 * 迁移 0002 的 SQL 回填正确性另由「旧库升级验证」覆盖(对旧结构库执行 0002 后 SELECT 抽查)。
 */
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { ASG_PASSWORD, AsgFixture, createAsgOrg, dropAsgOrg } from './fixtures/asg.fixtures';
import { createApp, loginStudentById, raw } from './fixtures/setup';

describe('Assignment teacher 锚点(定向作业归属 + wrong_redo 隔离 + 回填兼容)', () => {
  let app: INestApplication;
  let http: any;
  let fx: AsgFixture;
  let teacherA: string;
  let teacherB: string;
  let s1: string;

  // 跨用例共享
  let directedId: number; // A 发布的定向 consolidation
  let directedAttemptId: number;
  let directedSolAnswerId: number;
  let redoId: number; // s1 自发 wrong_redo(含 solution)
  let redoSolAnswerId: number;

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const login = async (phone: string) => {
    const res = await request(http).post('/api/v1/auth/login').send({ phone, password: ASG_PASSWORD }).expect(200);
    return res.body.data.accessToken as string;
  };

  beforeAll(async () => {
    app = await createApp();
    http = app.getHttpServer();
    fx = await createAsgOrg();
    teacherA = await login(fx.teacherAPhone);
    teacherB = await login(fx.teacherBPhone);
    s1 = await loginStudentById(http, fx.s1Id);
  });

  afterAll(async () => {
    await app.close();
    await dropAsgOrg(fx.orgId);
    await raw.$disconnect();
  });

  // ================= teacherId 写入(创建路径) =================

  it('教师发布定向 consolidation(studentIds,无讲次)→ assignments.teacher_id=发布教师', async () => {
    const res = await request(http).post('/api/v1/assignments').set(auth(teacherA))
      .send({
        paperId: fx.paperDirectedId,
        kind: 'consolidation',
        target: { studentIds: [Number(fx.s1Id), Number(fx.s2Id)] },
      })
      .expect(200);
    directedId = res.body.data.id as number;
    const row = await raw.assignment.findFirstOrThrow({ where: { id: BigInt(directedId) } });
    expect(row.teacherId).toBe(fx.teacherAId);
    expect(row.lessonId).toBeNull();
  });

  // ================= ① 红线2:定向作业出现在创建教师总览 =================

  it('① GET /assignments:定向作业出现在 A 的总览(totalStudents=2);B 的总览不含', async () => {
    const listA = await request(http).get('/api/v1/assignments').set(auth(teacherA)).expect(200);
    const briefsA = listA.body.data as any[];
    const mine = briefsA.find((b) => b.id === directedId);
    expect(mine).toBeDefined();
    expect(mine.kind).toBe('consolidation');
    expect(mine.lessonId).toBeNull();
    expect(mine.totalStudents).toBe(2);
    // 回填兼容口径:teacherId=null + lesson 锚点的老作业也在 A 总览(③ 一并断言)
    expect(briefsA.some((b) => b.id === fx.legacyAssignmentId)).toBe(true);

    const listB = await request(http).get('/api/v1/assignments').set(auth(teacherB)).expect(200);
    const briefsB = listB.body.data as any[];
    expect(briefsB.some((b) => b.id === directedId)).toBe(false);
    expect(briefsB.some((b) => b.id === fx.legacyAssignmentId)).toBe(false);
  });

  // ================= 学生作答(学生侧行为不受 teacherId 影响) =================

  it('准备:s1 作答定向作业(single 答错 + solution 文本)→ submitted 待复核', async () => {
    const start = await request(http).post('/api/v1/student/attempts').set(auth(s1))
      .send({ assignmentId: directedId }).expect(200);
    directedAttemptId = start.body.data.id as number;
    await request(http).put(`/api/v1/student/attempts/${directedAttemptId}/answers/${Number(fx.qSingleId)}`)
      .set(auth(s1)).send({ response: { choice: 'A' } }).expect(200); // 错(正确 B)
    await request(http).put(`/api/v1/student/attempts/${directedAttemptId}/answers/${Number(fx.qSolId)}`)
      .set(auth(s1)).send({ response: { text: 'x=3(过程略)' } }).expect(200);
    await request(http).post(`/api/v1/student/attempts/${directedAttemptId}/submit`).set(auth(s1)).expect(200);

    const row = await raw.answer.findFirstOrThrow({
      where: { attemptId: BigInt(directedAttemptId), questionId: fx.qSolId },
    });
    directedSolAnswerId = Number(row.id);
  });

  // ================= ① 红线1:他师读定向作业的作答/批改 → 404 =================

  it('① 定向作业进 A 的 /grading/pending;B 的 pending 不含', async () => {
    const pendA = await request(http).get('/api/v1/grading/pending').set(auth(teacherA)).expect(200);
    const gA = (pendA.body.data as any[]).find((g) => g.assignmentId === directedId);
    expect(gA).toBeDefined();
    expect(gA.pendingCount).toBe(1);

    const pendB = await request(http).get('/api/v1/grading/pending').set(auth(teacherB)).expect(200);
    expect((pendB.body.data as any[]).some((g) => g.assignmentId === directedId)).toBe(false);
  });

  it('① 他师 B 对定向作业的全套读写 → 404;创建教师 A 正常', async () => {
    // B:名单 / 详情 / review / finalize / adopt-ai / progress 全 404(不泄露存在性)
    await request(http).get(`/api/v1/grading/assignments/${directedId}/answers`).set(auth(teacherB)).expect(404);
    await request(http).get(`/api/v1/grading/answers/${directedSolAnswerId}`).set(auth(teacherB)).expect(404);
    await request(http).put(`/api/v1/grading/answers/${directedSolAnswerId}/review`).set(auth(teacherB))
      .send({ finalScore: 1 }).expect(404);
    await request(http).post(`/api/v1/grading/assignments/${directedId}/finalize`).set(auth(teacherB)).expect(404);
    await request(http).post(`/api/v1/grading/assignments/${directedId}/adopt-ai`).set(auth(teacherB)).expect(404);
    await request(http).get(`/api/v1/assignments/${directedId}/progress`).set(auth(teacherB)).expect(404);

    // A:名单 / 详情 / progress 正常
    const answers = await request(http).get(`/api/v1/grading/assignments/${directedId}/answers`).set(auth(teacherA)).expect(200);
    expect((answers.body.data as any[]).some((a) => a.answerId === directedSolAnswerId)).toBe(true);
    await request(http).get(`/api/v1/grading/answers/${directedSolAnswerId}`).set(auth(teacherA)).expect(200);
    const prog = await request(http).get(`/api/v1/assignments/${directedId}/progress`).set(auth(teacherA)).expect(200);
    expect(prog.body.data.totalStudents).toBe(2);
    expect(prog.body.data.submitted).toBe(1);
  });

  it('① A 复核(4/10)+ finalize → 出分;s1 两道错题入账(供 wrong_redo 流程)', async () => {
    await request(http).put(`/api/v1/grading/answers/${directedSolAnswerId}/review`).set(auth(teacherA))
      .send({ finalScore: 4, comment: '方向错误' }).expect(200);
    await request(http).post(`/api/v1/grading/assignments/${directedId}/finalize`).set(auth(teacherA)).expect(200);

    const at = await raw.attempt.findFirstOrThrow({ where: { id: BigInt(directedAttemptId) } });
    expect(at.status).toBe('graded');
    expect(Number(at.score)).toBe(4); // 客观 0 + 主观 4
    // single 答错 + solution 未满分 → 两条错题(open)
    expect(await raw.wrongBookEntry.count({ where: { studentId: fx.s1Id, status: 'open' } })).toBe(2);
  });

  // ================= ② 学生自发 wrong_redo:任何教师不可见不可操作 =================

  it('② s1 一键重练 → wrong_redo assignment 的 teacher_id=null(学生自发)', async () => {
    const res = await request(http).post('/api/v1/student/wrong-book/redo-all').set(auth(s1)).expect(200);
    redoId = res.body.data.id as number;
    expect(res.body.data.kind).toBe('wrong_redo');
    const row = await raw.assignment.findFirstOrThrow({ where: { id: BigInt(redoId) } });
    expect(row.teacherId).toBeNull();
    expect(row.lessonId).toBeNull(); // 无 course 锚点
  });

  it('② s1 作答 wrong_redo(含 solution)→ submitted;不进任何教师 pending/总览', async () => {
    const start = await request(http).post('/api/v1/student/attempts').set(auth(s1))
      .send({ assignmentId: redoId }).expect(200);
    const atId = start.body.data.id as number;
    await request(http).put(`/api/v1/student/attempts/${atId}/answers/${Number(fx.qSingleId)}`)
      .set(auth(s1)).send({ response: { choice: 'B' } }).expect(200); // 对
    await request(http).put(`/api/v1/student/attempts/${atId}/answers/${Number(fx.qSolId)}`)
      .set(auth(s1)).send({ response: { text: 'x=2(重做)' } }).expect(200);
    await request(http).post(`/api/v1/student/attempts/${atId}/submit`).set(auth(s1)).expect(200);
    // 含 solution → 不自动出分,停在 submitted(见 spec 头注:如实记录,无教师批改路径)
    const at = await raw.attempt.findFirstOrThrow({ where: { id: BigInt(atId) } });
    expect(at.status).toBe('submitted');
    const ans = await raw.answer.findFirstOrThrow({
      where: { attemptId: BigInt(atId), questionId: fx.qSolId },
    });
    redoSolAnswerId = Number(ans.id);

    // 两位教师的 pending / 总览均不含 wrong_redo
    for (const t of [teacherA, teacherB]) {
      const pend = await request(http).get('/api/v1/grading/pending').set(auth(t)).expect(200);
      expect((pend.body.data as any[]).some((g) => g.assignmentId === redoId)).toBe(false);
      const list = await request(http).get('/api/v1/assignments').set(auth(t)).expect(200);
      expect((list.body.data as any[]).some((b) => b.id === redoId)).toBe(false);
    }
  });

  it('② 任何教师对 wrong_redo 的读写(名单/详情/review/finalize/progress)→ 404', async () => {
    for (const t of [teacherA, teacherB]) {
      await request(http).get(`/api/v1/grading/assignments/${redoId}/answers`).set(auth(t)).expect(404);
      await request(http).get(`/api/v1/grading/answers/${redoSolAnswerId}`).set(auth(t)).expect(404);
      await request(http).put(`/api/v1/grading/answers/${redoSolAnswerId}/review`).set(auth(t))
        .send({ finalScore: 1 }).expect(404);
      await request(http).post(`/api/v1/grading/assignments/${redoId}/finalize`).set(auth(t)).expect(404);
      await request(http).post(`/api/v1/grading/assignments/${redoId}/adopt-ai`).set(auth(t)).expect(404);
      await request(http).get(`/api/v1/assignments/${redoId}/progress`).set(auth(t)).expect(404);
    }
  });

  // ================= ③ 回填兼容:teacherId=null + lesson 锚点的老作业 =================

  it('③ 老作业(teacherId=null,lesson 锚点→courseA):授课教师 A 可操作,他师 B → 404', async () => {
    const L = fx.legacyAssignmentId;
    // A:progress / 批改名单正常(名单为空数组 —— 纯客观卷无复核题)
    const prog = await request(http).get(`/api/v1/assignments/${L}/progress`).set(auth(teacherA)).expect(200);
    expect(prog.body.data.totalStudents).toBe(2);
    const answers = await request(http).get(`/api/v1/grading/assignments/${L}/answers`).set(auth(teacherA)).expect(200);
    expect(answers.body.data).toEqual([]);
    // B:404
    await request(http).get(`/api/v1/assignments/${L}/progress`).set(auth(teacherB)).expect(404);
    await request(http).get(`/api/v1/grading/assignments/${L}/answers`).set(auth(teacherB)).expect(404);
  });
});
