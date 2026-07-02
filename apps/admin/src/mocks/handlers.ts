/**
 * msw handlers · 按 packages/contracts/openapi.yaml 全量覆盖(三端共用同一份)
 * 统一响应包 {code,message,data};未带合法 Bearer → 401 {code:4011}
 */
import { http, HttpResponse, type HttpResponseResolver } from 'msw';
import type { MeDto } from '@qiming/contracts';
import * as D from './data';

// 通配任意 origin:浏览器 Service Worker 与 node(冒烟脚本)都能匹配
const BASE = '*/api/v1';

// token ↔ 用户(登录/兑换时签发)
const sessions = new Map<string, MeDto>([
  ['mock-token-admin', D.ME_ADMIN],
  ['mock-token-teacher', D.ME_TEACHER],
  ['mock-token-student', D.ME_STUDENT],
]);

const ok = (data: unknown) => HttpResponse.json({ code: 0, message: 'ok', data });
const okVoid = () => HttpResponse.json({ code: 0, message: 'ok', data: null });
const err = (status: number, code: number, message: string) =>
  HttpResponse.json({ code, message }, { status });

function currentUser(req: Request): MeDto | null {
  const auth = req.headers.get('Authorization') ?? '';
  const token = auth.replace(/^Bearer\s+/i, '');
  return sessions.get(token) ?? null;
}

/** 鉴权包装:无合法 token → 401(AuthProvider 据此跳登录) */
const authed = (resolver: HttpResponseResolver): HttpResponseResolver => (info) => {
  if (!currentUser(info.request)) return err(401, 4011, '未登录或登录已过期');
  return resolver(info);
};

function paginate<T>(items: T[], url: URL) {
  const page = Number(url.searchParams.get('page') ?? 1);
  const size = Number(url.searchParams.get('size') ?? 20);
  return { items: items.slice((page - 1) * size, page * size), total: items.length };
}

/** 课程名单行(从有状态 courseMembers 派生,入班/移出即时反映) */
function rosterRows(courseId: number) {
  const ids = D.courseMembers[courseId] ?? [];
  return ids
    .map((sid) => D.students.find((s) => s.id === sid))
    .filter((s): s is NonNullable<typeof s> => !!s)
    .map((s) => ({ studentId: s.id, name: s.name, attendance: '3/3', homeworkAvg: 70 + (s.id % 25), status: s.status }));
}

/** 明文临时密码(满足复杂度;mock 随机生成,管理员当面告知本人) */
const genTempPassword = () => `Qm${Math.random().toString(36).slice(2, 6)}@${Math.floor(1000 + Math.random() * 9000)}`;

const tokenFor = (me: MeDto) => `mock-token-${me.role}${me.role === 'student' && me.id !== D.ME_STUDENT.id ? `-${me.id}` : ''}`;

