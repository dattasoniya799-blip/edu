/**
 * [2026-07-06 批准 契约变更] 学生作业历史 → 直达成绩单:
 * - GET /student/assignments:学生视角每项带 myAttempt(本人最新 attempt)——
 *   已判分 → { attemptId, status:'graded', score };从未作答 → null;
 * - 教师侧 POST /assignments 出参不含 myAttempt(字段缺失,教师视角不下发);
 * - GET /student/courses/:id/lessons:myHomework.attemptId = 本人最新 attempt id(未作答 → null)。
 * 夹具自建自清:手机号 139597 段、studentNo 前缀 HIST-(规避 studentNo 登录串号);seed 只读。
 */
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { AssignmentDto } from '@qiming/contracts';
import { hashPassword } from '../src/auth/password.util';
import { createApp, loginStudentById, raw } from './fixtures/setup';

const TEACHER_PW = 'Hist@Pass123';
const DAY = 86400_000;
const ORG_SETTINGS = {
  ai: { qaGuideOnly: true, preGrading: true },
  studentHours: { start: '00:00', end: '23:59' },
  deviceBinding: true,
};

interface HistFixture {
  orgId: bigint;
  teacherPhone: string;
  s1Id: bigint;
  s2Id: bigint;
  courseId: bigint;
  hwId: bigint;
  paperId: bigint;
  attemptId: bigint;
}

async function createHistOrg(): Promise<HistFixture> {
  const hash = await hashPassword(TEACHER_PW);
  const now = Date.now();
  const org = await raw.org.create({ data: { name: '作业历史契约测试机构', settings: ORG_SETTINGS } });
  const orgId = org.id;
  const teacher = await raw.user.create({ data: { orgId, role: 'teacher', name: 'HIST教师', phone: '13959700002', passwordHash: hash } });
  const s1 = await raw.user.create({ data: { orgId, role: 'student', name: 'HIST学生一', phone: '13959700011', studentNo: 'HIST-S001' } });
  const s2 = await raw.user.create({ data: { orgId, role: 'student', name: 'HIST学生二', phone: '13959700012', studentNo: 'HIST-S002' } });

  const course = await raw.course.create({
    data: { orgId, name: 'HIST · 初二数学', classType: 'group', subject: '数学', stage: '初中', teacherId: teacher.id, totalLessons: 1, status: 'ongoing' },
  });
  await raw.courseStudent.createMany({
    data: [
      { orgId, courseId: course.id, studentId: s1.id, status: 'active' },
      { orgId, courseId: course.id, studentId: s2.id, status: 'active' },
    ],
  });
  const lesson = await raw.lesson.create({
    data: { orgId, courseId: course.id, seq: 1, title: 'HIST 第1讲 · 待定系数法', status: 'finished', scheduledStart: new Date(now - 7 * DAY), scheduledEnd: new Date(now - 7 * DAY + 2 * 3600_000) },
  });

  const q1 = await raw.question.create({ data: { orgId, ownerId: teacher.id, type: 'single', stage: '初中', subject: '数学', stemLatex: 'HIST-Q1', answer: { choice: 'B' }, difficulty: 2, status: 'published' } });
  const q2 = await raw.question.create({ data: { orgId, ownerId: teacher.id, type: 'single', stage: '初中', subject: '数学', stemLatex: 'HIST-Q2', answer: { choice: 'A' }, difficulty: 2, status: 'published' } });
  const paper = await raw.paper.create({ data: { orgId, creatorId: teacher.id, name: 'HIST · 第1讲课后作业', type: 'homework', totalScore: 10, status: 'published' } });
  await raw.paperQuestion.createMany({
    data: [
      { orgId, paperId: paper.id, questionId: q1.id, seq: 1, score: 5 },
      { orgId, paperId: paper.id, questionId: q2.id, seq: 2, score: 5 },
    ],
  });
  const hw = await raw.assignment.create({
    data: { orgId, paperId: paper.id, lessonId: lesson.id, teacherId: teacher.id, kind: 'homework', target: { courseId: Number(course.id) }, publishAt: new Date(now - 6 * DAY), dueAt: new Date(now - 5 * DAY), scoreCounted: true },
  });

  // s1:已判分 attempt(q1 对 5 / q2 错 0 → score=5,wrongCount=1);s2:无 attempt
  const at = await raw.attempt.create({
    data: { orgId, assignmentId: hw.id, studentId: s1.id, attemptNo: 1, status: 'graded', startedAt: new Date(now - 2 * DAY), submittedAt: new Date(now - 2 * DAY + 1800_000), durationSec: 600, score: 5, objectiveScore: 5, subjectiveScore: 0 },
  });
  await raw.answer.createMany({
    data: [
      { orgId, attemptId: at.id, questionId: q1.id, response: { choice: 'B' }, isCorrect: true, score: 5, createdAt: new Date(now - 2 * DAY) },
      { orgId, attemptId: at.id, questionId: q2.id, response: { choice: 'B' }, isCorrect: false, score: 0, createdAt: new Date(now - 2 * DAY) },
    ],
  });

  return { orgId, teacherPhone: teacher.phone!, s1Id: s1.id, s2Id: s2.id, courseId: course.id, hwId: hw.id, paperId: paper.id, attemptId: at.id };
}

