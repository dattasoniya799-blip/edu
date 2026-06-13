/**
 * 验收覆盖(任务卡 A4 · 课程/讲次/编排/试卷/作业发布):
 * - /teacher/courses 聚合:仅本人课程、nextLessonAt=未来最近讲次、字段与契约一致
 * - segments PUT 全量替换(事务);publish:缺 homework → 4201 + 缺失项,
 *   prep_checklist 同步落库;补齐(homework 环节 + published paper)后 → ready
 * - papers:创建/改题重算 totalScore;已被 assignment 引用 → 4302
 * - assignments:target courseId/studentIds 二选一;correction 不计分;progress 对账
 * - 发布作业后目标学生可见、非目标不可见(A5 边界:走 AssignmentService.listForStudent
 *   服务层断言 + assignments 表数据断言,/student/assignments 路由属 A5)
 * - resources:登记/改名/usedByLessons 反查/被引用禁删 4303/软删
 * - 跨租户 404(宪法 §7)与角色门禁
 */
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { AssignmentDto, CourseDto, LessonDto, PaperDto, ResourceDto } from '@qiming/contracts';
import { AssignmentService } from '../src/assignment/assignment.service';
import { runAsUser } from '../src/common/tenant-context';
import { A4_PASSWORD, A4Fixture, createA4Org, dropA4Org } from './fixtures/a4.fixtures';
import { createApp, loginStudentById, raw } from './fixtures/setup';

const SEED_TEACHER = { phone: '13800000002', password: 'Teacher@123' };

const exactKeys = (obj: object, keys: string[]) =>
  expect(Object.keys(obj).sort()).toEqual([...keys].sort());

const COURSE_KEYS = ['id', 'name', 'classType', 'subject', 'stage', 'teacherId', 'teacherName', 'totalLessons', 'currentLesson', 'studentCount', 'status', 'nextLessonAt', 'attendanceRate', 'homeworkRate'];
const LESSON_KEYS = ['id', 'courseId', 'seq', 'title', 'scheduledStart', 'scheduledEnd', 'status', 'prepChecklist'];
const SEGMENT_KEYS = ['id', 'seq', 'type', 'durationMin', 'config', 'resourceId', 'paperId', 'kpNodeId', 'kpNodeName'];
const PAPER_KEYS = ['id', 'name', 'type', 'totalScore', 'status', 'questions'];
const PAPER_QUESTION_KEYS = ['seq', 'questionId', 'score', 'type', 'stemLatex'];
const ASSIGNMENT_KEYS = ['id', 'paperId', 'paperName', 'lessonId', 'kind', 'target', 'publishAt', 'dueAt', 'scoreCounted', 'questionCount', 'totalScore'];
const RESOURCE_KEYS = ['id', 'type', 'name', 'ossKey', 'size', 'meta', 'usedByLessons', 'createdAt'];
const PROGRESS_KEYS = ['submitted', 'totalStudents', 'gradedSubjective', 'pendingSubjective'];

