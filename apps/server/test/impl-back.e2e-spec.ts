/**
 * IMPL-back 验收(三项)：
 * 1. 题目插图 anchor(方案A)：各位置挂图 → 读取无损;非法 target / option ref 不存在 → 400。
 * 2. 填空混合判分:①简单填空即时判(回归 + 归一化)②公式填空交卷后 isCorrect=null + 进 pending
 *    + 预批写 grading_records ③教师 review→finalize→公式填空错入错题本、掌握度更新 ④混合题整题走复核。
 * 3. 错题本 subject:/student/wrong-book 项含正确 subject。
 */
import { INestApplication } from '@nestjs/common';
import Redis from 'ioredis';
import request from 'supertest';
import type { AttemptDto, GradingItemDto, QuestionDto, WrongBookItemDto } from '@qiming/contracts';
import { IMPL_PASSWORD, ImplFixture, createImplOrg, dropImplOrg } from './fixtures/impl-back.fixtures';
import { createApp, makeTicket, raw } from './fixtures/setup';

const exactKeys = (obj: object, keys: string[]) =>
  expect(Object.keys(obj).sort()).toEqual([...keys].sort());

const WRONG_ITEM_KEYS = ['id', 'questionId', 'type', 'stemLatex', 'analysisLatex', 'wrongCount', 'correctRedoCount', 'errorTags', 'status', 'sourceName', 'createdAt', 'subject'];

async function waitFor<T>(fn: () => Promise<T | null | false | undefined>, label: string, ms = 15000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v as T;
    if (Date.now() - start > ms) throw new Error(`waitFor 超时:${label}`);
    await new Promise((r) => setTimeout(r, 200));
  }
}

