/**
 * 验收覆盖(补漏任务 FIX1 · 学生端只读 5 端点,openapi 为唯一规格):
 * - GET /student/today:todayLesson(今日 UTC 窗口最早讲次 + canEnterAt=开课前 10min +
 *   未结束 session id)+ tasks(可见作业全集,progress 取最新 attempt)= 夹具手算;
 * - GET /student/courses:仅我 active 选课,聚合口径与 A2/A4 一致(currentLesson/
 *   nextLessonAt/attendanceRate/homeworkRate)= 夹具手算;
 * - GET /student/courses/:id/lessons:seq 升序 + myHomework{assignmentId,score,wrongCount}
 *   (错题口径 = A5:客观 isCorrect=false / 主观已出分未拿满分);未选课(quit/他课)→ 404;
 * - GET /student/report:mastery 全维度(nodeId 升序)+ weekStats 周窗口手算;
 * - GET /student/resources/:id/view:签名 URL(一次性 token,GETDEL,复用 → 403)→
 *   字节回读一致;未被"我的课程"引用 → 404;
 * - seed 对账:四个读端点对 seed 学生用测试内独立重算(raw,无共享代码)逐字段比对;
 * - 跨租户 404 双向 + 学生B 在本端点下看不到机构A 任何数据(宪法 §7);
 * - 角色门禁:teacher/admin → 403,无 token → 401(openapi [student]);
 * - 响应结构与 openapi 逐字段一致(exactKeys)。
 * 夹具:1398 号段自建自清(test/fixtures/fix1.fixtures.ts);seed 数据只读。
 */
import { INestApplication } from '@nestjs/common';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import type Redis from 'ioredis';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import request from 'supertest';

import { REDIS } from '../src/redis/redis.module';

// 在 createApp 之前固定上传根目录到临时目录(同 A3 upload.e2e 模式),避免污染仓库
const UPLOAD_ROOT = mkdtempSync(join(tmpdir(), 'qiming-fix1-view-'));
process.env.UPLOAD_ROOT = UPLOAD_ROOT;

import { FIX1_PASSWORD, Fix1Fixture, createFix1Org, dropFix1Org } from './fixtures/fix1.fixtures';
import { createApp, loginStudentById, raw } from './fixtures/setup';

const exactKeys = (obj: object, keys: string[]) =>
  expect(Object.keys(obj).sort()).toEqual([...keys].sort());

const TODAY_KEYS = ['todayLesson', 'tasks'];
const TODAY_LESSON_KEYS = ['lessonId', 'courseName', 'title', 'startAt', 'endAt', 'canEnterAt', 'sessionId'];
const TASK_KEYS = ['assignmentId', 'kind', 'title', 'questionCount', 'dueAt', 'progress'];
const PROGRESS_KEYS = ['answered', 'total', 'status'];
const COURSE_KEYS = [
  'id', 'name', 'classType', 'subject', 'stage', 'teacherId', 'teacherName', 'totalLessons',
  'currentLesson', 'studentCount', 'status', 'nextLessonAt', 'attendanceRate', 'homeworkRate',
];
const TIMELINE_KEYS = ['lesson', 'sessionId', 'myHomework'];
const LESSON_KEYS = ['id', 'courseId', 'seq', 'title', 'scheduledStart', 'scheduledEnd', 'status', 'prepChecklist', 'openingConfig', 'sessionId'];
const MYHW_KEYS = ['assignmentId', 'score', 'wrongCount'];
const REPORT_KEYS = ['mastery', 'weekStats'];
const WEEK_KEYS = ['answeredCount', 'correctRate', 'studySec', 'wrongOpenCount'];
const MASTERY_ITEM_KEYS = ['nodeId', 'nodeName', 'graphType', 'mastery', 'sampleCount'];
const VIEW_KEYS = ['url', 'expiresAt'];

const DAY = 86400_000;
/** 独立实现的 UTC 日窗口 / 取整(与实现无共享代码,对账用) */
const utcDayStart = (d = new Date()) =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
const daysAgo = (n: number) => new Date(utcDayStart().getTime() - n * DAY);
const round2 = (x: number) => Math.round(x * 100) / 100;

// ================= 测试内独立重算(seed 对账;口径=README FIX1 节)=================

