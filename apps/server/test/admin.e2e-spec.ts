/**
 * 验收覆盖(任务卡 A2 · 管理员域):
 * - 创建课程 → lessons 表自动出现 N 条 seq 连续记录
 * - 学生档案 mastery(mastery_snapshots)与 wrongOpenCount 与 seed 手算一致
 * - dashboard / ai-usage 数字与 seed 对账;重置密码写 audit_logs
 * - 全部接口响应结构与 openapi 逐字段一致(用 @qiming/contracts 类型断言 + 精确键集合)
 * - 宪法 §7:跨租户互查 → 404
 * 夹具纪律:自建数据用 1391 开头手机号,afterAll 全量清理;seed 数据只读对账。
 */
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type {
  AiUsageBreakdownDto,
  AiUsageSummaryDto,
  ApiResp,
  CourseDto,
  MasteryItemDto,
  MeDto,
  PageResp,
  StudentDto,
  TeacherDto,
} from '@qiming/contracts';
import { hashPassword } from '../src/auth/password.util';
import { createApp, raw } from './fixtures/setup';

const SEED_ADMIN = { phone: '13800000001', password: 'Admin@123' };
const SEED_TEACHER = { phone: '13800000002', password: 'Teacher@123' };

// ---- 与 src/admin/helpers.ts 同口径的 UTC 时间窗口(测试侧独立实现,防"自己对自己") ----
const utcDayStart = (d = new Date()) =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
const utcMonthStart = (d = new Date()) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
const periodOf = (d = new Date()) =>
  `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
const dayKey = (d: Date) => d.toISOString().slice(0, 10);
const round2 = (x: number) => Math.round(x * 100) / 100;
const round4 = (x: number) => Math.round(x * 10000) / 10000;

/** openapi 逐字段一致:对象键集合精确相等 */
const exactKeys = (obj: object, keys: string[]) =>
  expect(Object.keys(obj).sort()).toEqual([...keys].sort());

const TEACHER_KEYS = ['id', 'name', 'teacherNo', 'phone', 'stage', 'subject', 'status', 'courseCount', 'questionCount', 'resourceCount'];
const STUDENT_KEYS = ['id', 'name', 'studentNo', 'parentPhone', 'grade', 'status', 'courses', 'device', 'weekStudySec'];
const COURSE_KEYS = ['id', 'name', 'classType', 'subject', 'stage', 'teacherId', 'teacherName', 'totalLessons', 'currentLesson', 'studentCount', 'status', 'nextLessonAt', 'attendanceRate', 'homeworkRate'];
const MASTERY_KEYS = ['nodeId', 'nodeName', 'graphType', 'mastery', 'sampleCount'];
const SUMMARY_KEYS = ['period', 'totalTokens', 'totalCost', 'monthlyLimit', 'usedPercent', 'avgCostPerLesson'];
const BREAKDOWN_KEYS = ['key', 'label', 'tokens', 'cost', 'percent'];
const DASHBOARD_KEYS = ['teacherCount', 'studentCount', 'weekAttendanceRate', 'monthAiCost', 'todayLessonCount', 'recentEvents'];
const ROSTER_KEYS = ['studentId', 'name', 'attendance', 'homeworkAvg', 'status'];
const ME_KEYS = ['id', 'orgId', 'role', 'name', 'orgName', 'orgSettings'];

describe('管理员域(A2)', () => {
  let app: INestApplication;
  let http: any;
  let adminAt: string;
  let teacherAt: string;
  let orgBAdminAt: string;

  let org1Id: bigint;
  let seedT1Id: bigint; // 张明
  let seedCourseId: bigint; // 初二数学提高班
  let seedStudent1Id: bigint; // 林小满(已绑设备)

  let orgBId: bigint;
  let testStart: Date;
  let originalQuota: { id: bigint; monthlyLimit: unknown; alertThreshold: number; overPolicy: string; usedCost: unknown } | null;
  let originalOrgSettings: unknown;

  // 本测试创建的数据(afterAll 清理)
  const myUserIds: bigint[] = [];
  const myCourseIds: bigint[] = [];
  let myTeacherId = 0;
  let myStudentId = 0;
  let myCourseId = 0;

  const login = async (phone: string, password: string) => {
    const res = await request(http).post('/api/v1/auth/login').send({ phone, password }).expect(200);
    return res.body.data.accessToken as string;
  };
  const get = (url: string, at: string) => request(http).get(`/api/v1${url}`).set('Authorization', `Bearer ${at}`);
  const post = (url: string, at: string) => request(http).post(`/api/v1${url}`).set('Authorization', `Bearer ${at}`);
  const put = (url: string, at: string) => request(http).put(`/api/v1${url}`).set('Authorization', `Bearer ${at}`);
  const del = (url: string, at: string) => request(http).delete(`/api/v1${url}`).set('Authorization', `Bearer ${at}`);

  beforeAll(async () => {
    testStart = new Date();
    app = await createApp();
    http = app.getHttpServer();

    const org1 = await raw.org.findFirstOrThrow({ orderBy: { id: 'asc' } });
    org1Id = org1.id;
    originalOrgSettings = org1.settings;
    seedT1Id = (await raw.user.findFirstOrThrow({ where: { orgId: org1Id, teacherNo: 'T-0001' } })).id;
    seedCourseId = (await raw.course.findFirstOrThrow({ where: { orgId: org1Id, name: '初二数学提高班' } })).id;
    seedStudent1Id = (await raw.user.findFirstOrThrow({ where: { orgId: org1Id, studentNo: 'S-0001' } })).id;
    originalQuota = await raw.aiQuota.findFirst({ where: { orgId: org1Id, period: periodOf() } });

    // 第二机构(跨租户用例;1391 手机号)
    const orgB = await raw.org.create({
      data: {
        name: 'A2-e2e第二机构',
        settings: { ai: { qaGuideOnly: true, preGrading: true }, studentHours: { start: '06:00', end: '22:30' }, deviceBinding: true },
      },
    });
    orgBId = orgB.id;
    await raw.user.create({
      data: { orgId: orgBId, role: 'admin', name: 'A2乙管理员', phone: '13910000001', passwordHash: await hashPassword('OrgB@Pass123') },
    });

    adminAt = await login(SEED_ADMIN.phone, SEED_ADMIN.password);
    teacherAt = await login(SEED_TEACHER.phone, SEED_TEACHER.password);
    orgBAdminAt = await login('13910000001', 'OrgB@Pass123');
  });

  afterAll(async () => {
    // 自建数据清理(逆依赖顺序)
    if (myCourseIds.length) {
      await raw.lessonSegment.deleteMany({ where: { lessonId: { in: (await raw.lesson.findMany({ where: { courseId: { in: myCourseIds } }, select: { id: true } })).map((l) => l.id) } } });
      await raw.courseStudent.deleteMany({ where: { courseId: { in: myCourseIds } } });
      await raw.lesson.deleteMany({ where: { courseId: { in: myCourseIds } } });
      await raw.course.deleteMany({ where: { id: { in: myCourseIds } } });
    }
    if (myUserIds.length) {
      await raw.loginTicket.deleteMany({ where: { studentId: { in: myUserIds } } });
      await raw.device.deleteMany({ where: { studentId: { in: myUserIds } } });
      await raw.courseStudent.deleteMany({ where: { studentId: { in: myUserIds } } });
      await raw.user.deleteMany({ where: { id: { in: myUserIds } } });
    }
    // 本轮测试产生的审计日志(seed 的 seed.business 早于 testStart,不受影响)
    await raw.auditLog.deleteMany({ where: { orgId: org1Id, createdAt: { gte: testStart } } });
    // 还原 seed 的额度与机构设置
    if (originalQuota) {
      await raw.aiQuota.update({
        where: { id: originalQuota.id },
        data: {
          monthlyLimit: originalQuota.monthlyLimit as never,
          alertThreshold: originalQuota.alertThreshold,
          overPolicy: originalQuota.overPolicy,
          usedCost: originalQuota.usedCost as never,
        },
      });
    }
    await raw.org.update({ where: { id: org1Id }, data: { settings: originalOrgSettings as never } });
    // 第二机构整体删除
    await raw.auditLog.deleteMany({ where: { orgId: orgBId } });
    await raw.aiQuota.deleteMany({ where: { orgId: orgBId } });
    await raw.user.deleteMany({ where: { orgId: orgBId } });
    await raw.org.deleteMany({ where: { id: orgBId } });
    await raw.$disconnect();
    await app.close();
  });

  // ================= RBAC 与跨租户 =================
  describe('门禁与租户隔离', () => {
    it('teacher 调管理接口 → 403;无 token → 401', async () => {
      await get('/admin/teachers', teacherAt).expect(403);
      await request(http).get('/api/v1/admin/teachers').expect(401);
    });

    it('跨租户互查 → 404;列表彼此不可见', async () => {
      await get(`/admin/students/${seedStudent1Id}/profile`, orgBAdminAt).expect(404);
      await put(`/admin/teachers/${seedT1Id}`, orgBAdminAt)
        .send({ name: '越权', phone: '13910000099', stage: '初中', subject: '数学' })
        .expect(404);
      await get(`/admin/courses/${seedCourseId}/roster`, orgBAdminAt).expect(404);
      const list = await get('/admin/courses', orgBAdminAt).expect(200);
      expect(list.body.data.total).toBe(0);
      expect(list.body.data.items).toEqual([]);
    });
  });

  // ================= 教师 =================
  describe('teachers CRUD + 重置密码', () => {
    it('创建教师:自动工号、结构逐字段一致、计数为 0', async () => {
      const res = await post('/admin/teachers', adminAt)
        .send({ name: 'A2测试教师', phone: '13910000002', stage: '初中', subject: '数学' })
        .expect(200);
      const body = res.body as ApiResp<TeacherDto>;
      expect(body.code).toBe(0);
      exactKeys(body.data, TEACHER_KEYS);
      expect(body.data.teacherNo).toMatch(/^T-\d{4}$/);
      expect(body.data.status).toBe('active');
      expect(body.data.courseCount).toBe(0);
      expect(body.data.questionCount).toBe(0);
      expect(body.data.resourceCount).toBe(0);
      myTeacherId = body.data.id;
      myUserIds.push(BigInt(myTeacherId));
    });

    it('列表与 seed 对账:张明 courseCount=2 questionCount=30 resourceCount=2;total 与库一致', async () => {
      const res = await get('/admin/teachers?keyword=张明', adminAt).expect(200);
      const body = res.body as ApiResp<PageResp<TeacherDto>>;
      expect(body.data.total).toBe(1);
      const t1 = body.data.items[0];
      exactKeys(t1, TEACHER_KEYS);
      expect(t1.id).toBe(Number(seedT1Id));
      expect(t1.teacherNo).toBe('T-0001');
      expect(t1.stage).toBe('初中');
      expect(t1.subject).toBe('数学');
      expect(t1.courseCount).toBe(2);
      expect(t1.questionCount).toBe(30);
      expect(t1.resourceCount).toBe(2);

      const all = await get('/admin/teachers', adminAt).expect(200);
      const expectTotal = await raw.user.count({ where: { orgId: org1Id, role: 'teacher', deletedAt: null } });
      expect(all.body.data.total).toBe(expectTotal);
    });

    it('编辑教师 → OkVoid;重复手机号 → 409', async () => {
      const res = await put(`/admin/teachers/${myTeacherId}`, adminAt)
        .send({ name: 'A2测试教师改', phone: '13910000002', stage: '高中', subject: '物理' })
        .expect(200);
      expect(res.body).toEqual({ code: 0, message: 'ok', data: null });
      const after = await get('/admin/teachers?keyword=A2测试教师改', adminAt).expect(200);
      expect(after.body.data.items[0].stage).toBe('高中');

      await post('/admin/teachers', adminAt)
        .send({ name: '撞号', phone: '13910000002', stage: '初中', subject: '数学' })
        .expect(409);
    });

    it('重置密码 → 写 audit_logs(验收项)且短信仅日志模拟', async () => {
      await post(`/admin/teachers/${myTeacherId}/reset-password`, adminAt).expect(200);
      const log = await raw.auditLog.findFirst({
        where: { orgId: org1Id, action: 'admin.teacher.reset_password', targetId: BigInt(myTeacherId) },
      });
      expect(log).not.toBeNull();
      expect(log!.targetType).toBe('user');
    });

    it('停用(软删)后列表不可见', async () => {
      await del(`/admin/teachers/${myTeacherId}`, adminAt).expect(200);
      const res = await get('/admin/teachers?keyword=A2测试教师改', adminAt).expect(200);
      expect(res.body.data.total).toBe(0);
      const u = await raw.user.findUnique({ where: { id: BigInt(myTeacherId) } });
      expect(u!.deletedAt).not.toBeNull();
      expect(u!.status).toBe('disabled');
      // 已停用 → 再操作 404
      await post(`/admin/teachers/${myTeacherId}/reset-password`, adminAt).expect(404);
    });
  });

  // ================= 学生 =================
  describe('students CRUD + 档案 + 登录码 + 解绑', () => {
    it('创建学生:结构一致、自动学号、入班、自动生成登录码', async () => {
      const res = await post('/admin/students', adminAt)
        .send({ name: 'A2测试学生', parentPhone: '13910000003', grade: '初二', courseIds: [Number(seedCourseId)] })
        .expect(200);
      const body = res.body as ApiResp<StudentDto>;
      exactKeys(body.data, STUDENT_KEYS);
      expect(body.data.studentNo).toMatch(/^S-\d{4}$/);
      expect(body.data.status).toBe('pending');
      expect(body.data.device).toBeNull();
      expect(body.data.weekStudySec).toBe(0);
      expect(body.data.courses).toEqual([
        { id: Number(seedCourseId), name: '初二数学提高班', classType: 'group' },
      ]);
      myStudentId = body.data.id;
      myUserIds.push(BigInt(myStudentId));
      const tickets = await raw.loginTicket.count({ where: { studentId: BigInt(myStudentId) } });
      expect(tickets).toBe(1);
    });

    it('列表过滤:courseId / deviceBound 与库一致', async () => {
      const byCourse = await get(`/admin/students?courseId=${seedCourseId}&size=50`, adminAt).expect(200);
      const enrolled = await raw.courseStudent.count({ where: { courseId: seedCourseId, status: 'active' } });
      expect(byCourse.body.data.total).toBe(enrolled);

      const bound = await get('/admin/students?deviceBound=true&size=50', adminAt).expect(200);
      const boundExpected = await raw.device.count({ where: { orgId: org1Id } });
      expect(bound.body.data.total).toBe(boundExpected);
      for (const s of bound.body.data.items as StudentDto[]) {
        exactKeys(s, STUDENT_KEYS);
        expect(s.device).not.toBeNull();
        exactKeys(s.device!, ['name', 'boundAt']);
      }
    });

    it('学生档案:mastery 与 wrongOpenCount 与 seed 手算一致(验收项)', async () => {
      const res = await get(`/admin/students/${seedStudent1Id}/profile`, adminAt).expect(200);
      const body = res.body as ApiResp<{ student: StudentDto; mastery: MasteryItemDto[]; wrongOpenCount: number }>;
      exactKeys(body.data, ['student', 'mastery', 'wrongOpenCount']);
      exactKeys(body.data.student, STUDENT_KEYS);
      expect(body.data.student.id).toBe(Number(seedStudent1Id));
      expect(body.data.student.device).not.toBeNull();

      // 手算:按 seed 口径(学生×标签节点的客观题正确率)从 answers 重新聚合
      const answers = await raw.answer.findMany({
        where: { isCorrect: { not: null }, attempt: { studentId: seedStudent1Id } },
        select: { isCorrect: true, questionId: true },
      });
      const tags = await raw.questionTag.findMany({
        where: { questionId: { in: answers.map((a) => a.questionId) } },
        select: { questionId: true, nodeId: true },
      });
      const acc = new Map<string, { correct: number; total: number }>();
      for (const a of answers) {
        for (const t of tags.filter((t) => t.questionId === a.questionId)) {
          const cur = acc.get(String(t.nodeId)) ?? { correct: 0, total: 0 };
          cur.total += 1;
          if (a.isCorrect) cur.correct += 1;
          acc.set(String(t.nodeId), cur);
        }
      }
      expect(body.data.mastery.length).toBe(acc.size);
      expect(body.data.mastery.length).toBeGreaterThan(0);
      for (const m of body.data.mastery) {
        exactKeys(m, MASTERY_KEYS);
        const expected = acc.get(String(m.nodeId))!;
        expect(expected).toBeDefined();
        expect(m.sampleCount).toBe(expected.total);
        expect(m.mastery).toBe(Math.round((100 * expected.correct) / expected.total));
        expect(['curriculum_knowledge', 'problem_solving_ability', 'problem_solving_strategy']).toContain(m.graphType);
      }

      const wrongExpected = await raw.wrongBookEntry.count({
        where: { studentId: seedStudent1Id, status: 'open' },
      });
      expect(body.data.wrongOpenCount).toBe(wrongExpected);

      // 教师按契约也可读档案
      await get(`/admin/students/${seedStudent1Id}/profile`, teacherAt).expect(200);
    });

    it('重发登录码:旧票作废、新票生效', async () => {
      const res = await post(`/admin/students/${myStudentId}/login-ticket`, adminAt).expect(200);
      exactKeys(res.body.data, ['token', 'expiresAt']);
      expect(res.body.data.token).toMatch(/^tk_/);
      expect(new Date(res.body.data.expiresAt).getTime()).toBeGreaterThan(Date.now());

      const tickets = await raw.loginTicket.findMany({ where: { studentId: BigInt(myStudentId) }, orderBy: { id: 'asc' } });
      expect(tickets.length).toBe(2);
      expect(tickets[0].usedAt).not.toBeNull(); // 创建时发的那张已被作废
      expect(tickets[1].usedAt).toBeNull();
      expect(tickets[1].token).toBe(res.body.data.token);
    });

    it('解绑设备:未绑定 → 404;绑定后解绑成功', async () => {
      await del(`/admin/students/${myStudentId}/device`, adminAt).expect(404);
      await raw.device.create({
        data: { orgId: org1Id, studentId: BigInt(myStudentId), deviceFingerprint: 'fp-a2-e2e', deviceName: 'A2测试平板' },
      });
      await del(`/admin/students/${myStudentId}/device`, adminAt).expect(200);
      expect(await raw.device.count({ where: { studentId: BigInt(myStudentId) } })).toBe(0);
    });

    it('编辑学生:改年级与退班', async () => {
      await put(`/admin/students/${myStudentId}`, adminAt)
        .send({ name: 'A2测试学生', parentPhone: '13910000003', grade: '初三', courseIds: [] })
        .expect(200);
      const res = await get('/admin/students?keyword=A2测试学生', adminAt).expect(200);
      const s = res.body.data.items[0] as StudentDto;
      expect(s.grade).toBe('初三');
      expect(s.courses).toEqual([]); // 已退班(course_students 置 quit)
      const enrollment = await raw.courseStudent.findFirst({ where: { studentId: BigInt(myStudentId) } });
      expect(enrollment!.status).toBe('quit');
    });
  });

  // ================= 课程 =================
  describe('courses CRUD + 自动讲次 + roster', () => {
    it('创建课程 → lessons 自动生成 N 条 seq 连续记录(验收项)', async () => {
      const res = await post('/admin/courses', adminAt)
        .send({
          name: 'A2测试课程', classType: 'one_on_three', subject: '数学', stage: '初中',
          teacherId: Number(seedT1Id), totalLessons: 8, studentIds: [Number(seedStudent1Id)],
        })
        .expect(200);
      const body = res.body as ApiResp<CourseDto>;
      exactKeys(body.data, COURSE_KEYS);
      expect(body.data.teacherName).toBe('张明');
      expect(body.data.totalLessons).toBe(8);
      expect(body.data.currentLesson).toBe(0);
      expect(body.data.studentCount).toBe(1);
      expect(body.data.status).toBe('draft');
      expect(body.data.nextLessonAt).toBeNull();
      myCourseId = body.data.id;
      myCourseIds.push(BigInt(myCourseId));

      const lessons = await raw.lesson.findMany({ where: { courseId: BigInt(myCourseId) }, orderBy: { seq: 'asc' } });
      expect(lessons.length).toBe(8);
      expect(lessons.map((l) => l.seq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
      for (const l of lessons) {
        expect(l.status).toBe('draft');
        expect(l.scheduledStart).toBeNull();
      }
    });

    it('创建课程引用他租户教师/学生 → 404', async () => {
      const orgBAdmin = await raw.user.findFirstOrThrow({ where: { orgId: orgBId, role: 'admin' } });
      await post('/admin/courses', adminAt)
        .send({ name: '越权课程', classType: 'group', subject: '数学', stage: '初中', teacherId: Number(orgBAdmin.id), totalLessons: 2 })
        .expect(404);
    });

    it('课程列表与 seed 对账:进度/人数/下次上课/作业交付率', async () => {
      const res = await get('/admin/courses?keyword=初二数学提高班', adminAt).expect(200);
      const body = res.body as ApiResp<PageResp<CourseDto>>;
      expect(body.data.total).toBe(1);
      const c = body.data.items[0];
      exactKeys(c, COURSE_KEYS);
      expect(c.classType).toBe('group');
      expect(c.teacherId).toBe(Number(seedT1Id));
      expect(c.teacherName).toBe('张明');
      expect(c.totalLessons).toBe(15);
      expect(c.currentLesson).toBe(3); // seed:前 3 讲 finished
      const enrolled = await raw.courseStudent.count({ where: { courseId: seedCourseId, status: 'active' } });
      expect(c.studentCount).toBe(enrolled);
      const nextLesson = await raw.lesson.findFirst({
        where: { courseId: seedCourseId, scheduledStart: { gt: new Date() } },
        orderBy: { scheduledStart: 'asc' },
      });
      expect(c.nextLessonAt).toBe(nextLesson!.scheduledStart!.toISOString());
      // homework 交付率:12 名学生全部交卷 → submitted/(assignments×students)
      const submitted = await raw.attempt.count({
        where: { assignment: { kind: 'homework', lesson: { courseId: seedCourseId } }, status: { in: ['submitted', 'graded'] } },
      });
      expect(c.homeworkRate).toBe(round2(submitted / (1 * enrolled)));
      expect(c.attendanceRate).toBeNull(); // seed 无课堂会话数据
    });

    it('编辑课程:增/减讲次数;讲次已被使用时禁止缩减', async () => {
      const dto = { name: 'A2测试课程', classType: 'one_on_three', subject: '数学', stage: '初中', teacherId: Number(seedT1Id) };
      await put(`/admin/courses/${myCourseId}`, adminAt).send({ ...dto, totalLessons: 10 }).expect(200);
      let lessons = await raw.lesson.findMany({ where: { courseId: BigInt(myCourseId) }, orderBy: { seq: 'asc' } });
      expect(lessons.map((l) => l.seq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

      await put(`/admin/courses/${myCourseId}`, adminAt).send({ ...dto, totalLessons: 9 }).expect(200);
      lessons = await raw.lesson.findMany({ where: { courseId: BigInt(myCourseId) } });
      expect(lessons.length).toBe(9);

      // seed 课程第 4 讲已编排(ready+segments)→ 缩减到 3 讲必须 409 且不落库
      const seedDto = { name: '初二数学提高班', classType: 'group', subject: '数学', stage: '初中', teacherId: Number(seedT1Id) };
      await put(`/admin/courses/${seedCourseId}`, adminAt).send({ ...seedDto, totalLessons: 3 }).expect(409);
      const seedCourse = await raw.course.findUnique({ where: { id: seedCourseId } });
      expect(seedCourse!.totalLessons).toBe(15);
      expect(await raw.lesson.count({ where: { courseId: seedCourseId } })).toBe(6);
    });

    it('roster:到课/作业概览与 seed 对账;教师可读', async () => {
      const res = await get(`/admin/courses/${seedCourseId}/roster`, adminAt).expect(200);
      const items = res.body.data as { studentId: number; name: string; attendance: string; homeworkAvg: number | null; status: string }[];
      const enrollments = await raw.courseStudent.count({ where: { courseId: seedCourseId } });
      expect(items.length).toBe(enrollments);

      const paper = await raw.paper.findFirstOrThrow({ where: { orgId: org1Id, type: 'homework' } });
      const assignment = await raw.assignment.findFirstOrThrow({ where: { paperId: paper.id } });
      for (const item of items) {
        exactKeys(item, ROSTER_KEYS);
        expect(item.attendance).toBe('0/0'); // seed 无已结束会话
        const attempt = await raw.attempt.findFirst({
          where: { assignmentId: assignment.id, studentId: BigInt(item.studentId), status: 'graded' },
        });
        if (attempt?.score != null) {
          expect(item.homeworkAvg).toBe(round2((Number(attempt.score) / Number(paper.totalScore)) * 100));
        } else {
          expect(item.homeworkAvg).toBeNull();
        }
      }
      await get(`/admin/courses/${seedCourseId}/roster`, teacherAt).expect(200);
    });
  });

  // ================= 总览 / AI 用量 =================
  describe('dashboard 与 ai-usage 对账(验收项)', () => {
    it('dashboard 数字与库一致', async () => {
      const res = await get('/admin/dashboard', adminAt).expect(200);
      const d = res.body.data;
      exactKeys(d, DASHBOARD_KEYS);
      expect(d.teacherCount).toBe(await raw.user.count({ where: { orgId: org1Id, role: 'teacher', deletedAt: null } }));
      expect(d.studentCount).toBe(await raw.user.count({ where: { orgId: org1Id, role: 'student', deletedAt: null } }));
      const cost = await raw.aiCall.aggregate({ where: { orgId: org1Id, createdAt: { gte: utcMonthStart() } }, _sum: { cost: true } });
      expect(d.monthAiCost).toBeCloseTo(Number(cost._sum.cost ?? 0), 4);
      const todayStart = utcDayStart();
      const todayCnt = await raw.lesson.count({
        where: { orgId: org1Id, scheduledStart: { gte: todayStart, lt: new Date(todayStart.getTime() + 86400_000) } },
      });
      expect(d.todayLessonCount).toBe(todayCnt);
      expect(d.weekAttendanceRate).toBeNull(); // seed 无已结束会话
      expect(d.recentEvents.length).toBeGreaterThan(0);
      expect(d.recentEvents.length).toBeLessThanOrEqual(5);
      for (const e of d.recentEvents) exactKeys(e, ['text', 'time']);
    });

    it('ai-usage/summary 与 seed 8 条 ai_calls 对账', async () => {
      const res = await get('/admin/ai-usage/summary', adminAt).expect(200);
      const body = res.body as ApiResp<AiUsageSummaryDto>;
      exactKeys(body.data, SUMMARY_KEYS);
      const agg = await raw.aiCall.aggregate({
        where: { orgId: org1Id, createdAt: { gte: utcMonthStart() } },
        _sum: { tokensIn: true, tokensOut: true, cost: true },
      });
      const totalCost = round4(Number(agg._sum.cost ?? 0));
      expect(body.data.period).toBe(periodOf());
      expect(body.data.totalTokens).toBe((agg._sum.tokensIn ?? 0) + (agg._sum.tokensOut ?? 0));
      expect(body.data.totalTokens).toBe(13480); // seed 手算:Σ(800+137i)+Σ(220+53i), i=0..7
      expect(body.data.totalCost).toBeCloseTo(totalCost, 4);
      expect(body.data.totalCost).toBeCloseTo(0.18, 4); // seed 手算:Σ(0.012+0.003i)
      expect(body.data.monthlyLimit).toBe(3000);
      expect(body.data.usedPercent).toBe(round2((totalCost / 3000) * 100));
      // seed 的 8 条调用都挂在同一讲 → avgCostPerLesson = totalCost / 1
      expect(body.data.avgCostPerLesson).toBeCloseTo(totalCost, 4);
    });

    it('ai-usage/daily 零填充且与库逐日一致', async () => {
      const days = 3;
      const res = await get(`/admin/ai-usage/daily?days=${days}`, adminAt).expect(200);
      const items = res.body.data as { date: string; tokens: number; cost: number }[];
      expect(items.length).toBe(days);
      const since = new Date(utcDayStart().getTime() - (days - 1) * 86400_000);
      const calls = await raw.aiCall.findMany({
        where: { orgId: org1Id, createdAt: { gte: since } },
        select: { createdAt: true, tokensIn: true, tokensOut: true, cost: true },
      });
      for (let i = 0; i < days; i++) {
        const date = dayKey(new Date(since.getTime() + i * 86400_000));
        exactKeys(items[i], ['date', 'tokens', 'cost']);
        expect(items[i].date).toBe(date);
        const dayCalls = calls.filter((c) => dayKey(c.createdAt) === date);
        expect(items[i].tokens).toBe(dayCalls.reduce((s, c) => s + c.tokensIn + c.tokensOut, 0));
        expect(items[i].cost).toBeCloseTo(dayCalls.reduce((s, c) => s + Number(c.cost), 0), 4);
      }
      // 防日期翻页 flaky:按 seed ai_calls 的"实际发生日"断言对应桶非零(seed 日不一定是测试执行日)
      const seedCall = await raw.aiCall.findFirst({ where: { orgId: org1Id }, orderBy: { createdAt: 'asc' } });
      const seedDay = dayKey(seedCall!.createdAt);
      const seedBucket = items.find((it) => it.date === seedDay);
      if (seedBucket) expect(seedBucket.tokens).toBeGreaterThan(0); // 窗口外则零填充已由上方循环对账
      await get('/admin/ai-usage/daily?days=40', adminAt).expect(400); // 契约 max 31
    });

    it('ai-usage/breakdown 按功能与库一致、占比合计≈100', async () => {
      const res = await get('/admin/ai-usage/breakdown', adminAt).expect(200);
      const body = res.body as ApiResp<AiUsageBreakdownDto[]>;
      const grouped = await raw.aiCall.groupBy({
        by: ['feature'],
        where: { orgId: org1Id, createdAt: { gte: utcMonthStart() } },
        _sum: { tokensIn: true, tokensOut: true, cost: true },
      });
      expect(body.data.length).toBe(grouped.length);
      expect(new Set(body.data.map((b) => b.key))).toEqual(new Set(['qa', 'pre_grading', 'diagnosis'])); // seed 取模分布
      for (const item of body.data) {
        exactKeys(item, BREAKDOWN_KEYS);
        const g = grouped.find((x) => x.feature === item.key)!;
        expect(item.tokens).toBe((g._sum.tokensIn ?? 0) + (g._sum.tokensOut ?? 0));
        expect(item.cost).toBeCloseTo(Number(g._sum.cost ?? 0), 4);
      }
      const percentSum = body.data.reduce((s, b) => s + b.percent, 0);
      expect(Math.abs(percentSum - 100)).toBeLessThan(0.5);
    });
  });

  // ================= 额度 / 设置 / 审计 =================
  describe('ai-quota / settings / audit-logs', () => {
    it('额度读写:seed 值 → 修改 → 读到新值;越界 400', async () => {
      const before = await get('/admin/ai-quota', adminAt).expect(200);
      exactKeys(before.body.data, ['monthlyLimit', 'alertThreshold', 'overPolicy']);
      expect(before.body.data).toEqual({ monthlyLimit: 3000, alertThreshold: 80, overPolicy: 'disable_qa' });

      await put('/admin/ai-quota', adminAt)
        .send({ monthlyLimit: 5000, alertThreshold: 85, overPolicy: 'record_only' })
        .expect(200);
      const after = await get('/admin/ai-quota', adminAt).expect(200);
      expect(after.body.data).toEqual({ monthlyLimit: 5000, alertThreshold: 85, overPolicy: 'record_only' });

      await put('/admin/ai-quota', adminAt)
        .send({ monthlyLimit: 5000, alertThreshold: 40, overPolicy: 'record_only' })
        .expect(400); // 契约 alertThreshold ∈ [50,95]
    });

    it('设置读写:GET 返回 Me;PUT 仅改引导模式与使用时段', async () => {
      const before = await get('/admin/settings', adminAt).expect(200);
      const me = (before.body as ApiResp<MeDto>).data;
      exactKeys(me, ME_KEYS);
      exactKeys(me.orgSettings, ['ai', 'studentHours', 'deviceBinding']);
      expect(me.role).toBe('admin');

      await put('/admin/settings', adminAt)
        .send({ qaGuideOnly: false, studentHours: { start: '07:00', end: '21:00' } })
        .expect(200);
      const after = await get('/admin/settings', adminAt).expect(200);
      const s = (after.body as ApiResp<MeDto>).data.orgSettings;
      expect(s.ai.qaGuideOnly).toBe(false);
      expect(s.ai.preGrading).toBe(true); // 未触碰的开关保持
      expect(s.studentHours).toEqual({ start: '07:00', end: '21:00' });
      expect(s.deviceBinding).toBe(true);
    });

    it('审计日志:分页倒序、字段一致、能看到本轮管理动作', async () => {
      const res = await get('/admin/audit-logs?page=1&size=5', adminAt).expect(200);
      const { items, total } = res.body.data as { items: { actorName: string; action: string; targetType: string | null; createdAt: string }[]; total: number };
      expect(items.length).toBeLessThanOrEqual(5);
      expect(total).toBe(await raw.auditLog.count({ where: { orgId: org1Id } }));
      for (const it of items) exactKeys(it, ['actorName', 'action', 'targetType', 'createdAt']);
      // 倒序:第一页应包含最近的 admin.* 动作,且 actorName 解析为王校长
      const adminActions = items.filter((i) => i.action.startsWith('admin.'));
      expect(adminActions.length).toBeGreaterThan(0);
      expect(adminActions[0].actorName).toBe('王校长');
      const ts = items.map((i) => new Date(i.createdAt).getTime());
      expect([...ts].sort((a, b) => b - a)).toEqual(ts);
    });
  });
});