describe('IMPL-back · 插图 anchor / 填空混合判分 / 错题本 subject', () => {
  let app: INestApplication;
  let http: any;
  let fx: ImplFixture;
  let teacher: string;
  let s1: string;

  // 跨用例共享
  let attemptId: number;
  let formulaAnswerId: number; // qFormula 作答
  let mixedAnswerId: number; // qMixed 作答

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const qid = (i: number) => Number(fx.questionIds[i]);

  beforeAll(async () => {
    app = await createApp();
    http = app.getHttpServer();
    fx = await createImplOrg();
    const tRes = await request(http).post('/api/v1/auth/login').send({ phone: fx.teacherPhone, password: IMPL_PASSWORD }).expect(200);
    teacher = tRes.body.data.accessToken;
    const ticket = await makeTicket(fx.orgId, fx.s1Id);
    const sRes = await request(http)
      .post('/api/v1/auth/student/qr-exchange')
      .send({ token: ticket, deviceFingerprint: 'impl-fp-1', deviceName: 'IMPL 测试平板' })
      .expect(200);
    s1 = sRes.body.data.accessToken;
  });

  afterAll(async () => {
    await app.close(); // 先停 BullMQ worker
    await dropImplOrg(fx.orgId);
    const redis = new Redis(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379');
    const prefix = process.env.BULLMQ_PREFIX ?? 'a5';
    const keys = [
      ...(await redis.keys(`${prefix}:pre_grading:*`)),
      ...(await redis.keys(`${prefix}:mastery:*`)),
    ];
    if (keys.length) await redis.del(...keys);
    await redis.quit();
    await raw.$disconnect();
  });

  // ==================== 任务 1:题目插图 anchor ====================

  /** 单选题 + rubric:可同时挂 stem/option/analysis/reference/rubric 五处插图 */
  const figureQuestion = (figures: unknown[]) => ({
    type: 'single', stage: '初中', subject: '数学',
    stemLatex: 'IMPL-Fig 已知 $y=2x+1$,判断(  )',
    figures,
    options: [
      { label: 'A', contentLatex: '$A$' },
      { label: 'B', contentLatex: '$B$', isCorrect: true },
      { label: 'C', contentLatex: '$C$' },
      { label: 'D', contentLatex: '$D$' },
    ],
    answer: { choice: 'B' },
    rubric: [{ step: 1, desc: '识别斜率', score: 5 }],
    analysisLatex: '斜率为 2。',
    difficulty: 2,
    tagNodeIds: [Number(fx.node1Id)],
  });

  const FIVE_FIGURES = [
    { ossKey: 'question_figure/impl/stem.png', position: 1, anchor: { target: 'stem' } },
    { ossKey: 'question_figure/impl/opt.png', position: 2, anchor: { target: 'option', ref: 'B' } },
    { ossKey: 'question_figure/impl/ana.png', position: 3, anchor: { target: 'analysis' } },
    { ossKey: 'question_figure/impl/ref.png', position: 4, anchor: { target: 'reference' } },
    { ossKey: 'question_figure/impl/rub.png', position: 5, anchor: { target: 'rubric', ref: '1' } },
  ];

  it('anchor:各位置各挂一张图 → 录入并读取逐字段无损(验收项)', async () => {
    const created = await request(http).post('/api/v1/questions').set(auth(teacher)).send(figureQuestion(FIVE_FIGURES)).expect(200);
    const id = (created.body.data as QuestionDto).id;
    const read = await request(http).get(`/api/v1/questions/${id}`).set(auth(teacher)).expect(200);
    const q: QuestionDto = read.body.data;
    expect(q.figures).toEqual(FIVE_FIGURES); // anchor.target / ref 原样无损
  });

  it('anchor:缺省(无 anchor)向后兼容 → 存读无损(视为题干)', async () => {
    const plain = [{ ossKey: 'question_figure/impl/plain.png', position: 1 }];
    const created = await request(http).post('/api/v1/questions').set(auth(teacher)).send(figureQuestion(plain)).expect(200);
    const read = await request(http).get(`/api/v1/questions/${(created.body.data as QuestionDto).id}`).set(auth(teacher)).expect(200);
    expect((read.body.data as QuestionDto).figures).toEqual(plain);
  });

  it('anchor:非法 target → 400', async () => {
    await request(http).post('/api/v1/questions').set(auth(teacher))
      .send(figureQuestion([{ ossKey: 'x.png', position: 1, anchor: { target: 'footer' } }]))
      .expect(400);
  });

  it('anchor:target=option 但 ref 不匹配任何选项 label → 400', async () => {
    await request(http).post('/api/v1/questions').set(auth(teacher))
      .send(figureQuestion([{ ossKey: 'x.png', position: 1, anchor: { target: 'option', ref: 'Z' } }]))
      .expect(400);
  });

  it('anchor:target=rubric 但 ref 不匹配任何 rubric step → 400', async () => {
    await request(http).post('/api/v1/questions').set(auth(teacher))
      .send(figureQuestion([{ ossKey: 'x.png', position: 1, anchor: { target: 'rubric', ref: '99' } }]))
      .expect(400);
  });

  // ==================== 任务 2:填空混合判分 ====================

  it('① 简单填空即时判分 + 归一化(回归):全角输入去空格转半角后判对', async () => {
    const start = await request(http).post('/api/v1/student/attempts').set(auth(s1)).send({ assignmentId: fx.assignmentId }).expect(200);
    attemptId = (start.body.data as AttemptDto).id;

    // qNum 参考答案 '12';学生输入全角 '１２'(含空格)→ 归一化后判对、即时下发
    const res = await request(http)
      .put(`/api/v1/student/attempts/${attemptId}/answers/${qid(0)}`)
      .set(auth(s1)).send({ response: { texts: ['  １２ '] } }).expect(200);
    expect(res.body.data).toEqual({ judged: true, isCorrect: true, correctAnswer: null, analysisLatex: null });
  });

  it('② 公式填空 / 混合题提交 → judged=false、isCorrect=null(不即时判分)', async () => {
    // qFormula:参考答案含 \frac → 公式填空
    const r2 = await request(http)
      .put(`/api/v1/student/attempts/${attemptId}/answers/${qid(1)}`)
      .set(auth(s1)).send({ response: { texts: ['\\frac{1}{3}'] } }).expect(200); // 故意写错
    expect(r2.body.data).toEqual({ judged: false, isCorrect: null, correctAnswer: null, analysisLatex: null });

    // qMixed:一空数字一空 \sqrt → 整题走复核
    const r3 = await request(http)
      .put(`/api/v1/student/attempts/${attemptId}/answers/${qid(2)}`)
      .set(auth(s1)).send({ response: { texts: ['2', '\\sqrt{2}'] } }).expect(200);
    expect(r3.body.data).toEqual({ judged: false, isCorrect: null, correctAnswer: null, analysisLatex: null });

    formulaAnswerId = Number((await raw.answer.findFirstOrThrow({ where: { attemptId: BigInt(attemptId), questionId: fx.questionIds[1] } })).id);
    mixedAnswerId = Number((await raw.answer.findFirstOrThrow({ where: { attemptId: BigInt(attemptId), questionId: fx.questionIds[2] } })).id);
  });

  it('② 交卷:objectiveScore 仅含简单填空(=5),公式/混合不计入即时分', async () => {
    const res = await request(http).post(`/api/v1/student/attempts/${attemptId}/submit`).set(auth(s1)).expect(200);
    const at: AttemptDto = res.body.data;
    expect(at.status).toBe('submitted'); // 含公式填空 → 不自动出分
    expect(at.objectiveScore).toBe(5); // 仅 qNum
    expect(at.score).toBeNull();
    expect(at.answers.find((a) => a.questionId === qid(1))!.isCorrect).toBeNull();
    expect(at.answers.find((a) => a.questionId === qid(2))!.isCorrect).toBeNull();
  });

  it('② 预批:BullMQ 真实执行,公式/混合填空各写 grading_records', async () => {
    for (const aid of [formulaAnswerId, mixedAnswerId]) {
      const rec = await waitFor(
        () => raw.gradingRecord.findFirst({ where: { answerId: BigInt(aid), aiScore: { not: null } } }),
        `pre_grading 完成 answer=${aid}`,
      );
      // 填空题无 rubric → stub 返回 aiScore=0、steps=[]、errorTags=[](管线打通,分由教师复核给)
      expect(Number(rec.aiScore)).toBe(0);
      expect(rec.aiSteps).toEqual([]);
      expect(rec.aiErrorTags).toEqual([]);
    }
  });

  it('④ 混合题(一空数字一空公式)整题走复核:isCorrect=null 且已进预批', async () => {
    const ans = await raw.answer.findFirstOrThrow({ where: { id: BigInt(mixedAnswerId) } });
    expect(ans.isCorrect).toBeNull();
    expect(ans.response).toEqual({ texts: ['2', '\\sqrt{2}'] });
    const rec = await raw.gradingRecord.findFirst({ where: { answerId: BigInt(mixedAnswerId) } });
    expect(rec).not.toBeNull();
  });

  it('② 公式填空进入 /grading/pending(按作业聚合,pendingCount=2)', async () => {
    const res = await request(http).get('/api/v1/grading/pending').set(auth(teacher)).expect(200);
    const group = (res.body.data as any[]).find((g) => g.assignmentId === fx.assignmentId)!;
    expect(group).toBeDefined();
    expect(group.pendingCount).toBe(2); // qFormula + qMixed
  });

  it('③ finalize 在公式填空未复核前被拒 → 4501 + pendingAnswerIds', async () => {
    const res = await request(http).post(`/api/v1/grading/assignments/${fx.assignmentId}/finalize`).set(auth(teacher)).expect(409);
    expect(res.body.code).toBe(4501);
    expect(res.body.detail.pendingAnswerIds).toEqual(expect.arrayContaining([formulaAnswerId, mixedAnswerId]));
  });

  it('③ /grading/answers/:id:公式填空原稿(各空拼接到 textResponse)', async () => {
    const res = await request(http).get(`/api/v1/grading/answers/${formulaAnswerId}`).set(auth(teacher)).expect(200);
    const item: GradingItemDto = res.body.data;
    expect(item.questionId).toBe(qid(1));
    expect(item.textResponse).toBe('\\frac{1}{3}'); // 学生作答
    expect(item.photoUrl).toBeNull();
    expect(item.finalScore).toBeNull();
  });

  it('③ 教师 review → finalize:公式填空按 final_score 判对错并出分', async () => {
    // qFormula 判 0 分(错);qMixed 判满分 5(对)
    await request(http).put(`/api/v1/grading/answers/${formulaAnswerId}/review`).set(auth(teacher)).send({ finalScore: 0, comment: '约分错误' }).expect(200);
    await request(http).put(`/api/v1/grading/answers/${mixedAnswerId}/review`).set(auth(teacher)).send({ finalScore: 5 }).expect(200);
    await request(http).post(`/api/v1/grading/assignments/${fx.assignmentId}/finalize`).set(auth(teacher)).expect(200);

    const res = await request(http).get(`/api/v1/student/attempts/${attemptId}`).set(auth(s1)).expect(200);
    const at: AttemptDto = res.body.data;
    expect(at.status).toBe('graded');
    expect(at.objectiveScore).toBe(5);
    expect(at.subjectiveScore).toBe(5); // 0(qFormula)+5(qMixed)
    expect(at.score).toBe(10);
    expect(at.answers.find((a) => a.questionId === qid(1))!.score).toBe(0);
    expect(at.answers.find((a) => a.questionId === qid(2))!.score).toBe(5);
  });

  it('③ + 任务3:错题本入账(公式填空错)且 subject 正确', async () => {
    const res = await request(http).get('/api/v1/student/wrong-book').set(auth(s1)).expect(200);
    const items: WrongBookItemDto[] = res.body.data.items;
    items.forEach((it) => exactKeys(it, WRONG_ITEM_KEYS));
    // 仅 qFormula(0<5,错)入账;qMixed 拿满分不入账
    const formula = items.find((it) => it.questionId === qid(1));
    expect(formula).toBeDefined();
    expect(formula!.subject).toBe('数学'); // 源自题目 subject
    expect(formula!.status).toBe('open');
    expect(items.some((it) => it.questionId === qid(2))).toBe(false);
  });

  it('③ 掌握度:公式填空按 final_score 纳入样本(N1 = 2/3 = 67)', async () => {
    const snap = await waitFor(
      async () => {
        const row = await raw.masterySnapshot.findFirst({ where: { studentId: fx.s1Id, nodeId: fx.node1Id } });
        return row && row.sampleCount === 3 ? row : null;
      },
      'mastery 重算完成',
    );
    // qNum 对 + qMixed 对 + qFormula 错 = 2/3 → round(66.7)=67
    expect(snap.sampleCount).toBe(3);
    expect(snap.mastery).toBe(67);
  });
});