/** /student/courses 独立重算(口径=A2/A4 课程聚合) */
async function expectedCourses(sid: bigint) {
  const enrolls = await raw.courseStudent.findMany({ where: { studentId: sid, status: 'active' } });
  const courses = await raw.course.findMany({
    where: { id: { in: enrolls.map((e) => e.courseId) }, deletedAt: null },
    orderBy: { id: 'asc' },
  });
  const now = new Date();
  const out = [];
  for (const c of courses) {
    const teacher = await raw.user.findUnique({ where: { id: c.teacherId } });
    const studentCount = await raw.courseStudent.count({ where: { courseId: c.id, status: 'active' } });
    const lessons = await raw.lesson.findMany({ where: { courseId: c.id } });
    const upcoming = lessons
      .map((l) => l.scheduledStart)
      .filter((d): d is Date => !!d && d > now)
      .sort((a, b) => a.getTime() - b.getTime());
    const hw = await raw.assignment.findMany({
      where: { kind: 'homework', lessonId: { not: null }, lesson: { courseId: c.id } },
    });
    let homeworkRate: number | null = null;
    if (hw.length && studentCount > 0) {
      const done = await raw.attempt.count({
        where: { assignmentId: { in: hw.map((a) => a.id) }, status: { in: ['submitted', 'graded'] } },
      });
      homeworkRate = round2(done / (hw.length * studentCount));
    }
    const ended = await raw.classSession.findMany({ where: { status: 'ended', lesson: { courseId: c.id } } });
    let attendanceRate: number | null = null;
    if (ended.length && studentCount > 0) {
      const joins = await raw.sessionParticipant.count({
        where: { sessionId: { in: ended.map((s) => s.id) }, joinAt: { not: null } },
      });
      attendanceRate = round2(joins / (ended.length * studentCount));
    }
    out.push({
      id: Number(c.id), name: c.name, classType: c.classType, subject: c.subject, stage: c.stage,
      teacherId: Number(c.teacherId), teacherName: teacher?.name ?? '', totalLessons: c.totalLessons,
      currentLesson: lessons.filter((l) => l.status === 'finished').length, studentCount,
      status: c.status, nextLessonAt: upcoming.length ? upcoming[0].toISOString() : null,
      attendanceRate, homeworkRate,
    });
  }
  return out;
}

/** 作业可见性独立重算(口径=A4 target 解析) */
async function visibleAssignments(orgId: bigint, sid: bigint) {
  const enrolls = await raw.courseStudent.findMany({
    where: { studentId: sid, status: 'active' },
    select: { courseId: true },
  });
  const myCourses = new Set(enrolls.map((e) => Number(e.courseId)));
  const all = await raw.assignment.findMany({
    where: { orgId, publishAt: { lte: new Date() } },
    include: { paper: { select: { name: true, _count: { select: { questions: true } } } } },
    orderBy: { id: 'desc' },
  });
  return all.filter((a) => {
    const t = a.target as { courseId?: number; studentIds?: number[] };
    return t.courseId != null ? myCourses.has(Number(t.courseId)) : (t.studentIds ?? []).includes(Number(sid));
  });
}

/** /student/today 独立重算 */
async function expectedToday(orgId: bigint, sid: bigint) {
  const dayStart = utcDayStart();
  const dayEnd = new Date(dayStart.getTime() + DAY);
  const enrolls = await raw.courseStudent.findMany({
    where: { studentId: sid, status: 'active' },
    select: { courseId: true },
  });
  const todayLessons = await raw.lesson.findMany({
    where: {
      courseId: { in: enrolls.map((e) => e.courseId) },
      scheduledStart: { gte: dayStart, lt: dayEnd },
      scheduledEnd: { not: null },
      course: { deletedAt: null },
    },
    orderBy: { scheduledStart: 'asc' },
    include: { course: { select: { name: true } } },
  });
  // FIX4 · #5:升序后优先"已发布"(status≠draft 或有未结束会话),全草稿则回退最早一条
  const openSession = async (lid: bigint) =>
    raw.classSession.findFirst({
      where: { lessonId: lid, status: { not: 'ended' } },
      orderBy: { id: 'desc' },
    });
  let lesson: (typeof todayLessons)[number] | undefined;
  for (const l of todayLessons) {
    if (l.status !== 'draft' || (await openSession(l.id))) {
      lesson = l;
      break;
    }
  }
  if (!lesson) lesson = todayLessons[0];
  let todayLesson = null;
  if (lesson) {
    const session = await openSession(lesson.id);
    todayLesson = {
      lessonId: Number(lesson.id), courseName: lesson.course.name, title: lesson.title,
      startAt: lesson.scheduledStart!.toISOString(), endAt: lesson.scheduledEnd!.toISOString(),
      canEnterAt: new Date(lesson.scheduledStart!.getTime() - 600_000).toISOString(),
      sessionId: session ? Number(session.id) : null,
    };
  }
  const visible = await visibleAssignments(orgId, sid);
  const tasks = [];
  for (const a of visible) {
    const at = await raw.attempt.findFirst({
      where: { assignmentId: a.id, studentId: sid },
      orderBy: { attemptNo: 'desc' },
      include: { _count: { select: { answers: true } } },
    });
    tasks.push({
      assignmentId: Number(a.id), kind: a.kind, title: a.paper.name,
      questionCount: a.paper._count.questions,
      dueAt: a.dueAt ? a.dueAt.toISOString() : null,
      progress: at
        ? { answered: at._count.answers, total: a.paper._count.questions, status: at.status }
        : { answered: 0, total: a.paper._count.questions, status: 'not_started' },
    });
  }
  return { todayLesson, tasks };
}

