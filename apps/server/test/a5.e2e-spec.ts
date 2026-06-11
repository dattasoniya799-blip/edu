/**
 * 验收覆盖(任务卡 A5 · 作答/自动批改/复核/错题/掌握度,完整剧本):
 * 学生开始(幂等/断点续答)→ 逐题(single/multi/blank 即时判分,blank 归一化;
 * solution 存 photoOssKey 并投递 BullMQ pre_grading)→ 交卷汇总客观分 →
 * AI stub 预批(BullMQ 真实执行,等待队列完成)→ 教师复核(pending/详情/review/adopt-ai)
 * → finalize 出分 → 错题入账 → 重做对 2 次 cleared → 掌握度数值 = 测试内独立重算的手算值。
 * 订正(redo)成绩不改变原 attempt 分数;跨租户 404(宪法 §7)与角色门禁全覆盖。
 */
import { INestApplication } from '@nestjs/common';
import Redis from 'ioredis';
import request from 'supertest';
import type { AssignmentDto, AttemptDto, GradingItemDto, WrongBookItemDto } from '@qiming/contracts';
import { A5_PASSWORD, A5_RUBRIC, A5Fixture, createA5Org, dropA5Org } from './fixtures/a5.fixtures';
import { createApp, makeTicket, raw } from './fixtures/setup';

const exactKeys = (obj: object, keys: string[]) =>
  expect(Object.keys(obj).sort()).toEqual([...keys].sort());

const ATTEMPT_KEYS = ['id', 'assignmentId', 'status', 'attemptNo', 'startedAt', 'submittedAt', 'score', 'objectiveScore', 'subjectiveScore', 'answers'];
const ANSWER_KEYS = ['questionId', 'response', 'isCorrect', 'score', 'flagged'];
const SUBMIT_RESULT_KEYS = ['judged', 'isCorrect', 'correctAnswer', 'analysisLatex'];
const PENDING_KEYS = ['assignmentId', 'paperName', 'pendingCount', 'aiAvgScore'];
const GRADING_ITEM_KEYS = ['answerId', 'studentId', 'studentName', 'questionId', 'stemLatex', 'rubric', 'photoUrl', 'textResponse', 'aiScore', 'aiSteps', 'aiErrorTags', 'finalScore', 'comment'];
const WRONG_ITEM_KEYS = ['id', 'questionId', 'type', 'stemLatex', 'analysisLatex', 'wrongCount', 'correctRedoCount', 'errorTags', 'status', 'sourceName', 'createdAt'];
const ASSIGNMENT_KEYS = ['id', 'paperId', 'paperName', 'lessonId', 'kind', 'target', 'publishAt', 'dueAt', 'scoreCounted', 'questionCount', 'totalScore'];

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

/**
 * 掌握度独立手算(与实现无共享代码,按任务卡规则直接对账):
 * 学生已完成 attempt(submitted/graded)中 is_correct 非空的作答(=客观题,含 redo)
 * × question_tags → mastery = round(100*正确/样本),sampleCount = 样本数
 */
async function computeExpectedMastery(studentId: bigint): Promise<Map<string, { mastery: number; sampleCount: number }>> {
  const answers = await raw.answer.findMany({
    where: { isCorrect: { not: null }, attempt: { studentId, status: { in: ['submitted', 'graded'] } } },
    select: { questionId: true, isCorrect: true },
  });
  const tags = await raw.questionTag.findMany({
    where: { questionId: { in: [...new Set(answers.map((a) => a.questionId))] } },
    select: { questionId: true, nodeId: true },
  });
  const expected = new Map<string, { correct: number; total: number }>();
  for (const a of answers) {
    for (const t of tags.filter((x) => x.questionId === a.questionId)) {
      const k = String(t.nodeId);
      const cur = expected.get(k) ?? { correct: 0, total: 0 };
      cur.total += 1;
      if (a.isCorrect) cur.correct += 1;
      expected.set(k, cur);
    }
  }
  return new Map(
    [...expected.entries()].map(([k, v]) => [
      k,
      { mastery: Math.round((100 * v.correct) / v.total), sampleCount: v.total },
    ]),
  );
}

/** 断言 mastery_snapshots 与独立手算逐节点一致 */
async function expectMasteryMatches(studentId: bigint) {
  const expected = await computeExpectedMastery(studentId);
  const rows = await raw.masterySnapshot.findMany({ where: { studentId } });
  expect(rows.length).toBe(expected.size);
  for (const r of rows) {
    const e = expected.get(String(r.nodeId))!;
    expect(e).toBeDefined();
    expect({ mastery: r.mastery, sampleCount: r.sampleCount }).toEqual(e);
  }
}

