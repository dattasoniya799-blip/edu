/**
 * FIXC-comment · [2026-07-05 批准·契约] 学生 attempt 视图 answers[].teacherComment 验收:
 *  #1 教师 review 写 comment 但未 finalize:学生 GET attempt 详情不下发 teacherComment(随解析同门禁)
 *  #2 finalize 后:解答题 answers[] 项携带 teacherComment=教师点评原文
 *  #3 无点评的题(客观题 / review 未填 comment):graded 后也不含 teacherComment 字段
 * 夹具:139594 号段自建自清(test/fixtures/fixc-comment.fixtures.ts);seed 数据只读。
 */
import { INestApplication } from '@nestjs/common';
import request from 'supertest';

import type { AnswerDto, AttemptDto } from '@qiming/contracts';
import { FIXC_PASSWORD, FixcFixture, createFixcOrg, dropFixcOrg } from './fixtures/fixc-comment.fixtures';
import { createApp, loginStudentById, raw } from './fixtures/setup';

const COMMENT = '配方步骤正确,但结论处不等式方向写反了;复习「完全平方非负」的推导。';

describe('FIXC-comment · answers[].teacherComment 下发口径', () => {
  let app: INestApplication;
  let http: any;
  let fx: FixcFixture;
  let teacher: string;
  let s1: string;
  let s2: string;

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  beforeAll(async () => {
    app = await createApp();
    http = app.getHttpServer();
    fx = await createFixcOrg();
    const res = await request(http)
      .post('/api/v1/auth/login')
      .send({ phone: fx.teacherPhone, password: FIXC_PASSWORD })
      .expect(200);
    teacher = res.body.data.accessToken as string;
    s1 = await loginStudentById(http, fx.s1Id);
    s2 = await loginStudentById(http, fx.s2Id);
  });

  afterAll(async () => {
    await app.close();
    await dropFixcOrg(fx.orgId);
    await raw.$disconnect();
  });

  /** 学生作答主观卷(单选对 + 解答题文本)并交卷,返回 attemptId */
  const answerAndSubmit = async (token: string): Promise<number> => {
    const a = await request(http)
      .post('/api/v1/student/attempts')
      .set(auth(token))
      .send({ assignmentId: fx.subAssignmentId })
      .expect(200);
    const attemptId = a.body.data.id as number;
    await request(http)
      .put(`/api/v1/student/attempts/${attemptId}/answers/${Number(fx.qAId)}`)
      .set(auth(token))
      .send({ response: { choice: 'A' } })
      .expect(200);
    await request(http)
      .put(`/api/v1/student/attempts/${attemptId}/answers/${Number(fx.qSolId)}`)
      .set(auth(token))
      .send({ response: { text: '由 (a-b)^2>=0 展开即证。' } })
      .expect(200);
    await request(http).post(`/api/v1/student/attempts/${attemptId}/submit`).set(auth(token)).expect(200);
    return attemptId;
  };

  const getAttempt = async (token: string, attemptId: number): Promise<AttemptDto> => {
    const res = await request(http).get(`/api/v1/student/attempts/${attemptId}`).set(auth(token)).expect(200);
    return res.body.data as AttemptDto;
  };
  const answerOf = (at: AttemptDto, qid: bigint): AnswerDto =>
    at.answers.find((x) => x.questionId === Number(qid))!;

  it('#1/#2 review 写 comment → finalize 前不下发;finalize 后学生可见 teacherComment', async () => {
    const attemptId = await answerAndSubmit(s1);

    // 教师复核解答题:5 分 + 点评(此时尚未 finalize,attempt 仍 submitted)
    const solAnswer = await raw.answer.findFirstOrThrow({
      where: { attemptId: BigInt(attemptId), questionId: fx.qSolId },
    });
    await request(http)
      .put(`/api/v1/grading/answers/${Number(solAnswer.id)}/review`)
      .set(auth(teacher))
      .send({ finalScore: 5, comment: COMMENT })
      .expect(200);

    // finalize 前:comment 已入 grading 表,但学生视图不下发(任何一题都不含 teacherComment)
    const before = await getAttempt(s1, attemptId);
    expect(before.status).toBe('submitted');
    for (const ans of before.answers) expect(ans).not.toHaveProperty('teacherComment');

    // finalize 出分 → graded,解答题下发 teacherComment 原文;客观题(无点评)不含字段
    await request(http)
      .post(`/api/v1/grading/assignments/${fx.subAssignmentId}/finalize`)
      .set(auth(teacher))
      .expect(200);
    const after = await getAttempt(s1, attemptId);
    expect(after.status).toBe('graded');
    expect(answerOf(after, fx.qSolId).teacherComment).toBe(COMMENT);
    expect(answerOf(after, fx.qAId)).not.toHaveProperty('teacherComment');
  });

  it('#3 review 未填 comment:finalize(graded)后也不下发 teacherComment 字段', async () => {
    const attemptId = await answerAndSubmit(s2);
    const solAnswer = await raw.answer.findFirstOrThrow({
      where: { attemptId: BigInt(attemptId), questionId: fx.qSolId },
    });
    // 复核只给分不写点评(s1 的作答已复核过,finalize 只差 s2 这份)
    await request(http)
      .put(`/api/v1/grading/answers/${Number(solAnswer.id)}/review`)
      .set(auth(teacher))
      .send({ finalScore: 8 })
      .expect(200);
    await request(http)
      .post(`/api/v1/grading/assignments/${fx.subAssignmentId}/finalize`)
      .set(auth(teacher))
      .expect(200);

    const at = await getAttempt(s2, attemptId);
    expect(at.status).toBe('graded');
    for (const ans of at.answers) expect(ans).not.toHaveProperty('teacherComment');
  });
});