/** /student/courses/:id/lessons 独立重算 */
async function expectedTimeline(orgId: bigint, sid: bigint, courseId: bigint) {
  const lessons = await raw.lesson.findMany({ where: { courseId }, orderBy: { seq: 'asc' } });
  const visible = (await visibleAssignments(orgId, sid)).filter((a) => a.kind === 'homework');
  const items = [];
  for (const l of lessons) {
    const session = await raw.classSession.findFirst({
      where: { lessonId: l.id, status: { not: 'ended' } },
      orderBy: { id: 'desc' },
    });
    const hws = visible
      .filter((a) => a.lessonId != null && String(a.lessonId) === String(l.id))
      .sort((a, b) => Number(a.id - b.id));
    const hw = hws[hws.length - 1]; // 最新一条
    let myHomework = null;
    if (hw) {
      const at = await raw.attempt.findFirst({
        where: { assignmentId: hw.id, studentId: sid },
        orderBy: { attemptNo: 'desc' },
      });
      let score: number | null = null;
      let wrongCount = 0;
      if (at) {
        score = at.score == null ? null : Number(at.score);
        const answers = await raw.answer.findMany({ where: { attemptId: at.id } });
        const pqs = await raw.paperQuestion.findMany({ where: { paperId: hw.paperId } });
        const full = new Map(pqs.map((pq) => [String(pq.questionId), Number(pq.score)]));
        wrongCount = answers.filter(
          (a) =>
            a.isCorrect === false ||
            (a.isCorrect == null && a.score != null && Number(a.score) < (full.get(String(a.questionId)) ?? 0)),
        ).length;
      }
      myHomework = { assignmentId: Number(hw.id), score, wrongCount };
    }
    items.push({
      lesson: {
        id: Number(l.id), courseId: Number(l.courseId), seq: l.seq, title: l.title,
        scheduledStart: l.scheduledStart ? l.scheduledStart.toISOString() : null,
        scheduledEnd: l.scheduledEnd ? l.scheduledEnd.toISOString() : null,
        status: l.status, prepChecklist: (l.prepChecklist ?? {}) as Record<string, boolean>,
        openingConfig: (l.openingConfig ?? null) as Record<string, unknown> | null,
        sessionId: session ? Number(session.id) : null,
      },
      sessionId: session ? Number(session.id) : null,
      myHomework,
    });
  }
  return items;
}

/** /student/report 独立重算 */
async function expectedReport(sid: bigint) {
  const since = daysAgo(7);
  const snaps = await raw.masterySnapshot.findMany({
    where: { studentId: sid },
    include: { node: { select: { name: true, graph: { select: { graphType: true } } } } },
    orderBy: { nodeId: 'asc' },
  });
  const answers = await raw.answer.findMany({
    where: { attempt: { studentId: sid }, createdAt: { gte: since } },
    select: { isCorrect: true },
  });
  const judged = answers.filter((a) => a.isCorrect != null);
  const study = await raw.attempt.aggregate({
    where: { studentId: sid, startedAt: { gte: since } },
    _sum: { durationSec: true },
  });
  const wrongOpenCount = await raw.wrongBookEntry.count({ where: { studentId: sid, status: 'open' } });
  return {
    mastery: snaps.map((m) => ({
      nodeId: Number(m.nodeId), nodeName: m.node.name, graphType: m.node.graph.graphType,
      mastery: m.mastery, sampleCount: m.sampleCount,
    })),
    weekStats: {
      answeredCount: answers.length,
      correctRate: judged.length ? round2(judged.filter((a) => a.isCorrect).length / judged.length) : null,
      studySec: study._sum.durationSec ?? 0,
      wrongOpenCount,
    },
  };
}