async function dropHistOrg(orgId: bigint): Promise<void> {
  await raw.answer.deleteMany({ where: { orgId } });
  await raw.attempt.deleteMany({ where: { orgId } });
  await raw.assignment.deleteMany({ where: { orgId } });
  await raw.paperQuestion.deleteMany({ where: { orgId } });
  await raw.paper.deleteMany({ where: { orgId } });
  await raw.question.deleteMany({ where: { orgId } });
  await raw.lesson.deleteMany({ where: { orgId } });
  await raw.courseStudent.deleteMany({ where: { orgId } });
  await raw.course.deleteMany({ where: { orgId } });
  await raw.device.deleteMany({ where: { orgId } });
  await raw.loginTicket.deleteMany({ where: { orgId } });
  await raw.auditLog.deleteMany({ where: { orgId } });
  await raw.user.deleteMany({ where: { orgId } });
  await raw.org.deleteMany({ where: { id: orgId } });
}

describe('学生作业历史 · myAttempt / 时间线 attemptId([2026-07-06 契约变更])', () => {
  let app: INestApplication;
  let http: unknown;
  let fx: HistFixture;
  let s1: string;
  let s2: string;
  let teacher: string;

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  beforeAll(async () => {
    app = await createApp();
    http = app.getHttpServer();
    fx = await createHistOrg();
    s1 = await loginStudentById(http, fx.s1Id);
    s2 = await loginStudentById(http, fx.s2Id);
    const res = await request(http as never).post('/api/v1/auth/login').send({ phone: fx.teacherPhone, password: TEACHER_PW }).expect(200);
    teacher = res.body.data.accessToken;
  });

  afterAll(async () => {
    await app.close();
    await dropHistOrg(fx.orgId);
    await raw.$disconnect();
  });

  it('学生视角:已判分作业带 myAttempt{attemptId,status:graded,score};未作答学生为 null', async () => {
    const r1 = await request(http as never).get('/api/v1/student/assignments?status=all').set(auth(s1)).expect(200);
    const a1 = (r1.body.data as AssignmentDto[]).find((a) => a.id === Number(fx.hwId))!;
    expect(a1).toBeDefined();
    expect(Object.keys(a1)).toContain('myAttempt');
    expect(a1.myAttempt).toEqual({ attemptId: Number(fx.attemptId), status: 'graded', score: 5 });

    const r2 = await request(http as never).get('/api/v1/student/assignments?status=all').set(auth(s2)).expect(200);
    const a2 = (r2.body.data as AssignmentDto[]).find((a) => a.id === Number(fx.hwId))!;
    expect(a2).toBeDefined();
    expect(a2.myAttempt).toBeNull();
  });

  it('教师视角:POST /assignments 出参不含 myAttempt(字段缺失)', async () => {
    const res = await request(http as never)
      .post('/api/v1/assignments')
      .set(auth(teacher))
      .send({ paperId: Number(fx.paperId), kind: 'consolidation', target: { courseId: Number(fx.courseId) } })
      .expect(200);
    expect(res.body.data).not.toHaveProperty('myAttempt');
    await raw.assignment.deleteMany({ where: { orgId: fx.orgId, id: BigInt(res.body.data.id) } }); // 清理临时作业
  });

  it('时间线:myHomework.attemptId = 本人最新 attempt(s1 有值 / s2 为 null)', async () => {
    const r1 = await request(http as never).get(`/api/v1/student/courses/${fx.courseId}/lessons`).set(auth(s1)).expect(200);
    const l1 = (r1.body.data as { lesson: { seq: number }; myHomework: unknown }[]).find((x) => x.lesson.seq === 1)!;
    expect(l1.myHomework).toEqual({ assignmentId: Number(fx.hwId), attemptId: Number(fx.attemptId), score: 5, wrongCount: 1 });

    const r2 = await request(http as never).get(`/api/v1/student/courses/${fx.courseId}/lessons`).set(auth(s2)).expect(200);
    const l1b = (r2.body.data as { lesson: { seq: number }; myHomework: unknown }[]).find((x) => x.lesson.seq === 1)!;
    expect(l1b.myHomework).toEqual({ assignmentId: Number(fx.hwId), attemptId: null, score: null, wrongCount: 0 });
  });
});
