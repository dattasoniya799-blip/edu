/**
 * 验收覆盖(C1GAP · 两项 C1 联调缺口后端):
 * #A AttemptDto.questions(题面):开始作答→questions 含全部题面、未答题 correctAnswer/analysis=null;
 *    答对一道客观题→该题 correctAnswer/analysis 下发;交卷后→全部下发;跨租户/他人 attempt 404。
 * #B GET /grading/assignments/:id/answers(批改名单):待复核题逐题列出(pendingCount 与 /grading/pending
 *    对齐);review 一题后该项 status→graded;?status 过滤;[teacher] 门禁;跨租户作业 404。
 */
import { INestApplication } from '@nestjs/common';
import Redis from 'ioredis';
import request from 'supertest';
import type { AttemptDto, AttemptQuestionView, GradingAnswerBriefDto } from '@qiming/contracts';
import { C1_PASSWORD, C1Fixture, createC1Org, dropC1Org } from './fixtures/c1gap.fixtures';
import { createApp, loginStudentById, raw } from './fixtures/setup';

const exactKeys = (obj: object, keys: string[]) =>
  expect(Object.keys(obj).sort()).toEqual([...keys].sort());

const ATTEMPT_QUESTION_KEYS = ['seq', 'questionId', 'score', 'type', 'stemLatex', 'figures', 'options', 'correctAnswer', 'analysisLatex'];
const BRIEF_KEYS = ['answerId', 'studentId', 'studentName', 'questionId', 'seq', 'status', 'aiScore', 'finalScore'];
const OPTION_KEYS = ['label', 'contentLatex'];

/** 轮询等待异步任务(BullMQ 真实执行) */
async function waitFor<T>(fn: () => Promise<T | null | false | undefined>, label: string, ms = 15000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v as T;
    if (Date.now() - start > ms) throw new Error(`waitFor 超时:${label}`);
    await new Promise((r) => setTimeout(r, 200));
  }
}