describe('学生端只读杂项(FIX1)', () => {
  let app: INestApplication;
  let http: any;
  let fx: Fix1Fixture;
  let s1: string;
  let s2: string;
  let s3: string;
  let teacher: string;
  let admin: string;
  let studentB: string;
  const R1_CONTENT = '<html>FIX1 平移动画课件字节样本 0123456789</html>';

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const get = (url: string, token: string) => request(http).get(`/api/v1${url}`).set(auth(token));
  const login = async (phone: string, password: string) => {
    const res = await request(http).post('/api/v1/auth/login').send({ phone, password }).expect(200);
    return res.body.data.accessToken as string;
  };
  const studentLogin = async (_orgId: bigint, sid: bigint, _fp?: string) =>
    loginStudentById(http, sid);
  /** 签名 URL 是绝对地址,e2e 不占固定端口 → 取 path 打到测试 server */
  const pathOf = (url: string) => {
    const u = new URL(url);
    return u.pathname + u.search;
  };

  beforeAll(async () => {
    app = await createApp();
    http = app.getHttpServer();
    fx = await createFix1Org();
    // R1 课件字节落盘(模拟 A3 直传完成后的对象)
    const target = join(UPLOAD_ROOT, fx.r1OssKey);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, R1_CONTENT);

    s1 = await studentLogin(fx.orgId, fx.s1Id, 'fix1-fp-1');
    s2 = await studentLogin(fx.orgId, fx.s2Id, 'fix1-fp-2');
    s3 = await studentLogin(fx.orgId, fx.s3Id, 'fix1-fp-3');
    teacher = await login(fx.teacherPhone, FIX1_PASSWORD);
    admin = await login(fx.adminPhone, FIX1_PASSWORD);
    studentB = await studentLogin(fx.orgBId, fx.studentBId, 'fix1-fp-b');
  });

  afterAll(async () => {
    await app.close();
    await dropFix1Org(fx.orgId, fx.orgBId);
    await raw.$disconnect();
    rmSync(UPLOAD_ROOT, { recursive: true, force: true });
  });

  // ================= GET /student/today =================

  it('验收:today = 夹具手算 —— todayLesson(L2 + canEnterAt-10min + scheduled session)+ tasks 三态 progress', async () => {
    const res = await get('/student/today', s1).expect(200);
    const data = res.body.data;
    exactKeys(data, TODAY_KEYS);
    expect(data.todayLesson).toEqual({
      lessonId: Number(fx.l2Id),
      courseName: 'FIX1 · 初二数学冲刺班',
      title: 'FIX1 第2讲 · 图象平移',
      startAt: fx.l2Start.toISOString(),
      endAt: fx.l2End.toISOString(),
      canEnterAt: new Date(fx.l2Start.getTime() - 600_000).toISOString(),
      sessionId: Number(fx.sessionId),
    });
    exactKeys(data.todayLesson, TODAY_LESSON_KEYS);
    // tasks:可见作业全集,id 倒序;progress 覆盖 not_started / submitted / graded 三态
    expect(data.tasks.map((t: any) => [t.assignmentId, t.progress.status, t.progress.answered])).toEqual([
      [Number(fx.pendAssignmentId), 'not_started', 0],
      [Number(fx.oldAssignmentId), 'submitted', 1],
      [Number(fx.hwAssignmentId), 'graded', 3],
    ]);
    const hwTask = data.tasks.find((t: any) => t.assignmentId === Number(fx.hwAssignmentId));
    expect(hwTask).toEqual({
      assignmentId: Number(fx.hwAssignmentId), kind: 'homework', title: 'FIX1 · 第1讲课后作业',
      questionCount: 3, dueAt: expect.any(String), progress: { answered: 3, total: 3, status: 'graded' },
    });
    const oldTask = data.tasks.find((t: any) => t.assignmentId === Number(fx.oldAssignmentId));
    expect(oldTask.kind).toBe('wrong_redo');
    expect(oldTask.dueAt).toBeNull();
    for (const t of data.tasks) {
      exactKeys(t, TASK_KEYS);
      exactKeys(t.progress, PROGRESS_KEYS);
    }
    // 与测试内独立重算一致
    expect(data).toEqual(await expectedToday(fx.orgId, fx.s1Id));
  });

  it('today:多课程取今日最早讲次(s2 选 C1+C2 → 取 L2 而非 L4);s2 的 A_hw 为 submitted', async () => {
    const res = await get('/student/today', s2).expect(200);
    const data = res.body.data;
    expect(data.todayLesson.lessonId).toBe(Number(fx.l2Id));
    expect(data.tasks.map((t: any) => [t.assignmentId, t.progress.status])).toEqual([
      [Number(fx.pendAssignmentId), 'not_started'],
      [Number(fx.hwAssignmentId), 'submitted'],
    ]);
    expect(data).toEqual(await expectedToday(fx.orgId, fx.s2Id));
  });

  // ================= GET /student/courses =================

  it('验收:courses = 夹具手算 —— 仅 active 选课;聚合口径同 A2/A4(currentLesson/nextLessonAt/比率)', async () => {
    const res = await get('/student/courses', s1).expect(200);
    const data = res.body.data;
    expect(data).toEqual([
      {
        id: Number(fx.course1Id), name: 'FIX1 · 初二数学冲刺班', classType: 'group',
        subject: '数学', stage: '初中', teacherId: expect.any(Number), teacherName: 'FIX1教师',
        totalLessons: 3, currentLesson: 1, studentCount: 2, status: 'ongoing',
        nextLessonAt: fx.l3Start.toISOString(),
        attendanceRate: null, // 无已结束会话
        homeworkRate: 1, // 2 名 active 学生 × 1 份 homework,2 人已交
      },
    ]);
    for (const c of data) exactKeys(c, COURSE_KEYS);
    expect(data).toEqual(await expectedCourses(fx.s1Id));
    // s2 同时选了 C1/C2;quit 的 s3 一门都看不到
    const res2 = await get('/student/courses', s2).expect(200);
    expect(res2.body.data.map((c: any) => c.id)).toEqual([Number(fx.course1Id), Number(fx.course2Id)]);
    expect(res2.body.data).toEqual(await expectedCourses(fx.s2Id));
    const res3 = await get('/student/courses', s3).expect(200);
    expect(res3.body.data).toEqual([]);
  });

  // ================= GET /student/courses/:id/lessons =================

  it('验收:讲次时间线 = 夹具手算 —— seq 升序;L1.myHomework{score:10,wrongCount:2(客观错1+主观5<10)},其余 null', async () => {
    const res = await get(`/student/courses/${fx.course1Id}/lessons`, s1).expect(200);
    const data = res.body.data;
    expect(data.map((x: any) => x.lesson.seq)).toEqual([1, 2, 3]);
    // FIX4 · #1:L2(已发布,有未结束会话)sessionId 非 null;L1(finished 无会话)/L3(draft)为 null
    expect(data.map((x: any) => x.sessionId)).toEqual([null, Number(fx.sessionId), null]);
    expect(data[0].myHomework).toEqual({
      assignmentId: Number(fx.hwAssignmentId),
      score: 10,
      wrongCount: 2,
    });
    expect(data[1].myHomework).toBeNull();
    expect(data[2].myHomework).toBeNull();
    expect(data[0].lesson).toEqual({
      id: Number(fx.l1Id), courseId: Number(fx.course1Id), seq: 1,
      title: 'FIX1 第1讲 · 待定系数法', scheduledStart: expect.any(String),
      scheduledEnd: expect.any(String), status: 'finished', prepChecklist: {}, openingConfig: null,
      sessionId: null, // L1 finished 无未结束会话
    });
    for (const item of data) {
      exactKeys(item, TIMELINE_KEYS);
      exactKeys(item.lesson, LESSON_KEYS);
      if (item.myHomework) exactKeys(item.myHomework, MYHW_KEYS);
    }
    expect(data).toEqual(await expectedTimeline(fx.orgId, fx.s1Id, fx.course1Id));
    // s2 未交作业:myHomework.score=null(交了的 attempt 没出分前同理),wrongCount=0
    const res2 = await get(`/student/courses/${fx.course1Id}/lessons`, s2).expect(200);
    expect(res2.body.data[0].myHomework).toEqual({
      assignmentId: Number(fx.hwAssignmentId), score: null, wrongCount: 0,
    });
  });

  it('讲次时间线门禁:未选课的同租户课程 / quit 学生 → 404;不存在课程 → 404', async () => {
    await get(`/student/courses/${fx.course2Id}/lessons`, s1).expect(404); // s1 未选 C2
    await get(`/student/courses/${fx.course1Id}/lessons`, s3).expect(404); // s3 已 quit
    await get('/student/courses/99999999/lessons', s1).expect(404);
  });

  // ================= GET /student/report =================

  it('验收:report = 夹具手算 —— mastery 全维度 nodeId 升序;weekStats{3题,0.5,1234s,2 open}(10 天前作答不入周窗口)', async () => {
    const res = await get('/student/report', s1).expect(200);
    const data = res.body.data;
    exactKeys(data, REPORT_KEYS);
    exactKeys(data.weekStats, WEEK_KEYS);
    expect(data.mastery).toEqual([
      { nodeId: Number(fx.node1Id), nodeName: 'FIX1·一次函数概念', graphType: 'curriculum_knowledge', mastery: 75, sampleCount: 4 },
      { nodeId: Number(fx.nodeM1Id), nodeName: 'FIX1·运算能力', graphType: 'problem_solving_ability', mastery: 50, sampleCount: 2 },
    ]);
    for (const m of data.mastery) exactKeys(m, MASTERY_ITEM_KEYS);
    // answeredCount=3(A_old 的 1 题在 10 天前,窗口外);correctRate=1对1错=0.5(主观题不入分母);
    // studySec=1234(A_old 的 999 在窗口外);wrongOpenCount=2(q4 已 cleared)
    expect(data.weekStats).toEqual({ answeredCount: 3, correctRate: 0.5, studySec: 1234, wrongOpenCount: 2 });
    expect(data).toEqual(await expectedReport(fx.s1Id));
  });

  // ================= GET /student/resources/:id/view =================

  it('验收:resources/view —— 签名 URL(FIXB·B4:TTL 内可重复使用)→ 两次 GET 均 200 且字节一致;过期 → 403;伪 token → 403', async () => {
    const res = await get(`/student/resources/${fx.r1Id}/view`, s1).expect(200);
    const data = res.body.data;
    exactKeys(data, VIEW_KEYS);
    expect(new URL(data.url).pathname).toMatch(/^\/api\/v1\/student\/resources\/local\/[a-f0-9]{48}$/);
    const expiresAt = new Date(data.expiresAt).getTime();
    expect(expiresAt).toBeGreaterThan(Date.now());
    expect(expiresAt).toBeLessThanOrEqual(Date.now() + 601_000); // TTL=600s

    // FIXB·B4:TTL 内两次 GET 均 200、字节一致(刷新 / 视频 Range 分段 / PDF 二次拉取复用同一 URL)
    const dl1 = await request(http).get(pathOf(data.url)).expect(200);
    expect(dl1.headers['content-type']).toContain('application/octet-stream');
    expect(Buffer.from(dl1.body).toString('utf8')).toBe(R1_CONTENT);
    const dl2 = await request(http).get(pathOf(data.url)).expect(200);
    expect(Buffer.from(dl2.body).toString('utf8')).toBe(R1_CONTENT);

    // 过期(模拟 Redis TTL 失效 → resolveToken GET 得 null)→ 403
    const token = new URL(data.url).pathname.split('/').pop()!;
    await app.get<Redis>(REDIS).del(`view:token:${token}`);
    await request(http).get(pathOf(data.url)).expect(403);
    // 伪造 token → 403(无需登录态,但拿不到内容)
    await request(http).get(`/api/v1/student/resources/local/${'0'.repeat(48)}`).expect(403);
  });

  it('resources/view 门禁:未被"我的课程"引用(他课课件)→ 404;不存在 → 404;quit 学生 → 404', async () => {
    await get(`/student/resources/${fx.r2Id}/view`, s1).expect(404); // R2 仅被 C2 引用,s1 未选
    await get(`/student/resources/99999999/view`, s1).expect(404);
    await get(`/student/resources/${fx.r1Id}/view`, s3).expect(404); // s3 quit,不可回看
    // s2 选了 C2 → R2 可回看(token 有效,但文件未落盘)
    const ok = await get(`/student/resources/${fx.r2Id}/view`, s2).expect(200);
    await request(http).get(pathOf(ok.body.data.url)).expect(404); // token 解析成功但文件未落盘 → 404(B4:非消费)
  });

  // ================= seed 对账(只读) =================

  it('验收:seed 学生四个读端点 → 与测试内独立重算逐字段一致(today/courses/lessons/report)', async () => {
    const seedCourse = await raw.course.findFirstOrThrow({ where: { name: '初二数学提高班' } });
    const seedStudent = await raw.user.findFirstOrThrow({
      where: { orgId: seedCourse.orgId, role: 'student', deletedAt: null },
      orderBy: { id: 'asc' },
    });
    const token = await studentLogin(seedCourse.orgId, seedStudent.id, 'fp-demo-1'); // seed 已绑指纹

    const today = await get('/student/today', token).expect(200);
    expect(today.body.data).toEqual(await expectedToday(seedCourse.orgId, seedStudent.id));
    expect(today.body.data.tasks.length).toBeGreaterThan(0); // seed 有 1 份课后作业,对账有效

    const courses = await get('/student/courses', token).expect(200);
    const expCourses = await expectedCourses(seedStudent.id);
    expect(expCourses.length).toBe(1); // seed 仅整班课有选课记录
    expect(courses.body.data).toEqual(expCourses);

    const lessons = await get(`/student/courses/${seedCourse.id}/lessons`, token).expect(200);
    const expTimeline = await expectedTimeline(seedCourse.orgId, seedStudent.id, seedCourse.id);
    expect(lessons.body.data).toEqual(expTimeline);
    expect(lessons.body.data.map((x: any) => x.lesson.seq)).toEqual([1, 2, 3, 4, 5, 6]);
    // seed 的课后作业挂第 3 讲且该生已 graded → myHomework 数字非平凡
    const seq3 = lessons.body.data.find((x: any) => x.lesson.seq === 3);
    expect(seq3.myHomework).not.toBeNull();
    expect(seq3.myHomework.score).toBeGreaterThan(0);

    const report = await get('/student/report', token).expect(200);
    expect(report.body.data).toEqual(await expectedReport(seedStudent.id));
    expect(report.body.data.mastery.length).toBeGreaterThan(0);

    // seed 课件:res1(讲次引用)可签发;res2(未被引用)→ 404
    const seedRes1 = await raw.resource.findFirstOrThrow({
      where: { orgId: seedCourse.orgId, name: { contains: '动画演示' } },
    });
    const seedRes2 = await raw.resource.findFirstOrThrow({
      where: { orgId: seedCourse.orgId, name: { contains: '微课视频' } },
    });
    const view = await get(`/student/resources/${seedRes1.id}/view`, token).expect(200);
    await request(http).get(pathOf(view.body.data.url)).expect(404); // seed 文件未落盘 → 404(B4:token 有效但无字节)
    await get(`/student/resources/${seedRes2.id}/view`, token).expect(404);
  });

  // ================= 跨租户 404 + 角色门禁(宪法 §7) =================

  it('跨租户互查 → 404(宪法 §7):lessons/view 双向;学生B 的 today/courses 看不到机构A 任何数据', async () => {
    await get(`/student/courses/${fx.courseBId}/lessons`, s1).expect(404);
    await get(`/student/resources/${fx.resourceBId}/view`, s1).expect(404);
    await get(`/student/courses/${fx.course1Id}/lessons`, studentB).expect(404);
    await get(`/student/resources/${fx.r1Id}/view`, studentB).expect(404);
    // 无路径参数端点:隔离性 = 学生B 看不到机构A 数据(courseB 明日开课 → today 为空)
    const today = await get('/student/today', studentB).expect(200);
    expect(today.body.data).toEqual({ todayLesson: null, tasks: [] });
    const courses = await get('/student/courses', studentB).expect(200);
    expect(courses.body.data.map((c: any) => c.id)).toEqual([Number(fx.courseBId)]);
  });

  it('角色门禁:teacher/admin 调 5 端点 → 403(openapi [student]);无 token → 401', async () => {
    const urls = [
      '/student/today',
      '/student/courses',
      `/student/courses/${fx.course1Id}/lessons`,
      '/student/report',
      `/student/resources/${fx.r1Id}/view`,
    ];
    for (const url of urls) {
      await get(url, teacher).expect(403);
      await get(url, admin).expect(403);
      await request(http).get(`/api/v1${url}`).expect(401);
    }
  });
});