export const handlers = [
  // ================= 认证 =================
  http.post(`${BASE}/auth/login`, async ({ request }) => {
    const body = (await request.json()) as { phone: string; password: string };
    const acc = D.ACCOUNTS.find((a) => a.phone === body.phone && a.password === body.password);
    if (!acc) return err(401, 4010, '手机号或密码不正确');
    const accessToken = tokenFor(acc.me);
    sessions.set(accessToken, acc.me);
    return ok({ accessToken, refreshToken: `mock-refresh-${acc.me.role}`, me: acc.me });
  }),
  http.post(`${BASE}/auth/student/login`, async ({ request }) => {
    const body = (await request.json()) as { studentNo: string; password: string };
    const me = D.STUDENT_LOGINS[body.studentNo?.trim()];
    if (!me || body.password !== D.STUDENT_PASSWORD) return err(401, 4010, '学号或密码不正确');
    const accessToken = tokenFor(me);
    sessions.set(accessToken, me);
    return ok({ accessToken, refreshToken: 'mock-refresh-student', me });
  }),
  http.post(`${BASE}/auth/refresh`, async ({ request }) => {
    const body = (await request.json()) as { refreshToken: string };
    const role = body.refreshToken?.replace('mock-refresh-', '');
    const me = role === 'admin' ? D.ME_ADMIN : role === 'teacher' ? D.ME_TEACHER : role?.startsWith('student') ? D.ME_STUDENT : null;
    if (!me) return err(401, 4013, '刷新令牌无效');
    return ok({ accessToken: tokenFor(me), refreshToken: body.refreshToken });
  }),
  http.post(`${BASE}/auth/logout`, authed(() => okVoid())),
  http.get(`${BASE}/me`, (info) => {
    const me = currentUser(info.request);
    return me ? ok(me) : err(401, 4011, '未登录或登录已过期');
  }),
  http.put(`${BASE}/me/password`, authed(() => okVoid())),

  // ================= 管理员 =================
  http.get(`${BASE}/admin/teachers`, authed(({ request }) => {
    const url = new URL(request.url);
    const kw = url.searchParams.get('keyword') ?? '';
    const status = url.searchParams.get('status');
    let list = D.teachers.filter((t) => !kw || t.name.includes(kw) || t.phone.includes(kw) || t.teacherNo.includes(kw));
    if (status) list = list.filter((t) => t.status === status);
    return ok(paginate(list, url));
  })),
  http.post(`${BASE}/admin/teachers`, authed(async ({ request }) => {
    const body = (await request.json()) as { name: string; phone: string; stage: string; subject: string; teacherNo?: string };
    const id = Math.max(0, ...D.teachers.map((t) => t.id)) + 1;
    const created = {
      id, name: body.name, teacherNo: body.teacherNo ?? `T-${String(D.teachers.length + 1).padStart(4, '0')}`, phone: body.phone,
      stage: body.stage, subject: body.subject, status: 'pending' as const, courseCount: 0, questionCount: 0, resourceCount: 0,
    };
    D.teachers.push(created); // 有状态 mock:刷新列表可见
    return ok(created);
  })),
  http.put(`${BASE}/admin/teachers/:id`, authed(async ({ request, params }) => {
    const body = (await request.json()) as { name: string; phone: string; stage: string; subject: string; teacherNo?: string };
    const t = D.teachers.find((x) => x.id === Number(params.id));
    if (!t) return err(404, 4040, '教师不存在');
    Object.assign(t, { name: body.name, phone: body.phone, stage: body.stage, subject: body.subject, ...(body.teacherNo ? { teacherNo: body.teacherNo } : {}) });
    return okVoid();
  })),
  http.delete(`${BASE}/admin/teachers/:id`, authed(({ params }) => {
    const t = D.teachers.find((x) => x.id === Number(params.id));
    if (t) t.status = 'disabled'; // 停用(后端已改:不再软删,仍可在「已停用」筛选看到)
    return okVoid();
  })),
  http.post(`${BASE}/admin/teachers/:id/reset-password`, authed(({ params }) => {
    // 重置 → 返回明文临时密码(管理员当面告知教师);取代旧的短信发码
    const t = D.teachers.find((x) => x.id === Number(params.id));
    if (!t) return err(404, 4040, '教师不存在');
    return ok({ password: genTempPassword() });
  })),
  http.post(`${BASE}/admin/teachers/:id/enable`, authed(({ params }) => {
    const t = D.teachers.find((x) => x.id === Number(params.id));
    if (!t) return err(404, 4040, '教师不存在');
    t.status = 'active'; // 有状态 mock:恢复启用后列表刷新可见
    return okVoid();
  })),

  http.get(`${BASE}/admin/students`, authed(({ request }) => {
    const url = new URL(request.url);
    const kw = url.searchParams.get('keyword') ?? '';
    const status = url.searchParams.get('status');
    const courseId = url.searchParams.get('courseId');
    const deviceBound = url.searchParams.get('deviceBound');
    let list = D.students.filter((s) => !kw || s.name.includes(kw) || s.studentNo.includes(kw));
    if (status) list = list.filter((s) => s.status === status);
    if (courseId) list = list.filter((s) => s.courses.some((c) => c.id === Number(courseId)));
    if (deviceBound !== null && deviceBound !== undefined && deviceBound !== '')
      list = list.filter((s) => (deviceBound === 'true' ? !!s.device : !s.device));
    return ok(paginate(list, url));
  })),
  http.post(`${BASE}/admin/students`, authed(async ({ request }) => {
    const body = (await request.json()) as { name: string; parentPhone: string; grade: string; studentNo?: string; courseIds?: number[] };
    const id = Math.max(0, ...D.students.map((s) => s.id)) + 1;
    const created = {
      id, name: body.name, studentNo: body.studentNo ?? `S-${String(D.students.length + 1).padStart(4, '0')}`,
      parentPhone: body.parentPhone, grade: body.grade, status: 'pending' as const,
      courses: (body.courseIds ?? [])
        .map((cid) => D.courses.find((c) => c.id === cid))
        .filter((c): c is NonNullable<typeof c> => !!c)
        .map((c) => ({ id: c.id, name: c.name, classType: c.classType })),
      device: null, weekStudySec: 0,
    };
    D.students.push(created); // 有状态 mock:刷新列表可见
    return ok(created);
  })),
  http.put(`${BASE}/admin/students/:id`, authed(() => okVoid())),
  http.delete(`${BASE}/admin/students/:id`, authed(({ params }) => {
    const s = D.students.find((x) => x.id === Number(params.id));
    if (s) s.status = 'disabled'; // 停用(与教师同口径:不软删,仍可在「已停用」筛选看到)
    return okVoid();
  })),
  http.get(`${BASE}/admin/students/:id/profile`, authed(({ params }) => {
    const s = D.students.find((x) => x.id === Number(params.id));
    if (!s) return err(404, 4040, '学生不存在');
    return ok({ student: s, mastery: D.mastery, wrongOpenCount: D.wrongBook.length });
  })),
  http.post(`${BASE}/admin/students/:id/reset-password`, authed(({ params }) => {
    // 重置 → 返回明文临时密码(管理员当面告知学生);mock 随机生成,满足复杂度
    const s = D.students.find((x) => x.id === Number(params.id));
    if (!s) return err(404, 4040, '学生不存在');
    return ok({ password: genTempPassword() });
  })),
  http.post(`${BASE}/admin/students/:id/enable`, authed(({ params }) => {
    const s = D.students.find((x) => x.id === Number(params.id));
    if (!s) return err(404, 4040, '学生不存在');
    s.status = 'active'; // 有状态 mock:恢复启用后列表刷新可见
    return okVoid();
  })),
  http.delete(`${BASE}/admin/students/:id/device`, authed(({ params }) => {
    const s = D.students.find((x) => x.id === Number(params.id));
    if (s) s.device = null; // 有状态 mock:档案/列表刷新可见
    return okVoid();
  })),

  http.get(`${BASE}/admin/courses`, authed(({ request }) => {
    const url = new URL(request.url);
    const kw = url.searchParams.get('keyword') ?? '';
    const classType = url.searchParams.get('classType');
    let list = D.courses.filter((c) => !kw || c.name.includes(kw));
    if (classType) list = list.filter((c) => c.classType === classType);
    return ok(paginate(list, url));
  })),
  http.post(`${BASE}/admin/courses`, authed(async ({ request }) => {
    const body = (await request.json()) as {
      name: string; classType: 'group' | 'one_on_one' | 'one_on_three'; subject: string; stage: string;
      teacherId: number; totalLessons: number; studentIds?: number[];
    };
    const teacher = D.teachers.find((t) => t.id === body.teacherId);
    if (!teacher) return err(404, 4040, '教师不存在');
    const created = {
      id: Math.max(0, ...D.courses.map((c) => c.id)) + 1,
      name: body.name, classType: body.classType, subject: body.subject, stage: body.stage,
      teacherId: teacher.id, teacherName: teacher.name,
      totalLessons: body.totalLessons, currentLesson: 0, studentCount: body.studentIds?.length ?? 0,
      status: 'draft' as const, nextLessonAt: null, attendanceRate: null, homeworkRate: null,
    };
    D.courses.push(created); // 有状态 mock:刷新列表可见
    return ok(created);
  })),
  http.put(`${BASE}/admin/courses/:id`, authed(() => okVoid())),
  http.get(`${BASE}/admin/courses/:id/roster`, authed(({ params }) =>
    ok(rosterRows(Number(params.id))))),
  // 入班:批量添加学生(有状态;同步学生 courses 与 course.studentCount)
  http.post(`${BASE}/admin/courses/:id/students`, authed(async ({ params, request }) => {
    const cid = Number(params.id);
    const course = D.courses.find((c) => c.id === cid);
    if (!course) return err(404, 4040, '课程不存在');
    const body = (await request.json()) as { studentIds: number[] };
    const members = (D.courseMembers[cid] ??= []);
    for (const sid of body.studentIds ?? []) {
      const s = D.students.find((x) => x.id === sid);
      if (!s || members.includes(sid)) continue;
      members.push(sid);
      if (!s.courses.some((c) => c.id === cid)) s.courses.push({ id: course.id, name: course.name, classType: course.classType });
    }
    course.studentCount = members.length;
    return okVoid();
  })),
  // 移出:从课程移除单个学生
  http.delete(`${BASE}/admin/courses/:id/students/:studentId`, authed(({ params }) => {
    const cid = Number(params.id);
    const sid = Number(params.studentId);
    const course = D.courses.find((c) => c.id === cid);
    if (!course) return err(404, 4040, '课程不存在');
    const members = (D.courseMembers[cid] ??= []);
    const at = members.indexOf(sid);
    if (at >= 0) members.splice(at, 1);
    const s = D.students.find((x) => x.id === sid);
    if (s) s.courses = s.courses.filter((c) => c.id !== cid);
    course.studentCount = members.length;
    return okVoid();
  })),
  http.get(`${BASE}/admin/dashboard`, authed(() =>
    ok({
      ...D.adminDashboard,
      teacherCount: D.teachers.filter((t) => t.status === 'active').length,
      studentCount: D.students.length,
    }))),
  http.get(`${BASE}/admin/ai-usage/summary`, authed(() => ok(D.aiUsageSummary))),
  http.get(`${BASE}/admin/ai-usage/daily`, authed(({ request }) => {
    const days = Number(new URL(request.url).searchParams.get('days') ?? 14);
    return ok(D.aiUsageDaily.slice(-days));
  })),
  http.get(`${BASE}/admin/ai-usage/breakdown`, authed(() => ok(D.aiUsageBreakdown))),
  http.get(`${BASE}/admin/ai-quota`, authed(() => ok(D.aiQuota))),
  http.put(`${BASE}/admin/ai-quota`, authed(async ({ request }) => {
    const body = (await request.json()) as { monthlyLimit: number; alertThreshold: number; overPolicy: string };
    Object.assign(D.aiQuota, body); // 有状态 mock:重新读取可见
    D.aiUsageSummary.monthlyLimit = body.monthlyLimit;
    D.aiUsageSummary.usedPercent = Math.round((D.aiUsageSummary.totalCost / body.monthlyLimit) * 100);
    return okVoid();
  })),
  // ---- AI 接口管理(运行态 LLM 供应商 + 真假路由 + 测试连接)----
  http.get(`${BASE}/admin/ai/config`, authed(() => ok(D.aiProviderConfig))),
  http.put(`${BASE}/admin/ai/config`, authed(async ({ request }) => {
    const body = (await request.json()) as { baseUrl: string; model: string; apiKey?: string; concurrency: number };
    D.aiProviderConfig.baseUrl = body.baseUrl;
    D.aiProviderConfig.model = body.model;
    D.aiProviderConfig.concurrency = body.concurrency;
    D.aiProviderConfig.source = 'runtime'; // 写入即转运行态
    if (body.apiKey) { // 留空=不改;给了才换脱敏串
      const k = body.apiKey;
      D.aiProviderConfig.apiKeyMasked = `sk-****${k.slice(-5)}`;
    }
    return okVoid();
  })),
  http.get(`${BASE}/admin/ai/routes`, authed(() => ok(D.aiFeatureRoutes))),
  http.put(`${BASE}/admin/ai/routes`, authed(async ({ request }) => {
    const body = (await request.json()) as typeof D.aiFeatureRoutes;
    Object.assign(D.aiFeatureRoutes, body); // 有状态:重新读取可见
    return okVoid();
  })),
  http.post(`${BASE}/admin/ai/test`, authed(() => ok({ ok: true, latencyMs: 300, sample: 'ok', error: null }))),

  http.get(`${BASE}/admin/settings`, authed((info) => ok(currentUser(info.request)))),
  http.put(`${BASE}/admin/settings`, authed(async ({ request }) => {
    const body = (await request.json()) as { qaGuideOnly?: boolean; studentHours?: { start: string; end: string } };
    if (body.qaGuideOnly !== undefined) D.orgSettings.ai.qaGuideOnly = body.qaGuideOnly;
    if (body.studentHours) D.orgSettings.studentHours = { ...body.studentHours };
    return okVoid();
  })),
  http.get(`${BASE}/admin/audit-logs`, authed(({ request }) => ok(paginate(D.auditLogs, new URL(request.url))))),

  // ================= 知识图谱 =================
  http.get(`${BASE}/kp/graphs`, authed(() => ok(D.kpGraphs))),
  http.get(`${BASE}/kp/nodes`, authed(({ request }) => {
    const url = new URL(request.url);
    const graphId = Number(url.searchParams.get('graphId'));
    const kw = url.searchParams.get('keyword') ?? '';
    return ok(D.kpNodes.filter((n) => n.graphId === graphId && (!kw || n.name.includes(kw))));
  })),

  // ================= 题库 =================
  http.get(`${BASE}/questions`, authed(({ request }) => {
    const url = new URL(request.url);
    const kw = url.searchParams.get('keyword') ?? '';
    const type = url.searchParams.get('type');
    const status = url.searchParams.get('status');
    const difficulty = url.searchParams.get('difficulty');
    let list = D.questions.filter((q) => !kw || q.stemLatex.includes(kw));
    if (type) list = list.filter((q) => q.type === type);
    if (status) list = list.filter((q) => q.status === status);
    if (difficulty) list = list.filter((q) => q.difficulty === Number(difficulty));
    return ok(paginate(list, url));
  })),
  http.post(`${BASE}/questions`, authed(async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    return ok({ ...D.questions[0], id: 400, ...body, status: 'draft', stats: { correctRate: null, usedInPapers: 0 } });
  })),
  http.get(`${BASE}/questions/:id`, authed(({ params }) => {
    const q = D.questions.find((x) => x.id === Number(params.id));
    return q ? ok(q) : err(404, 4040, '题目不存在');
  })),
  http.put(`${BASE}/questions/:id`, authed(() => okVoid())),
  http.delete(`${BASE}/questions/:id`, authed(() => okVoid())),
  http.post(`${BASE}/questions/:id/publish`, authed(() => okVoid())),
  http.post(`${BASE}/uploads/sts`, authed(async ({ request }) => {
    const body = (await request.json()) as { purpose: string; fileName: string };
    return ok({
      uploadUrl: `https://oss.example.com/upload/${body.purpose}/${encodeURIComponent(body.fileName)}?sig=mock`,
      ossKey: `${body.purpose}/2026/06/${body.fileName}`,
      expiresAt: '2026-06-11T23:59:59.000Z',
    });
  })),

  // ================= 资源库 =================
  http.get(`${BASE}/resources`, authed(({ request }) => {
    const url = new URL(request.url);
    const type = url.searchParams.get('type');
    let list = D.resources;
    if (type) list = list.filter((r) => r.type === type);
    return ok(paginate(list, url));
  })),
  http.post(`${BASE}/resources`, authed(async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    return ok({ ...D.resources[0], id: 500, ...body, usedByLessons: [], createdAt: new Date().toISOString() });
  })),
  http.put(`${BASE}/resources/:id`, authed(() => okVoid())),
  http.delete(`${BASE}/resources/:id`, authed(() => okVoid())),

  // ============ 教师 · 课程/讲次/编排/组卷/发布 ============
  http.get(`${BASE}/teacher/courses`, authed(() => ok(D.courses))),
  http.get(`${BASE}/courses/:id/lessons`, authed(({ params }) =>
    Number(params.id) === 1 ? ok(D.lessons) : ok([]))),
  http.get(`${BASE}/lessons/:id`, authed(({ params }) => {
    const l = D.lessons.find((x) => x.id === Number(params.id));
    return l ? ok(l) : err(404, 4040, '讲次不存在');
  })),
  http.put(`${BASE}/lessons/:id`, authed(() => okVoid())),
  http.get(`${BASE}/lessons/:id/segments`, authed(({ params }) => ok(D.segments[Number(params.id)] ?? []))),
  http.put(`${BASE}/lessons/:id/segments`, authed(() => okVoid())),
  http.post(`${BASE}/lessons/:id/publish`, authed(({ params }) =>
    Number(params.id) === 4
      ? HttpResponse.json({ code: 4201, message: '备课检查未通过', detail: { missing: ['homework'] } }, { status: 422 })
      : okVoid())),
  http.get(`${BASE}/papers`, authed(({ request }) => {
    const url = new URL(request.url);
    const type = url.searchParams.get('type');
    let list = D.papers;
    if (type) list = list.filter((p) => p.type === type);
    return ok(paginate(list, url));
  })),
  http.post(`${BASE}/papers`, authed(async ({ request }) => {
    const body = (await request.json()) as { name: string; type: string };
    return ok({ ...D.papers[0], id: 600, name: body.name, type: body.type, status: 'draft' });
  })),
  http.get(`${BASE}/papers/:id`, authed(({ params }) => {
    const p = D.papers.find((x) => x.id === Number(params.id));
    return p ? ok(p) : err(404, 4040, '试卷不存在');
  })),
  http.put(`${BASE}/papers/:id`, authed(() => okVoid())),
  http.post(`${BASE}/assignments`, authed(async () => ok(D.assignments[0]))),
  http.get(`${BASE}/assignments/:id/progress`, authed(() =>
    ok({ submitted: 12, totalStudents: 12, gradedSubjective: 8, pendingSubjective: 4 }))),

  // ================= 批改 =================
  http.get(`${BASE}/grading/pending`, authed(() => ok(D.gradingPending))),
  http.get(`${BASE}/grading/answers/:id`, authed(() => ok(D.gradingItem))),
  http.put(`${BASE}/grading/answers/:id/review`, authed(() => okVoid())),
  http.post(`${BASE}/grading/assignments/:id/adopt-ai`, authed(() => okVoid())),
  http.post(`${BASE}/grading/assignments/:id/finalize`, authed(() => okVoid())),

  // ================= 学生 =================
  http.get(`${BASE}/student/today`, authed(() => ok(D.studentToday))),
  http.get(`${BASE}/student/courses`, authed(() => ok([D.courses[0]]))),
  http.get(`${BASE}/student/courses/:id/lessons`, authed(({ params }) =>
    Number(params.id) === 1
      ? ok(D.lessons.map((lesson) => ({
          lesson,
          myHomework: lesson.id === 3 ? { assignmentId: 1, score: 25, wrongCount: 1 } : null,
        })))
      : ok([]))),
  http.get(`${BASE}/student/assignments`, authed(({ request }) => {
    const status = new URL(request.url).searchParams.get('status') ?? 'pending';
    return ok(status === 'pending' ? [] : D.assignments);
  })),
  http.post(`${BASE}/student/attempts`, authed(async () => ok({ ...D.attempt, status: 'in_progress', submittedAt: null }))),
  http.get(`${BASE}/student/attempts/:id`, authed(() => ok(D.attempt))),
  http.put(`${BASE}/student/attempts/:id/answers/:qid`, authed(async ({ params }) => {
    const q = D.questions.find((x) => x.id === Number(params.qid));
    if (!q) return err(404, 4040, '题目不存在');
    if (q.type === 'solution') return ok({ judged: false, isCorrect: null, correctAnswer: null, analysisLatex: null });
    return ok({ judged: true, isCorrect: true, correctAnswer: null, analysisLatex: q.analysisLatex });
  })),
  http.post(`${BASE}/student/attempts/:id/submit`, authed(() => ok({ ...D.attempt, status: 'submitted' }))),
  http.get(`${BASE}/student/wrong-book`, authed(({ request }) => {
    const url = new URL(request.url);
    const status = url.searchParams.get('status');
    let list = D.wrongBook;
    if (status) list = list.filter((w) => w.status === status);
    return ok(paginate(list, url));
  })),
  http.post(`${BASE}/student/wrong-book/:id/redo`, authed(() =>
    ok({ ...D.assignments[0], id: 700, kind: 'wrong_redo', scoreCounted: false, questionCount: 1 }))),
  http.post(`${BASE}/student/wrong-book/redo-all`, authed(() =>
    ok({ ...D.assignments[0], id: 701, kind: 'wrong_redo', scoreCounted: false, questionCount: D.wrongBook.length }))),
  http.get(`${BASE}/student/report`, authed(() => ok(D.studentReport))),
  http.get(`${BASE}/student/resources/:id/view`, authed(({ params }) =>
    ok({ url: `https://oss.example.com/view/${params.id}?sig=mock`, expiresAt: '2026-06-11T23:59:59.000Z' }))),

  // ================= 学情(教师) =================
  http.get(`${BASE}/analytics/courses/:id/mastery`, authed(() => ok(D.courseMasteryHeat))),
  http.get(`${BASE}/analytics/courses/:id/attention`, authed(() => ok(D.courseAttention))),
  http.get(`${BASE}/analytics/students/:id`, authed(() =>
    ok({ mastery: D.mastery, wrongOpenCount: D.wrongBook.length, attempts30d: 6 }))),

  // ================= AI =================
  http.post(`${BASE}/ai/qa`, authed(() => {
    const body = [
      'event: delta\ndata: {"text":"我们先回忆一下:平移只改 "}\n\n',
      'event: delta\ndata: {"text":"$b$,方向口诀是「上加下减」。你觉得本题应该加还是减?"}\n\n',
      'event: done\ndata: {"requestId":"mock-req-1"}\n\n',
    ].join('');
    return new HttpResponse(body, { headers: { 'Content-Type': 'text/event-stream' } });
  })),
  http.get(`${BASE}/ai/health`, authed(() => ok(D.aiHealth))),
];