describe('作答/自动批改/复核/错题/掌握度(A5)', () => {
  let app: INestApplication;
  let http: any;
  let fx: A5Fixture;
  let teacher: string;
  let s1: string;
  let s2: string;
  let s3: string;
  let teacherB: string;
  let studentB: string;

  // 跨用例共享(按 it 顺序产生)
  let attemptId: number; // s1 的主作答
  let q4AnswerId: number; // s1 主观题作答
  let wrongQ2EntryId: number;
  let wrongQ4EntryId: number;
  let redoAssignment: AssignmentDto;

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const login = async (phone: string, password: string) => {
    const res = await request(http).post('/api/v1/auth/login').send({ phone, password }).expect(200);
    return res.body.data.accessToken as string;
  };
  const studentLogin = async (orgId: bigint, sid: bigint, fp: string) => {
    const ticket = await makeTicket(orgId, sid);
    const res = await request(http)
      .post('/api/v1/auth/student/qr-exchange')
      .send({ token: ticket, deviceFingerprint: fp, deviceName: 'A5 测试平板' })
      .expect(200);
    return res.body.data.accessToken as string;
  };
  const qid = (i: number) => Number(fx.questionIds[i]);

  beforeAll(async () => {
    app = await createApp();
    http = app.getHttpServer();
    fx = await createA5Org();
    teacher = await login(fx.teacherPhone, A5_PASSWORD);
    teacherB = await login(fx.teacherBPhone, A5_PASSWORD);
    s1 = await studentLogin(fx.orgId, fx.s1Id, 'a5-fp-1');
    s2 = await studentLogin(fx.orgId, fx.s2Id, 'a5-fp-2');
    s3 = await studentLogin(fx.orgId, fx.s3Id, 'a5-fp-3');
    studentB = await studentLogin(fx.orgBId, fx.studentBId, 'a5-fp-b');
  });

  afterAll(async () => {
    await app.close(); // 先停 BullMQ worker,再清数据
    await dropA5Org(fx.orgId, fx.orgBId);
    // 清理本任务的 Redis 队列键(a5: 前缀纪律;BullMQ prefix=a5)
    const redis = new Redis(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379');
    const keys = [
      ...(await redis.keys('a5:pre_grading:*')),
      ...(await redis.keys('a5:mastery:*')),
    ];
    if (keys.length) await redis.del(...keys);
    await redis.quit();
    await raw.$disconnect();
  });

  // ================= 作答 =================

  it('GET /student/assignments:目标学生可见(pending),未选课学生不可见(A4 口径复用)', async () => {
    const res = await request(http).get('/api/v1/student/assignments').set(auth(s1)).expect(200);
    const mine: AssignmentDto[] = res.body.data;
    const a = mine.find((x) => x.id === fx.assignmentId)!;
    expect(a).toBeDefined();
    exactKeys(a, ASSIGNMENT_KEYS);
    expect(a.questionCount).toBe(4);
    expect(a.totalScore).toBe(25);

    const res3 = await request(http).get('/api/v1/student/assignments?status=all').set(auth(s3)).expect(200);
    expect((res3.body.data as AssignmentDto[]).some((x) => x.id === fx.assignmentId)).toBe(false);
  });

  it('验收:开始作答幂等 —— 再次 POST 返回同一 in_progress attempt(断点续答)', async () => {
    const r1 = await request(http).post('/api/v1/student/attempts').set(auth(s1))
      .send({ assignmentId: fx.assignmentId }).expect(200);
    const at1: AttemptDto = r1.body.data;
    exactKeys(at1, ATTEMPT_KEYS);
    expect(at1.status).toBe('in_progress');
    expect(at1.attemptNo).toBe(1);
    expect(at1.answers).toHaveLength(4);
    at1.answers.forEach((a) => {
      exactKeys(a, ANSWER_KEYS);
      expect(a.response).toBeNull();
    });

    const r2 = await request(http).post('/api/v1/student/attempts').set(auth(s1))
      .send({ assignmentId: fx.assignmentId }).expect(200);
    expect(r2.body.data.id).toBe(at1.id);
    attemptId = at1.id;
  });

  it('single 答对:即时判分,不下发答案/解析', async () => {
    const res = await request(http)
      .put(`/api/v1/student/attempts/${attemptId}/answers/${qid(0)}`)
      .set(auth(s1)).send({ response: { choice: 'B' }, timeSpentSec: 45 }).expect(200);
    exactKeys(res.body.data, SUBMIT_RESULT_KEYS);
    expect(res.body.data).toEqual({ judged: true, isCorrect: true, correctAnswer: null, analysisLatex: null });
  });

  it('multi 答错:isCorrect=false,下发 correctAnswer 与解析', async () => {
    const res = await request(http)
      .put(`/api/v1/student/attempts/${attemptId}/answers/${qid(1)}`)
      .set(auth(s1)).send({ response: { choices: ['A', 'B'] }, timeSpentSec: 80 }).expect(200);
    expect(res.body.data.judged).toBe(true);
    expect(res.body.data.isCorrect).toBe(false);
    expect(res.body.data.correctAnswer).toBe('A,C');
    expect(res.body.data.analysisLatex).toContain('混淆');
  });

  it('验收:blank 归一化 —— 全角字符 + 空格,去空格全角转半角后判对', async () => {
    // 'y=2x+1' 的全角写法 + 空格
    const fullWidth = 'y = 2x + 1';
    const res = await request(http)
      .put(`/api/v1/student/attempts/${attemptId}/answers/${qid(2)}`)
      .set(auth(s1)).send({ response: { texts: [fullWidth] }, timeSpentSec: 60 }).expect(200);
    expect(res.body.data.isCorrect).toBe(true);
  });

  it('验收:solution 存 photoOssKey → judged=false 投递预批;断点快照回读已答 4 题', async () => {
    const res = await request(http)
      .put(`/api/v1/student/attempts/${attemptId}/answers/${qid(3)}`)
      .set(auth(s1)).send({ response: { photoOssKey: 'answers/a5/s1-q4.jpg' }, timeSpentSec: 300, flagged: true })
      .expect(200);
    expect(res.body.data).toEqual({ judged: false, isCorrect: null, correctAnswer: null, analysisLatex: null });

    const snap = await request(http).get(`/api/v1/student/attempts/${attemptId}`).set(auth(s1)).expect(200);
    const at: AttemptDto = snap.body.data;
    expect(at.answers.every((a) => a.response != null)).toBe(true);
    const a4 = at.answers.find((a) => a.questionId === qid(3))!;
    expect(a4.response).toEqual({ photoOssKey: 'answers/a5/s1-q4.jpg' });
    expect(a4.isCorrect).toBeNull();
    expect(a4.flagged).toBe(true);

    const row = await raw.answer.findFirstOrThrow({
      where: { attemptId: BigInt(attemptId), questionId: fx.questionIds[3] },
    });
    q4AnswerId = Number(row.id);
  });

  it('交卷:objectiveScore 汇总=10,score 待出分;重复交卷 → 4502', async () => {
    const res = await request(http).post(`/api/v1/student/attempts/${attemptId}/submit`).set(auth(s1)).expect(200);
    const at: AttemptDto = res.body.data;
    expect(at.status).toBe('submitted');
    expect(at.objectiveScore).toBe(10); // q1 对 5 + q2 错 0 + q3 对 5
    expect(at.score).toBeNull();
    expect(at.subjectiveScore).toBeNull();
    expect(at.submittedAt).not.toBeNull();

    const again = await request(http).post(`/api/v1/student/attempts/${attemptId}/submit`).set(auth(s1)).expect(409);
    expect(again.body.code).toBe(4502);

    const done = await request(http).get('/api/v1/student/assignments?status=done').set(auth(s1)).expect(200);
    expect((done.body.data as AssignmentDto[]).some((x) => x.id === fx.assignmentId)).toBe(true);
  });

  it('验收:AI stub 预批 —— BullMQ 真实执行,grading_records 写入 aiScore/steps/errorTags', async () => {
    const rec = await waitFor(
      () => raw.gradingRecord.findFirst({ where: { answerId: BigInt(q4AnswerId), aiScore: { not: null } } }),
      'pre_grading 任务完成',
    );
    // stub 规则:拍照(无 OCR 标记)→ 仅 rubric 第 1 步 ok → aiScore = 3
    expect(Number(rec.aiScore)).toBe(A5_RUBRIC[0].score);
    expect(rec.aiSteps).toEqual([
      { step: 1, ok: true },
      { step: 2, ok: false, comment: `未完成:${A5_RUBRIC[1].desc}` },
      { step: 3, ok: false, comment: `未完成:${A5_RUBRIC[2].desc}` },
    ]);
    expect(rec.aiErrorTags).toEqual([A5_RUBRIC[1].desc, A5_RUBRIC[2].desc]);
    expect(rec.finalScore).toBeNull(); // 教师未复核
  });

  it('交卷后继续作答被拒 → 4502', async () => {
    const res = await request(http)
      .put(`/api/v1/student/attempts/${attemptId}/answers/${qid(0)}`)
      .set(auth(s1)).send({ response: { choice: 'A' } }).expect(409);
    expect(res.body.code).toBe(4502);
  });

  // ================= 教师复核 =================

  it('/grading/pending:按作业聚合,pendingCount=1、aiAvgScore=3', async () => {
    const res = await request(http).get('/api/v1/grading/pending').set(auth(teacher)).expect(200);
    const group = (res.body.data as any[]).find((g) => g.assignmentId === fx.assignmentId)!;
    expect(group).toBeDefined();
    exactKeys(group, PENDING_KEYS);
    expect(group.paperName).toBe('A5 · 第1讲课后作业');
    expect(group.pendingCount).toBe(1);
    expect(group.aiAvgScore).toBe(3);
  });

  it('finalize 在复核完成前被拒 → 4501 + pendingAnswerIds', async () => {
    const res = await request(http)
      .post(`/api/v1/grading/assignments/${fx.assignmentId}/finalize`).set(auth(teacher)).expect(409);
    expect(res.body.code).toBe(4501);
    expect(res.body.detail.pendingAnswerIds).toContain(q4AnswerId);
  });

  it('/grading/answers/:id:GradingItem 契约逐字段 + photoUrl 短时效签名', async () => {
    const res = await request(http).get(`/api/v1/grading/answers/${q4AnswerId}`).set(auth(teacher)).expect(200);
    const item: GradingItemDto = res.body.data;
    exactKeys(item, GRADING_ITEM_KEYS);
    expect(item.studentId).toBe(Number(fx.s1Id));
    expect(item.studentName).toBe('A5学生一');
    expect(item.questionId).toBe(qid(3));
    expect(item.rubric).toEqual(A5_RUBRIC);
    expect(item.photoUrl).toContain('answers/a5/s1-q4.jpg');
    expect(item.photoUrl).toMatch(/exp=\d+&sig=[0-9a-f]{32}/);
    expect(item.textResponse).toBeNull();
    expect(item.aiScore).toBe(3);
    expect(item.aiSteps).toHaveLength(3);
    expect(item.finalScore).toBeNull();
  });

  it('review:超满分 → 400;写入 finalScore=8 + 评语', async () => {
    await request(http).put(`/api/v1/grading/answers/${q4AnswerId}/review`).set(auth(teacher))
      .send({ finalScore: 11 }).expect(400);
    await request(http).put(`/api/v1/grading/answers/${q4AnswerId}/review`).set(auth(teacher))
      .send({ finalScore: 8, comment: '前两步正确,还原方向有误。' }).expect(200);
    const detail = await request(http).get(`/api/v1/grading/answers/${q4AnswerId}`).set(auth(teacher)).expect(200);
    expect(detail.body.data.finalScore).toBe(8);
    expect(detail.body.data.comment).toContain('还原方向');
  });

  it('验收:finalize 出分 —— attempt graded,score=10+8,主观题 score 回写', async () => {
    await request(http).post(`/api/v1/grading/assignments/${fx.assignmentId}/finalize`).set(auth(teacher)).expect(200);
    const res = await request(http).get(`/api/v1/student/attempts/${attemptId}`).set(auth(s1)).expect(200);
    const at: AttemptDto = res.body.data;
    expect(at.status).toBe('graded');
    expect(at.objectiveScore).toBe(10);
    expect(at.subjectiveScore).toBe(8);
    expect(at.score).toBe(18);
    expect(at.answers.find((a) => a.questionId === qid(3))!.score).toBe(8);
  });

  it('验收:错题入账 —— q2(客观错)+ q4(主观未满分),q4 错因取 AI 预批', async () => {
    const res = await request(http).get('/api/v1/student/wrong-book').set(auth(s1)).expect(200);
    expect(res.body.data.total).toBe(2);
    const items: WrongBookItemDto[] = res.body.data.items;
    items.forEach((it) => exactKeys(it, WRONG_ITEM_KEYS));

    const eQ2 = items.find((it) => it.questionId === qid(1))!;
    expect(eQ2.type).toBe('multi');
    expect(eQ2.wrongCount).toBe(1);
    expect(eQ2.correctRedoCount).toBe(0);
    expect(eQ2.status).toBe('open');
    expect(eQ2.sourceName).toBe('A5 · 第1讲课后作业');
    wrongQ2EntryId = eQ2.id;

    const eQ4 = items.find((it) => it.questionId === qid(3))!;
    expect(eQ4.status).toBe('open');
    expect(eQ4.errorTags).toEqual([A5_RUBRIC[1].desc, A5_RUBRIC[2].desc]);
    wrongQ4EntryId = eQ4.id;
  });

  it('验收:掌握度 —— mastery 任务完成,数值=独立手算(N1/N2 各 50,样本 2)', async () => {
    await waitFor(async () => {
      const rows = await raw.masterySnapshot.findMany({ where: { studentId: fx.s1Id } });
      return rows.length === 2 && rows.every((r) => r.sampleCount === 2) ? rows : null;
    }, 'mastery 重算完成');
    const n1 = await raw.masterySnapshot.findFirstOrThrow({ where: { studentId: fx.s1Id, nodeId: fx.node1Id } });
    const n2 = await raw.masterySnapshot.findFirstOrThrow({ where: { studentId: fx.s1Id, nodeId: fx.node2Id } });
    // N1:q1 对、q2 错 → 50%;N2:q2 错、q3 对 → 50%(q4 主观题不入样本)
    expect({ mastery: n1.mastery, sampleCount: n1.sampleCount }).toEqual({ mastery: 50, sampleCount: 2 });
    expect({ mastery: n2.mastery, sampleCount: n2.sampleCount }).toEqual({ mastery: 50, sampleCount: 2 });
    await expectMasteryMatches(fx.s1Id);
  });

  // ================= 错题重做闭环 =================

  it('单题重做:生成 wrong_redo assignment(不计分),作对一次 → correct_redo_count=1', async () => {
    const res = await request(http).post(`/api/v1/student/wrong-book/${wrongQ2EntryId}/redo`).set(auth(s1)).expect(200);
    redoAssignment = res.body.data;
    exactKeys(redoAssignment, ASSIGNMENT_KEYS);
    expect(redoAssignment.kind).toBe('wrong_redo');
    expect(redoAssignment.scoreCounted).toBe(false);
    expect(redoAssignment.target).toEqual({ studentIds: [Number(fx.s1Id)] });
    expect(redoAssignment.questionCount).toBe(1);
    expect(redoAssignment.totalScore).toBe(5); // 沿用来源卷面分

    const start = await request(http).post('/api/v1/student/attempts').set(auth(s1))
      .send({ assignmentId: redoAssignment.id }).expect(200);
    const atId = start.body.data.id;
    const judged = await request(http)
      .put(`/api/v1/student/attempts/${atId}/answers/${qid(1)}`)
      .set(auth(s1)).send({ response: { choices: ['C', 'A'] } }).expect(200); // 乱序也判对
    expect(judged.body.data.isCorrect).toBe(true);
    const sub = await request(http).post(`/api/v1/student/attempts/${atId}/submit`).set(auth(s1)).expect(200);
    expect(sub.body.data.status).toBe('graded'); // 无主观题 → 自动出分

    const entry = await raw.wrongBookEntry.findFirstOrThrow({ where: { id: BigInt(wrongQ2EntryId) } });
    expect(entry.correctRedoCount).toBe(1);
    expect(entry.status).toBe('open');
  });

  it('验收:再做对一次 → cleared;订正成绩不改变原 attempt 分数;掌握度含 redo 样本=手算', async () => {
    // 同一 wrong_redo assignment 再来一次(attempt_no=2)
    const start = await request(http).post('/api/v1/student/attempts').set(auth(s1))
      .send({ assignmentId: redoAssignment.id }).expect(200);
    expect(start.body.data.attemptNo).toBe(2);
    const atId = start.body.data.id;
    await request(http).put(`/api/v1/student/attempts/${atId}/answers/${qid(1)}`)
      .set(auth(s1)).send({ response: { choices: ['A', 'C'] } }).expect(200);
    await request(http).post(`/api/v1/student/attempts/${atId}/submit`).set(auth(s1)).expect(200);

    const entry = await raw.wrongBookEntry.findFirstOrThrow({ where: { id: BigInt(wrongQ2EntryId) } });
    expect(entry.correctRedoCount).toBe(2);
    expect(entry.status).toBe('cleared'); // 重做对 2 次 → cleared

    // 订正/重做不改变原 attempt 分数(验收项)
    const orig = await request(http).get(`/api/v1/student/attempts/${attemptId}`).set(auth(s1)).expect(200);
    expect(orig.body.data.score).toBe(18);
    expect(orig.body.data.objectiveScore).toBe(10);

    // 掌握度:redo 样本计入(score_counted=false 不影响)→ N1: 3/4=75,N2: 3/4=75
    await waitFor(async () => {
      const n1 = await raw.masterySnapshot.findFirst({ where: { studentId: fx.s1Id, nodeId: fx.node1Id } });
      return n1?.sampleCount === 4 ? n1 : null;
    }, 'redo 后 mastery 重算');
    const n1 = await raw.masterySnapshot.findFirstOrThrow({ where: { studentId: fx.s1Id, nodeId: fx.node1Id } });
    const n2 = await raw.masterySnapshot.findFirstOrThrow({ where: { studentId: fx.s1Id, nodeId: fx.node2Id } });
    expect({ mastery: n1.mastery, sampleCount: n1.sampleCount }).toEqual({ mastery: 75, sampleCount: 4 });
    expect({ mastery: n2.mastery, sampleCount: n2.sampleCount }).toEqual({ mastery: 75, sampleCount: 4 });
    await expectMasteryMatches(fx.s1Id);
  });

  it('redo-all:仅 q4 仍 open → 生成 1 题重练卷;已 cleared 错题再 redo → 4503', async () => {
    const res = await request(http).post('/api/v1/student/wrong-book/redo-all').set(auth(s1)).expect(200);
    const a: AssignmentDto = res.body.data;
    expect(a.kind).toBe('wrong_redo');
    expect(a.scoreCounted).toBe(false);
    expect(a.questionCount).toBe(1);
    expect(a.totalScore).toBe(10); // q4 来源卷面分

    const denied = await request(http).post(`/api/v1/student/wrong-book/${wrongQ2EntryId}/redo`).set(auth(s1)).expect(409);
    expect(denied.body.code).toBe(4503);

    const filtered = await request(http).get('/api/v1/student/wrong-book?status=open').set(auth(s1)).expect(200);
    expect(filtered.body.data.total).toBe(1);
    expect(filtered.body.data.items[0].id).toBe(wrongQ4EntryId);
  });

  // ================= adopt-ai 路线(s2,文本作答) =================

  it('adopt-ai:s2 文本作答含 √ 标记 → AI 满分,采纳后 finalize;满分不入错题本', async () => {
    const start = await request(http).post('/api/v1/student/attempts').set(auth(s2))
      .send({ assignmentId: fx.assignmentId }).expect(200);
    const atId = start.body.data.id;
    await request(http).put(`/api/v1/student/attempts/${atId}/answers/${qid(3)}`)
      .set(auth(s2)).send({ response: { text: '设 y=kx+b,代入两点 √2;还原平移 √3,得 y=2x+3。' } }).expect(200);
    await request(http).post(`/api/v1/student/attempts/${atId}/submit`).set(auth(s2)).expect(200);

    const ansRow = await raw.answer.findFirstOrThrow({
      where: { attemptId: BigInt(atId), questionId: fx.questionIds[3] },
    });
    const rec = await waitFor(
      () => raw.gradingRecord.findFirst({ where: { answerId: ansRow.id, aiScore: { not: null } } }),
      's2 预批完成',
    );
    expect(Number(rec.aiScore)).toBe(10); // 三步标记齐 → 满分
    expect(rec.aiErrorTags).toEqual([]);

    // 详情:textResponse 回显,photoUrl 为 null
    const detail = await request(http).get(`/api/v1/grading/answers/${Number(ansRow.id)}`).set(auth(teacher)).expect(200);
    expect(detail.body.data.textResponse).toContain('√2');
    expect(detail.body.data.photoUrl).toBeNull();

    await request(http).post(`/api/v1/grading/assignments/${fx.assignmentId}/adopt-ai`).set(auth(teacher)).expect(200);
    await request(http).post(`/api/v1/grading/assignments/${fx.assignmentId}/finalize`).set(auth(teacher)).expect(200);

    const at = await request(http).get(`/api/v1/student/attempts/${atId}`).set(auth(s2)).expect(200);
    expect(at.body.data.status).toBe('graded');
    expect(at.body.data.objectiveScore).toBe(0); // 客观题未作答
    expect(at.body.data.subjectiveScore).toBe(10);
    expect(at.body.data.score).toBe(10);

    // 主观题拿满分 → 不入错题本;且 s2 无客观样本 → 无掌握度快照
    const wb = await request(http).get('/api/v1/student/wrong-book').set(auth(s2)).expect(200);
    expect(wb.body.data.total).toBe(0);
    expect(await raw.masterySnapshot.count({ where: { studentId: fx.s2Id } })).toBe(0);

    // s1 的成绩不受 s2 finalize 影响
    const orig = await request(http).get(`/api/v1/student/attempts/${attemptId}`).set(auth(s1)).expect(200);
    expect(orig.body.data.score).toBe(18);
  });

  // ================= 安全与契约边界 =================

  it('跨租户互查 → 404(宪法 §7)', async () => {
    // 机构B教师查机构A的批改对象
    await request(http).get(`/api/v1/grading/answers/${q4AnswerId}`).set(auth(teacherB)).expect(404);
    await request(http).put(`/api/v1/grading/answers/${q4AnswerId}/review`).set(auth(teacherB))
      .send({ finalScore: 1 }).expect(404);
    await request(http).post(`/api/v1/grading/assignments/${fx.assignmentId}/finalize`).set(auth(teacherB)).expect(404);
    await request(http).post(`/api/v1/grading/assignments/${fx.assignmentId}/adopt-ai`).set(auth(teacherB)).expect(404);
    // 机构B学生查机构A的作答/作业/错题
    await request(http).get(`/api/v1/student/attempts/${attemptId}`).set(auth(studentB)).expect(404);
    await request(http).post('/api/v1/student/attempts').set(auth(studentB))
      .send({ assignmentId: fx.assignmentId }).expect(404);
    await request(http).put(`/api/v1/student/attempts/${attemptId}/answers/${qid(0)}`).set(auth(studentB))
      .send({ response: { choice: 'B' } }).expect(404);
    await request(http).post(`/api/v1/student/wrong-book/${wrongQ4EntryId}/redo`).set(auth(studentB)).expect(404);
    // 同租户他人 attempt 同样不可见(s3 查 s1)
    await request(http).get(`/api/v1/student/attempts/${attemptId}`).set(auth(s3)).expect(404);
  });

  it('角色门禁:学生访问 /grading/* → 403;教师访问学生作答接口 → 403', async () => {
    await request(http).get('/api/v1/grading/pending').set(auth(s1)).expect(403);
    await request(http).post(`/api/v1/grading/assignments/${fx.assignmentId}/finalize`).set(auth(s1)).expect(403);
    await request(http).get('/api/v1/student/assignments').set(auth(teacher)).expect(403);
    await request(http).post('/api/v1/student/attempts').set(auth(teacher))
      .send({ assignmentId: fx.assignmentId }).expect(403);
  });

  it('response 形状与题型不符 → 400;非本卷题目 → 404', async () => {
    // 新开一次 redo-all 的 attempt 用于 400 校验(q4 卷)
    const list = await request(http).get('/api/v1/student/assignments?status=pending').set(auth(s1)).expect(200);
    const redoAll = (list.body.data as AssignmentDto[]).find((x) => x.kind === 'wrong_redo' && x.totalScore === 10)!;
    const start = await request(http).post('/api/v1/student/attempts').set(auth(s1))
      .send({ assignmentId: redoAll.id }).expect(200);
    const atId = start.body.data.id;
    // q4 是 solution:给 choice → 400
    await request(http).put(`/api/v1/student/attempts/${atId}/answers/${qid(3)}`)
      .set(auth(s1)).send({ response: { choice: 'B' } }).expect(400);
    // q1 不在重练卷上 → 404
    await request(http).put(`/api/v1/student/attempts/${atId}/answers/${qid(0)}`)
      .set(auth(s1)).send({ response: { choice: 'B' } }).expect(404);
    // 缺 response → 400(DTO 校验)
    await request(http).put(`/api/v1/student/attempts/${atId}/answers/${qid(3)}`)
      .set(auth(s1)).send({}).expect(400);
  });
});