describe('C1 联调缺口后端(题面 + 批改名单)', () => {
  let app: INestApplication;
  let http: any;
  let fx: C1Fixture;
  let teacher: string;
  let teacherB: string;
  let s1: string;
  let s2: string;
  let studentB: string;

  let attemptId: number;
  let q4AnswerId: number; // s1 solution 作答
  let q5AnswerId: number; // s1 公式填空作答

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const login = async (phone: string) => {
    const res = await request(http).post('/api/v1/auth/login').send({ phone, password: C1_PASSWORD }).expect(200);
    return res.body.data.accessToken as string;
  };
  const qid = (i: number) => Number(fx.questionIds[i]);
  const qView = (at: AttemptDto, i: number) => at.questions.find((q) => q.questionId === qid(i))!;

  beforeAll(async () => {
    app = await createApp();
    http = app.getHttpServer();
    fx = await createC1Org();
    teacher = await login(fx.teacherPhone);
    teacherB = await login(fx.teacherBPhone);
    s1 = await loginStudentById(http, fx.s1Id);
    s2 = await loginStudentById(http, fx.s2Id);
    studentB = await loginStudentById(http, fx.studentBId);
  });

  afterAll(async () => {
    await app.close(); // 先停 BullMQ worker,再清数据
    await dropC1Org(fx.orgId, fx.orgBId);
    // 清理本任务 Redis 队列键(c1gap: 前缀纪律;禁碰其他库与 FLUSHALL)
    const redis = new Redis(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379');
    const keys = [
      ...(await redis.keys('c1gap:pre_grading:*')),
      ...(await redis.keys('c1gap:mastery:*')),
    ];
    if (keys.length) await redis.del(...keys);
    await redis.quit();
    await raw.$disconnect();
  });

  // ================= #A questions 题面 =================

  it('#A 开始作答:questions 含全部 5 道题面(seq 序),未答题 correctAnswer/analysis 均为 null', async () => {
    const res = await request(http).post('/api/v1/student/attempts').set(auth(s1))
      .send({ assignmentId: fx.assignmentId }).expect(200);
    const at: AttemptDto = res.body.data;
    attemptId = at.id;
    expect(at.status).toBe('in_progress');
    expect(at.questions).toHaveLength(5);
    expect(at.questions.map((q) => q.seq)).toEqual([1, 2, 3, 4, 5]);
    at.questions.forEach((q: AttemptQuestionView) => {
      exactKeys(q, ATTEMPT_QUESTION_KEYS);
      // 防作弊:in_progress 且未判 → 正确答案与解析不下发
      expect(q.correctAnswer).toBeNull();
      expect(q.analysisLatex).toBeNull();
    });
    // 题干 / 分值 / 学生视图选项(不含 isCorrect)
    const v1 = qView(at, 0);
    expect(v1.type).toBe('single');
    expect(v1.score).toBe(5);
    expect(v1.stemLatex).toContain('C1-Q1');
    expect(v1.options).toHaveLength(4);
    v1.options.forEach((o) => exactKeys(o, OPTION_KEYS));
    expect((v1.options[0] as unknown as Record<string, unknown>).isCorrect).toBeUndefined();
    expect(qView(at, 3).score).toBe(10); // solution
    expect(qView(at, 0).figures).toEqual([]);
  });

  it('#A 答对一道客观题:该题 correctAnswer + analysis 下发,其余仍为 null', async () => {
    await request(http).put(`/api/v1/student/attempts/${attemptId}/answers/${qid(0)}`)
      .set(auth(s1)).send({ response: { choice: 'B' } }).expect(200);
    const res = await request(http).get(`/api/v1/student/attempts/${attemptId}`).set(auth(s1)).expect(200);
    const at: AttemptDto = res.body.data;
    const v1 = qView(at, 0);
    expect(v1.correctAnswer).toEqual({ choice: 'B' });
    expect(v1.analysisLatex).toContain('上加下减');
    // 未作答的其余题仍不下发
    expect(qView(at, 1).correctAnswer).toBeNull();
    expect(qView(at, 1).analysisLatex).toBeNull();
    expect(qView(at, 3).correctAnswer).toBeNull();
  });

  it('#A 答错客观题也算「已判定」→ 下发正确答案 + 解析', async () => {
    await request(http).put(`/api/v1/student/attempts/${attemptId}/answers/${qid(1)}`)
      .set(auth(s1)).send({ response: { choices: ['A', 'B'] } }).expect(200);
    const res = await request(http).get(`/api/v1/student/attempts/${attemptId}`).set(auth(s1)).expect(200);
    const v2 = qView(res.body.data, 1);
    expect(v2.correctAnswer).toEqual({ choices: ['A', 'C'] });
    expect(v2.analysisLatex).toContain('混淆');
  });

  it('#A 主观题/公式填空作答(in_progress 待判)→ 仍不下发正确答案', async () => {
    // q4 solution 拍照、q5 公式填空文本 —— 投递 AI 预批,isCorrect=null 待复核
    const r4 = await request(http).put(`/api/v1/student/attempts/${attemptId}/answers/${qid(3)}`)
      .set(auth(s1)).send({ response: { photoOssKey: 'answers/c1/s1-q4.jpg' } }).expect(200);
    expect(r4.body.data.judged).toBe(false);
    const r5 = await request(http).put(`/api/v1/student/attempts/${attemptId}/answers/${qid(4)}`)
      .set(auth(s1)).send({ response: { texts: ['\\frac{1}{2}'] } }).expect(200);
    expect(r5.body.data.judged).toBe(false);

    const res = await request(http).get(`/api/v1/student/attempts/${attemptId}`).set(auth(s1)).expect(200);
    const at: AttemptDto = res.body.data;
    expect(qView(at, 3).correctAnswer).toBeNull(); // solution 未判 → 不下发
    expect(qView(at, 4).correctAnswer).toBeNull(); // 公式填空未判 → 不下发

    const row4 = await raw.answer.findFirstOrThrow({ where: { attemptId: BigInt(attemptId), questionId: fx.questionIds[3] } });
    const row5 = await raw.answer.findFirstOrThrow({ where: { attemptId: BigInt(attemptId), questionId: fx.questionIds[4] } });
    q4AnswerId = Number(row4.id);
    q5AnswerId = Number(row5.id);
  });

  it('#A 交卷后:全部题面 correctAnswer + analysis 下发(含未作答的 q3)', async () => {
    await request(http).post(`/api/v1/student/attempts/${attemptId}/submit`).set(auth(s1)).expect(200);
    const res = await request(http).get(`/api/v1/student/attempts/${attemptId}`).set(auth(s1)).expect(200);
    const at: AttemptDto = res.body.data;
    expect(at.status).toBe('submitted');
    at.questions.forEach((q) => {
      expect(q.correctAnswer).not.toBeNull();
      expect(q.analysisLatex).not.toBeNull();
    });
    // 未作答的 q3(简单填空)交卷后也下发
    expect(qView(at, 2).correctAnswer).toEqual({ texts: ['y=2x+1'] });
    // solution 下发参考答案
    expect(qView(at, 3).correctAnswer).toEqual({ referenceLatex: '$y=2x+3$' });
  });

  it('#A 跨租户 / 他人 attempt → 404(宪法 §7)', async () => {
    await request(http).get(`/api/v1/student/attempts/${attemptId}`).set(auth(studentB)).expect(404);
    await request(http).get(`/api/v1/student/attempts/${attemptId}`).set(auth(s2)).expect(404);
  });

  // ================= #B 批改名单 =================

  it('#B 等待 AI 预批落库(q4 + q5 各写 grading_records)', async () => {
    await waitFor(
      () => raw.gradingRecord.findFirst({ where: { answerId: BigInt(q4AnswerId), aiScore: { not: null } } }),
      'q4 预批',
    );
    await waitFor(
      () => raw.gradingRecord.findFirst({ where: { answerId: BigInt(q5AnswerId), aiScore: { not: null } } }),
      'q5 预批',
    );
  });

  it('#B 批改名单:列出 2 道待复核题(solution + 公式填空),pendingCount 与 /grading/pending 对齐', async () => {
    const res = await request(http).get(`/api/v1/grading/assignments/${fx.assignmentId}/answers`).set(auth(teacher)).expect(200);
    const list: GradingAnswerBriefDto[] = res.body.data;
    expect(list).toHaveLength(2);
    list.forEach((b) => exactKeys(b, BRIEF_KEYS));
    // 仅含走复核管线的题(q4 seq=4 solution、q5 seq=5 公式填空)
    expect(list.map((b) => b.seq).sort()).toEqual([4, 5]);
    list.forEach((b) => {
      expect(b.studentId).toBe(Number(fx.s1Id));
      expect(b.status).toBe('pending');
      expect(b.aiScore).not.toBeNull(); // AI 预批已落库
      expect(b.finalScore).toBeNull();
    });

    const pend = await request(http).get('/api/v1/grading/pending').set(auth(teacher)).expect(200);
    const group = (pend.body.data as any[]).find((g) => g.assignmentId === fx.assignmentId)!;
    expect(group.pendingCount).toBe(list.filter((b) => b.status === 'pending').length); // 对齐
    expect(group.pendingCount).toBe(2);
  });

  it('#B review 一题(q4)→ 该项 status 变 graded;?status 过滤正确', async () => {
    await request(http).put(`/api/v1/grading/answers/${q4AnswerId}/review`).set(auth(teacher))
      .send({ finalScore: 8, comment: '前两步正确。' }).expect(200);

    const all = await request(http).get(`/api/v1/grading/assignments/${fx.assignmentId}/answers`).set(auth(teacher)).expect(200);
    const list: GradingAnswerBriefDto[] = all.body.data;
    const q4item = list.find((b) => b.answerId === q4AnswerId)!;
    expect(q4item.status).toBe('graded');
    expect(q4item.finalScore).toBe(8);
    const q5item = list.find((b) => b.answerId === q5AnswerId)!;
    expect(q5item.status).toBe('pending');

    const pendingOnly = await request(http).get(`/api/v1/grading/assignments/${fx.assignmentId}/answers?status=pending`).set(auth(teacher)).expect(200);
    expect((pendingOnly.body.data as GradingAnswerBriefDto[]).map((b) => b.answerId)).toEqual([q5AnswerId]);
    const gradedOnly = await request(http).get(`/api/v1/grading/assignments/${fx.assignmentId}/answers?status=graded`).set(auth(teacher)).expect(200);
    expect((gradedOnly.body.data as GradingAnswerBriefDto[]).map((b) => b.answerId)).toEqual([q4AnswerId]);
  });

  it('#B [teacher] 门禁:学生访问 → 403;跨租户作业 → 404', async () => {
    await request(http).get(`/api/v1/grading/assignments/${fx.assignmentId}/answers`).set(auth(s1)).expect(403);
    await request(http).get(`/api/v1/grading/assignments/${fx.assignmentId}/answers`).set(auth(teacherB)).expect(404);
  });
});
