/**
 * D4 压测 · 准备阶段(可重复执行,幂等):
 * 1. 管理员登录 → 找演示课程 → 确保 N 个压测学生(学号 LT-XXXX)存在且在册;
 * 2. 逐个 reset-password 拿明文(演示 seed 学生无初始密码,该接口是官方取明文通道);
 * 3. 教师登录 → 取 4 道已发布单选题 → 建压测卷(practice)→ 发 consolidation 作业
 *    (consolidation 允许重复作答,压测循环不受"作业已完成"一次性限制);
 * 4. (--ws)发布"ready"讲次以确保 class_session 存在,取 sessionId。
 * 仅使用真实业务 API,不直连数据库。
 */
import { ApiClient } from './api';
import { Recorder } from './metrics';

export interface StudentCred {
  id: number;
  studentNo: string;
  password: string;
}

export interface SetupResult {
  courseId: number;
  assignmentId: number;
  questionIds: number[];
  students: StudentCred[];
  sessionId: number | null;
  teacherCred: { phone: string; password: string };
}

export interface SetupOptions {
  baseUrl: string;
  vus: number;
  ws: boolean;
  adminPhone: string;
  adminPassword: string;
  teacherPhone: string;
  teacherPassword: string;
}

const NO_PREFIX = 'LT-';
const no = (i: number) => `${NO_PREFIX}${String(i + 1).padStart(4, '0')}`;

export async function setup(opts: SetupOptions, rec: Recorder): Promise<SetupResult> {
  const admin = new ApiClient(opts.baseUrl, rec, 'setup: ');

  // ---- 管理员登录 ----
  const adminLogin = await admin.must<{ accessToken: string }>('POST', '/api/v1/auth/login', {
    phone: opts.adminPhone,
    password: opts.adminPassword,
  });
  admin.token = adminLogin.accessToken;

  // ---- 课程:取第一个班课(seed:初二数学提高班) ----
  const courses = await admin.must<{ items: any[] }>('GET', '/api/v1/admin/courses?size=50');
  const course = courses.items.find((c) => c.classType === 'group') ?? courses.items[0];
  if (!course) throw new Error('未找到课程,请先跑 db:seed:business');
  const courseId: number = course.id;

  // ---- 压测学生:按学号 LT- 前缀查已有,缺多少补多少 ----
  const existing = new Map<string, any>();
  for (let page = 1; ; page++) {
    const r = await admin.must<{ items: any[]; total: number }>(
      'GET',
      `/api/v1/admin/students?keyword=${NO_PREFIX}&size=50&page=${page}`,
    );
    for (const s of r.items) existing.set(s.studentNo, s);
    if (page * 50 >= r.total) break;
  }

  const students: StudentCred[] = [];
  for (let i = 0; i < opts.vus; i++) {
    const studentNo = no(i);
    let s = existing.get(studentNo);
    if (!s) {
      s = await admin.must('POST', '/api/v1/admin/students', {
        name: `压测学生${String(i + 1).padStart(2, '0')}`,
        parentPhone: `1391${String(700000 + i)}`,
        studentNo,
        grade: '初二',
        courseIds: [courseId],
      });
    } else if (!(s.courses ?? []).some((c: any) => c.id === courseId)) {
      // 已存在但不在册(半途中断的上次 setup)→ 补选课
      await admin.must('POST', `/api/v1/admin/courses/${courseId}/students`, { studentIds: [s.id] });
    }
    if (s.status !== 'active') await admin.must('POST', `/api/v1/admin/students/${s.id}/enable`);
    // 官方取明文通道:重置密码并取回(学生登录用)
    const { password } = await admin.must<{ password: string }>(
      'POST',
      `/api/v1/admin/students/${s.id}/reset-password`,
    );
    students.push({ id: s.id, studentNo, password });
  }

  // ---- 教师:建卷 + 发作业 ----
  const teacher = new ApiClient(opts.baseUrl, rec, 'setup: ');
  const tLogin = await teacher.must<{ accessToken: string }>('POST', '/api/v1/auth/login', {
    phone: opts.teacherPhone,
    password: opts.teacherPassword,
  });
  teacher.token = tLogin.accessToken;

  const qs = await teacher.must<{ items: any[] }>(
    'GET',
    '/api/v1/questions?type=single&status=published&size=10',
  );
  const questionIds: number[] = qs.items.slice(0, 4).map((q) => q.id);
  if (questionIds.length < 4) throw new Error('已发布单选题不足 4 道,请先跑 db:seed:business');

  const paper = await teacher.must<{ id: number }>('POST', '/api/v1/papers', {
    name: `D4 压测卷 ${new Date().toISOString().slice(0, 16)}`,
    type: 'practice',
    questions: questionIds.map((questionId) => ({ questionId, score: 5 })),
  });

  const assignment = await teacher.must<{ id: number }>('POST', '/api/v1/assignments', {
    paperId: paper.id,
    kind: 'consolidation', // 允许重复作答;homework 一次性会让压测循环第二圈就 4502
    target: { courseId },
    dueAt: new Date(Date.now() + 24 * 3600e3).toISOString(),
  });

  // ---- (可选)课堂 WS:确保 ready 讲次有未结束 class_session ----
  let sessionId: number | null = null;
  if (opts.ws) {
    const listLessons = () => teacher.must<any[]>('GET', `/api/v1/courses/${courseId}/lessons`);
    let lessons = await listLessons();
    let lesson = lessons.find((l) => l.sessionId != null && l.status !== 'draft');
    if (!lesson) {
      const publishable = lessons.find((l) => l.status === 'ready') ?? lessons.find((l) => l.status === 'draft');
      if (publishable) {
        // publish 幂等确保 class_session 存在(讲次已 ready 也允许重发)
        await teacher.must('POST', `/api/v1/lessons/${publishable.id}/publish`);
        lessons = await listLessons();
        lesson = lessons.find((l) => l.sessionId != null);
      }
    }
    sessionId = lesson?.sessionId ?? null;
    if (sessionId == null) console.warn('⚠ 未取得 sessionId,跳过课堂 WS 场景');
  }

  return {
    courseId,
    assignmentId: assignment.id,
    questionIds,
    students,
    sessionId,
    teacherCred: { phone: opts.teacherPhone, password: opts.teacherPassword },
  };
}