describe('课程/讲次/编排/试卷/作业(A4)', () => {
  let app: INestApplication;
  let http: any;
  let fx: A4Fixture;
  let teacherA: string;
  let teacherB: string;
  let admin: string;
  let student: string;
  let seedTeacherAt: string; // org1(seed),跨租户用例
  let seedCourseId: number;
  let seedPaperId: number;

  // 跨用例共享的业务对象(按 it 顺序产生)
  let resourceId: number;
  let resource2Id: number;
  let practicePaperId: number;
  let hwPaperId: number;
  let hwAssignment: AssignmentDto;
  let correctionAssignment: AssignmentDto;

  const login = async (phone: string, password: string) => {
    const res = await request(http).post('/api/v1/auth/login').send({ phone, password }).expect(200);
    return res.body.data.accessToken as string;
  };
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const lessonId = (i: number) => Number(fx.lessonIds[i]);

  /** 四类基础环节(可选追加 homework) */
  const baseSegments = (practicePaper: number, opts?: { resource?: number; homeworkPaper?: number }) => {
    const segs: object[] = [
      { seq: 1, type: 'warmup', durationMin: 10, config: { source: 'auto_wrong', count: 3 }, resourceId: null, paperId: null },
      { seq: 2, type: 'lecture', durationMin: 35, config: { checkpoints: [{ page: 3 }, { page: 8 }] }, resourceId: opts?.resource ?? null, paperId: null },
      { seq: 3, type: 'practice', durationMin: 30, config: { ai_guide: true, stuck_alert_min: 3 }, resourceId: null, paperId: practicePaper },
      { seq: 4, type: 'summary', durationMin: 15, config: { personal_consolidation: { min: 2, max: 4 } }, resourceId: null, paperId: null },
    ];
    if (opts?.homeworkPaper) segs.push({ seq: 5, type: 'homework', durationMin: 30, config: {}, resourceId: null, paperId: opts.homeworkPaper });
    return segs;
  };

  beforeAll(async () => {
    app = await createApp();
    http = app.getHttpServer();
    fx = await createA4Org();

    [teacherA, teacherB, admin, seedTeacherAt] = await Promise.all([
      login(fx.teacherAPhone, A4_PASSWORD),
      login(fx.teacherBPhone, A4_PASSWORD),
      login(fx.adminPhone, A4_PASSWORD),
      login(SEED_TEACHER.phone, SEED_TEACHER.password),
    ]);
    student = await loginStudentById(http, fx.s1Id);

    // seed 机构(org1)的课程/试卷 id,用于跨租户 404
    const seedOrg = await raw.org.findFirstOrThrow({ where: { name: '鲸云演示机构' } });
    seedCourseId = Number((await raw.course.findFirstOrThrow({ where: { orgId: seedOrg.id } })).id);
    seedPaperId = Number((await raw.paper.findFirstOrThrow({ where: { orgId: seedOrg.id } })).id);
  });

  afterAll(async () => {
    await dropA4Org(fx.orgId);
    await raw.$disconnect();
    await app.close();
  });

  // ================= /teacher/courses =================

  it('/teacher/courses:仅本人课程,nextLessonAt=未来最近讲次,字段与契约一致', async () => {
    const res = await request(http).get('/api/v1/teacher/courses').set(auth(teacherA)).expect(200);
    expect(res.body.code).toBe(0);
    const courses: CourseDto[] = res.body.data;
    const mine = courses.find((c) => c.id === Number(fx.courseId))!;
    expect(mine).toBeDefined();
    exactKeys(mine, COURSE_KEYS);
    expect(mine.teacherId).toBe(Number(fx.teacherAId));
    expect(mine.teacherName).toBe('A4教师甲');
    expect(mine.totalLessons).toBe(3);
    expect(mine.currentLesson).toBe(0); // 无 finished 讲次
    expect(mine.studentCount).toBe(2); // s1、s2
    expect(mine.nextLessonAt).toBe(fx.lesson1StartIso); // 未来最近一讲
    expect(mine.attendanceRate).toBeNull(); // 无课堂会话
    expect(mine.homeworkRate).toBeNull(); // 此刻尚无 homework 作业

    // 仅返回"我的"课程:teacherB 看不到 teacherA 的课
    const resB = await request(http).get('/api/v1/teacher/courses').set(auth(teacherB)).expect(200);
    expect((resB.body.data as CourseDto[]).some((c) => c.id === Number(fx.courseId))).toBe(false);
  });

  it('/teacher/courses 角色门禁:admin/student → 403', async () => {
    await request(http).get('/api/v1/teacher/courses').set(auth(admin)).expect(403);
    await request(http).get('/api/v1/teacher/courses').set(auth(student)).expect(403);
  });

  // ================= 讲次 =================

  it('/courses/:id/lessons:时间线 seq 连续,teacher/admin 可读;跨租户 → 404', async () => {
    const res = await request(http).get(`/api/v1/courses/${fx.courseId}/lessons`).set(auth(teacherA)).expect(200);
    const lessons: LessonDto[] = res.body.data;
    expect(lessons.map((l) => l.seq)).toEqual([1, 2, 3]);
    exactKeys(lessons[0], LESSON_KEYS);
    expect(lessons[0].courseId).toBe(Number(fx.courseId));
    expect(lessons[0].status).toBe('draft');
    expect(lessons[0].prepChecklist).toEqual({});
    await request(http).get(`/api/v1/courses/${fx.courseId}/lessons`).set(auth(admin)).expect(200);

    // 跨租户双向 404(宪法 §7)
    await request(http).get(`/api/v1/courses/${fx.courseId}/lessons`).set(auth(seedTeacherAt)).expect(404);
    await request(http).get(`/api/v1/courses/${seedCourseId}/lessons`).set(auth(teacherA)).expect(404);
  });

  it('PUT /lessons/:id 改标题/时间;start>=end → 400;跨租户 → 404', async () => {
    const id = lessonId(2);
    const start = new Date(Date.now() + 30 * 86400_000).toISOString();
    const end = new Date(Date.now() + 30 * 86400_000 + 2 * 3600_000).toISOString();
    const res = await request(http)
      .put(`/api/v1/lessons/${id}`)
      .set(auth(teacherA))
      .send({ title: '第3讲 · 单元复习', scheduledStart: start, scheduledEnd: end })
      .expect(200);
    expect(res.body).toEqual({ code: 0, message: 'ok', data: null });

    const got = await request(http).get(`/api/v1/lessons/${id}`).set(auth(teacherA)).expect(200);
    expect(got.body.data.title).toBe('第3讲 · 单元复习');
    expect(got.body.data.scheduledStart).toBe(start);
    expect(got.body.data.scheduledEnd).toBe(end);

    await request(http)
      .put(`/api/v1/lessons/${id}`)
      .set(auth(teacherA))
      .send({ scheduledStart: end, scheduledEnd: start })
      .expect(400);
    await request(http).put(`/api/v1/lessons/${id}`).set(auth(seedTeacherAt)).send({ title: 'x' }).expect(404);
  });

  // ================= 资源 + 试卷(编排的前置物料) =================

  it('resources:登记 → 契约字段一致,usedByLessons 初始为空;列表过滤', async () => {
    const res = await request(http)
      .post('/api/v1/resources')
      .set(auth(teacherA))
      .send({ type: 'interactive', name: 'A4 函数图象动画', ossKey: 'courseware/a4/anim.html', size: 20480, meta: { pages: 24 } })
      .expect(200);
    const r: ResourceDto = res.body.data;
    exactKeys(r, RESOURCE_KEYS);
    expect(r.usedByLessons).toEqual([]);
    expect(r.size).toBe(20480);
    expect(r.meta).toEqual({ pages: 24 });
    resourceId = r.id;

    const r2 = await request(http)
      .post('/api/v1/resources')
      .set(auth(teacherA))
      .send({ type: 'video', name: 'A4 微课视频', ossKey: 'video/a4/v1.mp4', size: 1024 })
      .expect(200);
    resource2Id = r2.body.data.id;

    const list = await request(http)
      .get('/api/v1/resources?type=interactive&keyword=A4')
      .set(auth(teacherA))
      .expect(200);
    const items: ResourceDto[] = list.body.data.items;
    expect(items.some((x) => x.id === resourceId)).toBe(true);
    expect(items.some((x) => x.id === resource2Id)).toBe(false); // type 过滤生效
  });

  it('papers:创建重算 totalScore(验收项),明细与契约逐字段一致', async () => {
    const [q1, q2, q3, q4] = fx.questionIds;
    const res = await request(http)
      .post('/api/v1/papers')
      .set(auth(teacherA))
      .send({ name: 'A4 · 第1讲随堂练', type: 'practice', questions: [{ questionId: q1, score: 5 }, { questionId: q2, score: 5 }] })
      .expect(200);
    const p: PaperDto = res.body.data;
    exactKeys(p, PAPER_KEYS);
    p.questions.forEach((it) => exactKeys(it, PAPER_QUESTION_KEYS));
    expect(p.totalScore).toBe(10); // 服务端重算,不信任客户端
    expect(p.status).toBe('published');
    expect(p.questions.map((it) => it.seq)).toEqual([1, 2]);
    expect(p.questions[0].questionId).toBe(q1);
    expect(p.questions[0].stemLatex).toContain('A4-Q1');
    practicePaperId = p.id;

    const hw = await request(http)
      .post('/api/v1/papers')
      .set(auth(teacherA))
      .send({ name: 'A4 · 第1讲课后作业', type: 'homework', questions: [{ questionId: q3, score: 10 }, { questionId: q4, score: 5 }] })
      .expect(200);
    expect(hw.body.data.totalScore).toBe(15);
    hwPaperId = hw.body.data.id;

    const list = await request(http).get('/api/v1/papers?type=homework').set(auth(teacherA)).expect(200);
    const items: PaperDto[] = list.body.data.items;
    expect(items.some((x) => x.id === hwPaperId)).toBe(true);
    expect(items.some((x) => x.id === practicePaperId)).toBe(false); // type 过滤生效
  });

  it('papers:改题/调分重算 totalScore(验收项);重复题 → 400;题不存在 → 404', async () => {
    const [q1, q2, q3] = fx.questionIds;
    await request(http)
      .put(`/api/v1/papers/${practicePaperId}`)
      .set(auth(teacherA))
      .send({ name: 'A4 · 第1讲随堂练v2', type: 'practice', questions: [{ questionId: q1, score: 5 }, { questionId: q2, score: 5 }, { questionId: q3, score: 10 }] })
      .expect(200);
    const got = await request(http).get(`/api/v1/papers/${practicePaperId}`).set(auth(teacherA)).expect(200);
    expect(got.body.data.totalScore).toBe(20);
    expect(got.body.data.questions).toHaveLength(3);
    expect(got.body.data.name).toBe('A4 · 第1讲随堂练v2');

    await request(http)
      .put(`/api/v1/papers/${practicePaperId}`)
      .set(auth(teacherA))
      .send({ name: 'x', type: 'practice', questions: [{ questionId: q1, score: 5 }, { questionId: q1, score: 5 }] })
      .expect(400);
    await request(http)
      .post('/api/v1/papers')
      .set(auth(teacherA))
      .send({ name: 'x', type: 'practice', questions: [{ questionId: 999999999, score: 5 }] })
      .expect(404);
    // 跨租户读他 org 试卷 → 404
    await request(http).get(`/api/v1/papers/${seedPaperId}`).set(auth(teacherA)).expect(404);
    await request(http).get(`/api/v1/papers/${practicePaperId}`).set(auth(seedTeacherAt)).expect(404);
  });

  // ================= 编排(segments) =================

  it('PUT /lessons/:id/segments 全量替换(事务)+ GET 回读;再次 PUT 旧环节被整体替换', async () => {
    const id = lessonId(0);
    await request(http)
      .put(`/api/v1/lessons/${id}/segments`)
      .set(auth(teacherA))
      .send(baseSegments(practicePaperId, { resource: resourceId }))
      .expect(200);

    const got = await request(http).get(`/api/v1/lessons/${id}/segments`).set(auth(teacherA)).expect(200);
    const segs = got.body.data;
    expect(segs).toHaveLength(4);
    segs.forEach((s: object) => exactKeys(s, SEGMENT_KEYS));
    expect(segs.map((s: { type: string }) => s.type)).toEqual(['warmup', 'lecture', 'practice', 'summary']);
    expect(segs[0].config).toEqual({ source: 'auto_wrong', count: 3 }); // config 原样往返
    expect(segs[1].resourceId).toBe(resourceId);
    expect(segs[2].paperId).toBe(practicePaperId);
    expect(segs[3].paperId).toBeNull();
    // 未挂知识点 → kpNodeId / kpNodeName 均为 null
    expect(segs[0].kpNodeId).toBeNull();
    expect(segs[0].kpNodeName).toBeNull();

    // 全量替换:旧 4 条被 2 条覆盖
    await request(http)
      .put(`/api/v1/lessons/${id}/segments`)
      .set(auth(teacherA))
      .send([
        { seq: 1, type: 'lecture', durationMin: 40, config: {}, resourceId: resourceId, paperId: null },
        { seq: 2, type: 'break_time', durationMin: 10, config: {}, resourceId: null, paperId: null },
      ])
      .expect(200);
    const got2 = await request(http).get(`/api/v1/lessons/${id}/segments`).set(auth(teacherA)).expect(200);
    expect(got2.body.data).toHaveLength(2);
    expect(got2.body.data.map((s: { type: string }) => s.type)).toEqual(['lecture', 'break_time']);
  });

  it('segments 知识点标签:写 kpNodeId → GET 回填 kpNodeName(写入忽略 kpNodeName);不存在节点 → 404', async () => {
    const id = lessonId(0);
    await request(http)
      .put(`/api/v1/lessons/${id}/segments`)
      .set(auth(teacherA))
      .send([
        // kpNodeName 为只读字段,写入应被忽略,GET 时以 join kp_nodes 的真实名称回填
        { seq: 1, type: 'lecture', durationMin: 20, config: {}, resourceId: null, paperId: null, kpNodeId: fx.kpNodeId, kpNodeName: '应被忽略' },
        { seq: 2, type: 'practice', durationMin: 20, config: {}, resourceId: null, paperId: practicePaperId },
      ])
      .expect(200);
    const got = await request(http).get(`/api/v1/lessons/${id}/segments`).set(auth(teacherA)).expect(200);
    expect(got.body.data[0].kpNodeId).toBe(fx.kpNodeId);
    expect(got.body.data[0].kpNodeName).toBe(fx.kpNodeName);
    expect(got.body.data[1].kpNodeId).toBeNull();
    expect(got.body.data[1].kpNodeName).toBeNull();

    // 引用不存在 / 他 org 的知识点节点 → 404
    await request(http)
      .put(`/api/v1/lessons/${id}/segments`)
      .set(auth(teacherA))
      .send([{ seq: 1, type: 'lecture', durationMin: 20, config: {}, resourceId: null, paperId: null, kpNodeId: 999999999 }])
      .expect(404);
  });

  it('segments 校验:seq 重复/挂载错位 → 400;引用不存在的课件或试卷 → 404;跨租户 → 404', async () => {
    const id = lessonId(0);
    const seg = (over: object) => ({ seq: 1, type: 'lecture', durationMin: 30, config: {}, resourceId: null, paperId: null, ...over });
    await request(http).put(`/api/v1/lessons/${id}/segments`).set(auth(teacherA))
      .send([seg({}), seg({ type: 'summary' })]).expect(400); // seq 重复
    await request(http).put(`/api/v1/lessons/${id}/segments`).set(auth(teacherA))
      .send([seg({ paperId: practicePaperId })]).expect(400); // lecture 不能挂 paper
    await request(http).put(`/api/v1/lessons/${id}/segments`).set(auth(teacherA))
      .send([seg({ type: 'practice', resourceId: resourceId })]).expect(400); // practice 不能挂课件
    await request(http).put(`/api/v1/lessons/${id}/segments`).set(auth(teacherA))
      .send([seg({ resourceId: 999999999 })]).expect(404);
    await request(http).put(`/api/v1/lessons/${id}/segments`).set(auth(teacherA))
      .send([seg({ type: 'practice', paperId: seedPaperId })]).expect(404); // 他 org 试卷不可见
    await request(http).put(`/api/v1/lessons/${id}/segments`).set(auth(seedTeacherAt))
      .send([seg({})]).expect(404);
    await request(http).get(`/api/v1/lessons/${id}/segments`).set(auth(seedTeacherAt)).expect(404);
  });

  // ================= 发布(验收核心) =================

  it('验收:自由编排 publish —— 无 homework 环节也可发布(放宽规则),prep_checklist 按实际类型标记', async () => {
    const id = lessonId(0);
    // 四类齐备但无 homework:放宽后不再因缺某类型环节报错
    await request(http)
      .put(`/api/v1/lessons/${id}/segments`)
      .set(auth(teacherA))
      .send(baseSegments(practicePaperId, { resource: resourceId }))
      .expect(200);

    const res = await request(http).post(`/api/v1/lessons/${id}/publish`).set(auth(teacherA)).expect(200);
    expect(res.body).toEqual({ code: 0, message: 'ok', data: null });

    const got = await request(http).get(`/api/v1/lessons/${id}`).set(auth(teacherA)).expect(200);
    expect(got.body.data.status).toBe('ready'); // 放宽后发布成功
    // prep_checklist 按实际存在环节标记:无 homework 环节 → homework=false(仅展示,不阻塞)
    expect(got.body.data.prepChecklist).toEqual({
      warmup: true, lecture: true, practice: true, summary: true, homework: false,
    });
  });

  it('验收:补齐 homework(published paper)后 publish → ready,checklist 全绿', async () => {
    const id = lessonId(0);
    await request(http)
      .put(`/api/v1/lessons/${id}/segments`)
      .set(auth(teacherA))
      .send(baseSegments(practicePaperId, { resource: resourceId, homeworkPaper: hwPaperId }))
      .expect(200);

    const res = await request(http).post(`/api/v1/lessons/${id}/publish`).set(auth(teacherA)).expect(200);
    expect(res.body).toEqual({ code: 0, message: 'ok', data: null });

    const got = await request(http).get(`/api/v1/lessons/${id}`).set(auth(teacherA)).expect(200);
    expect(got.body.data.status).toBe('ready');
    expect(got.body.data.prepChecklist).toEqual({
      warmup: true, lecture: true, practice: true, summary: true, homework: true,
    });
  });

  it('publish:practice 挂的 paper 未 published(draft)→ 4201,detail 含 practice', async () => {
    const id = lessonId(1);
    const draftPaper = await raw.paper.create({
      data: { orgId: fx.orgId, creatorId: fx.teacherAId, name: 'A4 草稿卷', type: 'practice', totalScore: 5, status: 'draft' },
    });
    await request(http)
      .put(`/api/v1/lessons/${id}/segments`)
      .set(auth(teacherA))
      .send(baseSegments(Number(draftPaper.id), { homeworkPaper: hwPaperId }))
      .expect(200);
    const res = await request(http).post(`/api/v1/lessons/${id}/publish`).set(auth(teacherA)).expect(409);
    expect(res.body.code).toBe(4201);
    expect(res.body.detail).toEqual(['practice']);
    // 空编排 → 至少 1 个环节,detail=['empty']
    const empty = await request(http).post(`/api/v1/lessons/${lessonId(2)}/publish`).set(auth(teacherA)).expect(409);
    expect(empty.body.detail).toEqual(['empty']);
    // 跨租户 publish → 404
    await request(http).post(`/api/v1/lessons/${id}/publish`).set(auth(seedTeacherAt)).expect(404);
  });

  // ================= 作业发布 =================

  it('assignments:整班发布(target.courseId),scoreCounted=true,契约字段一致', async () => {
    const dueAt = new Date(Date.now() + 7 * 86400_000).toISOString();
    const res = await request(http)
      .post('/api/v1/assignments')
      .set(auth(teacherA))
      .send({ paperId: hwPaperId, lessonId: lessonId(0), kind: 'homework', target: { courseId: Number(fx.courseId) }, dueAt })
      .expect(200);
    hwAssignment = res.body.data;
    exactKeys(hwAssignment, ASSIGNMENT_KEYS);
    expect(hwAssignment.paperId).toBe(hwPaperId);
    expect(hwAssignment.paperName).toBe('A4 · 第1讲课后作业');
    expect(hwAssignment.lessonId).toBe(lessonId(0));
    expect(hwAssignment.kind).toBe('homework');
    expect(hwAssignment.target).toEqual({ courseId: Number(fx.courseId) });
    expect(hwAssignment.dueAt).toBe(dueAt);
    expect(hwAssignment.scoreCounted).toBe(true);
    expect(hwAssignment.questionCount).toBe(2);
    expect(hwAssignment.totalScore).toBe(15);

    // assignments 表数据断言(target 解析的落库形态)
    const row = await raw.assignment.findUniqueOrThrow({ where: { id: BigInt(hwAssignment.id) } });
    expect(row.target).toEqual({ courseId: Number(fx.courseId) });
    expect(row.orgId).toBe(fx.orgId);
  });

  it('验收:已被 assignment 引用的 paper 禁改 → 4302', async () => {
    const res = await request(http)
      .put(`/api/v1/papers/${hwPaperId}`)
      .set(auth(teacherA))
      .send({ name: 'x', type: 'homework', questions: [{ questionId: fx.questionIds[0], score: 5 }] })
      .expect(409);
    expect(res.body.code).toBe(4302);
    // 未被引用的卷仍可改
    await request(http)
      .put(`/api/v1/papers/${practicePaperId}`)
      .set(auth(teacherA))
      .send({ name: 'A4 · 第1讲随堂练v3', type: 'practice', questions: [{ questionId: fx.questionIds[0], score: 5 }, { questionId: fx.questionIds[1], score: 5 }] })
      .expect(200);
  });

  it('assignments:定向发布(studentIds),correction 不计分;target 校验与跨租户', async () => {
    const res = await request(http)
      .post('/api/v1/assignments')
      .set(auth(teacherA))
      .send({ paperId: practicePaperId, kind: 'correction', target: { studentIds: [Number(fx.s1Id)] } })
      .expect(200);
    correctionAssignment = res.body.data;
    expect(correctionAssignment.scoreCounted).toBe(false); // 订正不计分
    expect(correctionAssignment.lessonId).toBeNull();
    expect(correctionAssignment.dueAt).toBeNull();
    expect(correctionAssignment.target).toEqual({ studentIds: [Number(fx.s1Id)] });

    const base = { paperId: practicePaperId, kind: 'homework' };
    await request(http).post('/api/v1/assignments').set(auth(teacherA))
      .send({ ...base, target: {} }).expect(400); // 二者皆缺
    await request(http).post('/api/v1/assignments').set(auth(teacherA))
      .send({ ...base, target: { courseId: Number(fx.courseId), studentIds: [Number(fx.s1Id)] } }).expect(400); // 二者皆给
    await request(http).post('/api/v1/assignments').set(auth(teacherA))
      .send({ ...base, target: { courseId: seedCourseId } }).expect(404); // 他 org 课程
    await request(http).post('/api/v1/assignments').set(auth(teacherA))
      .send({ ...base, target: { studentIds: [Number(fx.teacherAId)] } }).expect(404); // 非学生
    await request(http).post('/api/v1/assignments').set(auth(teacherA))
      .send({ paperId: seedPaperId, kind: 'homework', target: { courseId: Number(fx.courseId) } }).expect(404); // 他 org 试卷
  });

  it('验收:发布后目标学生可见、非目标学生不可见(AssignmentService.listForStudent,A5 复用口径)', async () => {
    const svc = app.get(AssignmentService);
    const listFor = (id: bigint, status?: 'pending' | 'done' | 'all') => {
      const user = { uid: Number(id), orgId: Number(fx.orgId), role: 'student' as const };
      return runAsUser(user, () => svc.listForStudent(user, status ?? 'all'));
    };

    // 整班作业:选课学生 s1/s2 可见,未选课 s3 不可见
    const [s1List, s2List, s3List] = [await listFor(fx.s1Id), await listFor(fx.s2Id), await listFor(fx.s3Id)];
    expect(s1List.some((a) => a.id === hwAssignment.id)).toBe(true);
    expect(s2List.some((a) => a.id === hwAssignment.id)).toBe(true);
    expect(s3List.some((a) => a.id === hwAssignment.id)).toBe(false);

    // 定向作业(studentIds=[s1]):仅 s1 可见
    expect(s1List.some((a) => a.id === correctionAssignment.id)).toBe(true);
    expect(s2List.some((a) => a.id === correctionAssignment.id)).toBe(false);
    expect(s3List.some((a) => a.id === correctionAssignment.id)).toBe(false);

    // DTO 与契约一致
    exactKeys(s1List.find((a) => a.id === hwAssignment.id)!, ASSIGNMENT_KEYS);
  });

  it('progress:totalStudents/submitted/主观题复核进度逐项对账', async () => {
    const url = `/api/v1/assignments/${hwAssignment.id}/progress`;
    const before = await request(http).get(url).set(auth(teacherA)).expect(200);
    exactKeys(before.body.data, PROGRESS_KEYS);
    expect(before.body.data).toEqual({ submitted: 0, totalStudents: 2, gradedSubjective: 0, pendingSubjective: 0 });

    // s1 交卷:q3(solution)拍照作答 + q4 客观题
    const [, , q3, q4] = fx.questionIds;
    const attempt = await raw.attempt.create({
      data: { orgId: fx.orgId, assignmentId: BigInt(hwAssignment.id), studentId: fx.s1Id, status: 'submitted', submittedAt: new Date() },
    });
    const subjAnswer = await raw.answer.create({
      data: { orgId: fx.orgId, attemptId: attempt.id, questionId: BigInt(q3), response: { photoOssKey: 'a4/ans.jpg' } },
    });
    await raw.answer.create({
      data: { orgId: fx.orgId, attemptId: attempt.id, questionId: BigInt(q4), response: { choice: 'A' }, isCorrect: true, score: 5 },
    });

    const mid = await request(http).get(url).set(auth(teacherA)).expect(200);
    expect(mid.body.data).toEqual({ submitted: 1, totalStudents: 2, gradedSubjective: 0, pendingSubjective: 1 });

    // 教师复核写入 final_score → graded
    await raw.gradingRecord.create({
      data: { orgId: fx.orgId, answerId: subjAnswer.id, aiScore: 8, finalScore: 9, reviewerId: fx.teacherAId, reviewedAt: new Date() },
    });
    const after = await request(http).get(url).set(auth(teacherA)).expect(200);
    expect(after.body.data).toEqual({ submitted: 1, totalStudents: 2, gradedSubjective: 1, pendingSubjective: 0 });

    // 交卷后:s1 的 pending 列表不再含该作业,done 列表包含
    const svc = app.get(AssignmentService);
    const user = { uid: Number(fx.s1Id), orgId: Number(fx.orgId), role: 'student' as const };
    const pending = await runAsUser(user, () => svc.listForStudent(user, 'pending'));
    const done = await runAsUser(user, () => svc.listForStudent(user, 'done'));
    expect(pending.some((a) => a.id === hwAssignment.id)).toBe(false);
    expect(done.some((a) => a.id === hwAssignment.id)).toBe(true);

    await request(http).get(url).set(auth(seedTeacherAt)).expect(404); // 跨租户
  });

  // ================= 资源(引用与删除) =================

  it('resources:usedByLessons 反查;被引用禁删 → 4303;解除引用后软删成功(验收项)', async () => {
    // lesson1 的 lecture 环节正引用 resourceId
    const list = await request(http).get('/api/v1/resources?keyword=动画').set(auth(teacherA)).expect(200);
    const mine: ResourceDto = list.body.data.items.find((x: ResourceDto) => x.id === resourceId);
    expect(mine.usedByLessons).toEqual([{ lessonId: lessonId(0), lessonTitle: '第1讲' }]);

    const del = await request(http).delete(`/api/v1/resources/${resourceId}`).set(auth(teacherA)).expect(409);
    expect(del.body.code).toBe(4303);
    expect(del.body.detail).toEqual([{ lessonId: lessonId(0), lessonTitle: '第1讲' }]);

    // 未被引用的资源:改名 → 软删 → 列表不可见
    await request(http).put(`/api/v1/resources/${resource2Id}`).set(auth(teacherA))
      .send({ name: 'A4 微课视频(重命名)', meta: { durationSec: 756 } }).expect(200);
    const renamed = await request(http).get('/api/v1/resources?type=video').set(auth(teacherA)).expect(200);
    const v = renamed.body.data.items.find((x: ResourceDto) => x.id === resource2Id);
    expect(v.name).toBe('A4 微课视频(重命名)');
    expect(v.meta).toEqual({ durationSec: 756 });

    await request(http).delete(`/api/v1/resources/${resource2Id}`).set(auth(teacherA)).expect(200);
    const after = await request(http).get('/api/v1/resources?type=video').set(auth(teacherA)).expect(200);
    expect(after.body.data.items.some((x: ResourceDto) => x.id === resource2Id)).toBe(false);
    const rawRow = await raw.resource.findUniqueOrThrow({ where: { id: BigInt(resource2Id) } });
    expect(rawRow.deletedAt).not.toBeNull(); // 软删

    // 跨租户 PUT/DELETE → 404
    await request(http).put(`/api/v1/resources/${resourceId}`).set(auth(seedTeacherAt)).send({ name: 'x' }).expect(404);
    await request(http).delete(`/api/v1/resources/${resourceId}`).set(auth(seedTeacherAt)).expect(404);
  });

  // ================= 角色门禁 =================

  it('角色门禁:student 访问教师域 → 403;无 token → 401', async () => {
    await request(http).get('/api/v1/papers').set(auth(student)).expect(403);
    await request(http).get('/api/v1/resources').set(auth(student)).expect(403);
    await request(http).post(`/api/v1/lessons/${lessonId(0)}/publish`).set(auth(student)).expect(403);
    await request(http).post('/api/v1/assignments').set(auth(student))
      .send({ paperId: practicePaperId, kind: 'homework', target: { courseId: Number(fx.courseId) } }).expect(403);
    await request(http).get('/api/v1/papers').expect(401);
  });
});
