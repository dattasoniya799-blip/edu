/**
 * msw handlers · 按 packages/contracts/openapi.yaml 全量覆盖(三端共用同一份)
 * 统一响应包 {code,message,data};未带合法 Bearer → 401 {code:4011}
 */
import { http, HttpResponse, type HttpResponseResolver } from 'msw';
import type {
  AssignmentBriefDto, AssignmentDto, AssignmentKind, KpContentPackDto,
  LessonSegmentDto, MeDto, PaperDto, PaperType,
  QuestionAnswer, QuestionDto, QuestionOptionDto, QuestionType, RubricStep,
} from '@qiming/contracts';
import { CHECKLIST_KEYS, computeChecklist } from '../pages/lesson/lib/segments';
import * as D from './data';

/** /questions 写接口的请求体(形状 = openapi QuestionInput,字段类型全部复用 contracts) */
interface QuestionInput {
  type: QuestionType; stage: string; subject: string;
  textbookVersion?: string; chapter?: string;
  stemLatex: string; figures?: { ossKey: string; position: number }[];
  options?: QuestionOptionDto[]; answer: QuestionAnswer;
  rubric?: RubricStep[];
  analysisBriefLatex?: string; analysisLatex?: string; analysisDetailLatex?: string;
  difficulty?: number; tagNodeIds?: number[];
}

/** QuestionInput → QuestionDto(tagNodeIds 按 kpNodes/kpGraphs 解析为三维 tags,口径同 A3) */
function questionFromInput(
  body: QuestionInput,
  fixed: Pick<QuestionDto, 'id' | 'status' | 'ownerName' | 'createdAt' | 'stats'>,
): QuestionDto {
  const tags = (body.tagNodeIds ?? []).flatMap((nodeId) => {
    const node = D.kpNodes.find((n) => n.id === nodeId);
    const graph = node && D.kpGraphs.find((g) => g.id === node.graphId);
    return node && graph ? [{ nodeId, graphType: graph.graphType, code: node.code, name: node.name }] : [];
  });
  return {
    ...fixed,
    type: body.type, stage: body.stage, subject: body.subject,
    textbookVersion: body.textbookVersion ?? null, chapter: body.chapter ?? null,
    stemLatex: body.stemLatex, figures: body.figures ?? [],
    options: body.options ?? [], answer: body.answer,
    rubric: body.rubric ?? [],
    analysisBriefLatex: body.analysisBriefLatex ?? null,
    analysisLatex: body.analysisLatex ?? null,
    analysisDetailLatex: body.analysisDetailLatex ?? null,
    difficulty: body.difficulty ?? 2, tags,
  };
}

/** 试卷状态索引(B4 编排 checklist 用,口径同 A4:practice/homework 需挂 published 卷) */
const paperStatusById = () => new Map(D.papers.map((p) => [p.id, p.status]));

/** PaperInput.questions → Paper.questions(题序=数组顺序;引用不存在返回 null → 404) */
function resolvePaperQuestions(input: { questionId: number; score: number }[]): PaperDto['questions'] | null {
  const out: PaperDto['questions'] = [];
  for (const [i, pq] of input.entries()) {
    const q = D.questions.find((x) => x.id === pq.questionId);
    if (!q) return null;
    out.push({ seq: i + 1, questionId: q.id, score: pq.score, type: q.type, stemLatex: q.stemLatex });
  }
  return out;
}

/** 内容包存储 → KpContentPackDto(resource/paper 名按 id 解析回填,口径同服务端只读名) */
function contentPackDto(kpNodeId: number): KpContentPackDto {
  const node = D.kpNodes.find((n) => n.id === kpNodeId);
  const stored = D.contentPacks[kpNodeId];
  const lectureResourceId = stored?.lectureResourceId ?? null;
  const practicePaperId = stored?.practicePaperId ?? null;
  return {
    kpNodeId, kpNodeName: node?.name ?? '',
    lectureResourceId,
    lectureResourceName: lectureResourceId != null ? (D.resources.find((r) => r.id === lectureResourceId)?.name ?? null) : null,
    practicePaperId,
    practicePaperName: practicePaperId != null ? (D.papers.find((p) => p.id === practicePaperId)?.name ?? null) : null,
    summaryConfig: stored?.summaryConfig ?? {},
  };
}

/** AssignmentDto → AssignmentBriefDto(作业总览:作业 1 进度随批改链动态算,其余取种子/默认) */
function assignmentBrief(a: AssignmentDto): AssignmentBriefDto {
  const lesson = D.lessons.find((l) => l.id === a.lessonId);
  const base = {
    id: a.id, paperName: a.paperName, lessonId: a.lessonId,
    lessonTitle: lesson?.title ?? null, kind: a.kind, publishAt: a.publishAt, dueAt: a.dueAt,
  };
  if (a.id === 1) {
    const submitted = 12;
    const pending = D.gradingAnswers.filter((g) => g.finalScore == null).length;
    return {
      ...base, submitted, totalStudents: 12,
      graded: D.gradingState.finalized ? submitted : submitted - pending,
      status: D.gradingState.finalized ? 'finished' : 'ongoing',
    };
  }
  const seed = D.assignmentBriefSeed[a.id];
  if (seed) return { ...base, ...seed };
  const totalStudents = a.target.studentIds?.length
    ?? D.courses.find((c) => c.id === a.target.courseId)?.studentCount ?? 12;
  return { ...base, submitted: 0, totalStudents, graded: 0, status: 'ongoing' };
}

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
    return ok({
      id: 100, name: body.name, teacherNo: body.teacherNo ?? 'T-0100', phone: body.phone,
      stage: body.stage, subject: body.subject, status: 'pending', courseCount: 0, questionCount: 0, resourceCount: 0,
    });
  })),
  http.put(`${BASE}/admin/teachers/:id`, authed(() => okVoid())),
  http.delete(`${BASE}/admin/teachers/:id`, authed(() => okVoid())),
  http.post(`${BASE}/admin/teachers/:id/reset-password`, authed(() => okVoid())),

  http.get(`${BASE}/admin/students`, authed(({ request }) => {
    const url = new URL(request.url);
    const kw = url.searchParams.get('keyword') ?? '';
    const courseId = url.searchParams.get('courseId');
    let list = D.students.filter((s) => !kw || s.name.includes(kw) || s.studentNo.includes(kw));
    if (courseId) list = list.filter((s) => s.courses.some((c) => c.id === Number(courseId)));
    return ok(paginate(list, url));
  })),
  http.post(`${BASE}/admin/students`, authed(async ({ request }) => {
    const body = (await request.json()) as { name: string; parentPhone: string; grade: string; studentNo?: string };
    return ok({
      id: 200, name: body.name, studentNo: body.studentNo ?? 'S-0200', parentPhone: body.parentPhone,
      grade: body.grade, status: 'pending', courses: [], weekStudySec: 0,
    });
  })),
  http.put(`${BASE}/admin/students/:id`, authed(() => okVoid())),
  http.get(`${BASE}/admin/students/:id/profile`, authed(({ params }) => {
    const s = D.students.find((x) => x.id === Number(params.id));
    if (!s) return err(404, 4040, '学生不存在');
    return ok({ student: s, mastery: D.mastery, wrongOpenCount: D.wrongBook.length });
  })),
  http.post(`${BASE}/admin/students/:id/reset-password`, authed(({ params }) =>
    ok({ password: `Qm-${String(params.id).padStart(4, '0')}-${Math.random().toString(36).slice(2, 6)}` }))),

  http.get(`${BASE}/admin/courses`, authed(({ request }) => {
    const url = new URL(request.url);
    const kw = url.searchParams.get('keyword') ?? '';
    const classType = url.searchParams.get('classType');
    let list = D.courses.filter((c) => !kw || c.name.includes(kw));
    if (classType) list = list.filter((c) => c.classType === classType);
    return ok(paginate(list, url));
  })),
  http.post(`${BASE}/admin/courses`, authed(async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    return ok({ ...D.courses[0], id: 300, name: body.name, status: 'draft', currentLesson: 0, studentCount: 0 });
  })),
  http.put(`${BASE}/admin/courses/:id`, authed(() => okVoid())),
  http.get(`${BASE}/admin/courses/:id/roster`, authed(() => ok(D.courseRoster))),
  http.get(`${BASE}/admin/dashboard`, authed(() => ok(D.adminDashboard))),
  http.get(`${BASE}/admin/ai-usage/summary`, authed(() => ok(D.aiUsageSummary))),
  http.get(`${BASE}/admin/ai-usage/daily`, authed(({ request }) => {
    const days = Number(new URL(request.url).searchParams.get('days') ?? 14);
    return ok(D.aiUsageDaily.slice(-days));
  })),
  http.get(`${BASE}/admin/ai-usage/breakdown`, authed(() => ok(D.aiUsageBreakdown))),
  http.get(`${BASE}/admin/ai-quota`, authed(() => ok(D.aiQuota))),
  http.put(`${BASE}/admin/ai-quota`, authed(() => okVoid())),
  http.get(`${BASE}/admin/settings`, authed((info) => ok(currentUser(info.request)))),
  http.put(`${BASE}/admin/settings`, authed(() => okVoid())),
  http.get(`${BASE}/admin/audit-logs`, authed(({ request }) => ok(paginate(D.auditLogs, new URL(request.url))))),

  // ================= 知识图谱 =================
  http.get(`${BASE}/kp/graphs`, authed(() => ok(D.kpGraphs))),
  http.get(`${BASE}/kp/nodes`, authed(({ request }) => {
    const url = new URL(request.url);
    const graphId = Number(url.searchParams.get('graphId'));
    const grade = url.searchParams.get('grade');
    const chapter = url.searchParams.get('chapter');
    const kw = url.searchParams.get('keyword') ?? '';
    return ok(D.kpNodes.filter((n) =>
      n.graphId === graphId
      && (!grade || n.grade === grade)
      && (!chapter || n.chapter === chapter)
      && (!kw || n.name.includes(kw))));
  })),

  // ============ 知识点内容库(C3 #5:每知识点一份可复用内容包,有状态 mock) ============
  // 某图谱下已维护的内容包列表(只返回有内容的知识点)
  http.get(`${BASE}/knowledge/content-packs`, authed(({ request }) => {
    const graphId = Number(new URL(request.url).searchParams.get('graphId'));
    const list = D.kpNodes
      .filter((n) => n.graphId === graphId && D.contentPacks[n.id])
      .map((n) => contentPackDto(n.id));
    return ok(list);
  })),
  // 单个知识点内容包(未维护 → 空包:lecture/practice 为 null、summaryConfig 为 {})
  http.get(`${BASE}/knowledge/content-packs/:kpNodeId`, authed(({ params }) =>
    ok(contentPackDto(Number(params.kpNodeId))))),
  // upsert 内容包:字段缺省=不改,显式 null=清空(契约 KpContentPackInput 口径)
  http.put(`${BASE}/knowledge/content-packs/:kpNodeId`, authed(async ({ request, params }) => {
    const id = Number(params.kpNodeId);
    const body = (await request.json()) as {
      lectureResourceId?: number | null; practicePaperId?: number | null; summaryConfig?: Record<string, unknown>;
    };
    const cur = D.contentPacks[id] ?? { lectureResourceId: null, practicePaperId: null, summaryConfig: {} };
    if ('lectureResourceId' in body) cur.lectureResourceId = body.lectureResourceId ?? null;
    if ('practicePaperId' in body) cur.practicePaperId = body.practicePaperId ?? null;
    if ('summaryConfig' in body) cur.summaryConfig = body.summaryConfig ?? {};
    D.contentPacks[id] = cur;
    return okVoid();
  })),

  // ================= 题库(B3:有状态 mock,提交后列表可回显) =================
  http.get(`${BASE}/questions`, authed(({ request }) => {
    const url = new URL(request.url);
    const kw = url.searchParams.get('keyword') ?? '';
    const type = url.searchParams.get('type');
    const status = url.searchParams.get('status');
    const difficulty = url.searchParams.get('difficulty');
    const tagNodeId = url.searchParams.get('tagNodeId');
    let list = D.questions.filter((q) => !kw || q.stemLatex.includes(kw) || q.tags.some((t) => t.name.includes(kw)));
    if (type) list = list.filter((q) => q.type === type);
    if (status) list = list.filter((q) => q.status === status);
    if (difficulty) list = list.filter((q) => q.difficulty === Number(difficulty));
    if (tagNodeId) list = list.filter((q) => q.tags.some((t) => t.nodeId === Number(tagNodeId)));
    return ok(paginate(list, url));
  })),
  http.post(`${BASE}/questions`, authed(async ({ request }) => {
    const body = (await request.json()) as QuestionInput;
    const me = currentUser(request)!;
    const q = questionFromInput(body, {
      id: Math.max(0, ...D.questions.map((x) => x.id)) + 1,
      status: 'draft',
      ownerName: me.name,
      createdAt: new Date().toISOString(),
      stats: { correctRate: null, usedInPapers: 0 },
    });
    D.questions.push(q);
    return ok(q);
  })),
  http.get(`${BASE}/questions/:id`, authed(({ params }) => {
    const q = D.questions.find((x) => x.id === Number(params.id));
    return q ? ok(q) : err(404, 4040, '题目不存在');
  })),
  http.put(`${BASE}/questions/:id`, authed(async ({ request, params }) => {
    const idx = D.questions.findIndex((x) => x.id === Number(params.id));
    if (idx < 0) return err(404, 4040, '题目不存在');
    const prev = D.questions[idx];
    const body = (await request.json()) as QuestionInput;
    D.questions[idx] = questionFromInput(body, {
      id: prev.id, status: prev.status, ownerName: prev.ownerName,
      createdAt: prev.createdAt, stats: prev.stats,
    });
    return okVoid();
  })),
  http.delete(`${BASE}/questions/:id`, authed(({ params }) => {
    const idx = D.questions.findIndex((x) => x.id === Number(params.id));
    if (idx < 0) return err(404, 4040, '题目不存在');
    D.questions.splice(idx, 1);
    return okVoid();
  })),
  http.post(`${BASE}/questions/:id/publish`, authed(({ params }) => {
    const q = D.questions.find((x) => x.id === Number(params.id));
    if (!q) return err(404, 4040, '题目不存在');
    q.status = 'published';
    return okVoid();
  })),
  http.post(`${BASE}/uploads/sts`, authed(async ({ request }) => {
    const body = (await request.json()) as { purpose: string; fileName: string };
    return ok({
      uploadUrl: `https://oss.example.com/upload/${body.purpose}/${encodeURIComponent(body.fileName)}?sig=mock`,
      ossKey: `${body.purpose}/2026/06/${body.fileName}`,
      expiresAt: '2026-06-11T23:59:59.000Z',
    });
  })),
  // 直传两步流第 2 步:预签名 PUT 假端点(与 A3 契约形状一致:对 uploadUrl 直接 PUT 文件体)
  http.put('https://oss.example.com/upload/*', () => new HttpResponse(null, { status: 200 })),

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

  // ============ 教师 · 课程/讲次/编排/组卷/发布(B4:有状态 mock,口径同 A4 服务端) ============
  http.get(`${BASE}/teacher/courses`, authed(() => ok(D.courses))),
  http.get(`${BASE}/courses/:id/lessons`, authed(({ params }) =>
    Number(params.id) === 1 ? ok(D.lessons) : ok([]))),
  http.get(`${BASE}/lessons/:id`, authed(({ params }) => {
    const l = D.lessons.find((x) => x.id === Number(params.id));
    return l ? ok(l) : err(404, 4040, '讲次不存在');
  })),
  // C2 #5:讲次 patch(开场白 openingConfig 等)落库,供编排页读回往返
  http.put(`${BASE}/lessons/:id`, authed(async ({ request, params }) => {
    const lesson = D.lessons.find((x) => x.id === Number(params.id));
    if (!lesson) return err(404, 4040, '讲次不存在');
    const body = (await request.json()) as Partial<{ openingConfig: Record<string, unknown> | null; title: string }>;
    if ('openingConfig' in body) lesson.openingConfig = body.openingConfig ?? null;
    if (typeof body.title === 'string') lesson.title = body.title;
    return okVoid();
  })),
  http.get(`${BASE}/lessons/:id/segments`, authed(({ params }) => ok(D.segments[Number(params.id)] ?? []))),
  // 全量替换编排 + 同步重算 prep_checklist(A4 口径)
  http.put(`${BASE}/lessons/:id/segments`, authed(async ({ request, params }) => {
    const lesson = D.lessons.find((x) => x.id === Number(params.id));
    if (!lesson) return err(404, 4040, '讲次不存在');
    if (lesson.status === 'in_progress' || lesson.status === 'finished') return err(409, 4090, '讲次已开课/已结课,无法编排');
    const body = (await request.json()) as LessonSegmentDto[];
    D.segments[lesson.id] = body.map((s, i) => ({
      ...s,
      id: s.id ?? i + 1,
      seq: i + 1,
      // kpNodeName 只读:由服务端按 kpNodeId 回填(契约口径)
      kpNodeName: s.kpNodeId == null ? null : (D.kpNodes.find((n) => n.id === s.kpNodeId)?.name ?? null),
    }));
    lesson.prepChecklist = computeChecklist(D.segments[lesson.id], paperStatusById());
    return okVoid();
  })),
  // 发布:缺失 → 4201 + detail=缺失项键数组(同 A4:HTTP 409,checklist 同步落库);通过 → ready
  http.post(`${BASE}/lessons/:id/publish`, authed(({ params }) => {
    const lesson = D.lessons.find((x) => x.id === Number(params.id));
    if (!lesson) return err(404, 4040, '讲次不存在');
    if (lesson.status === 'in_progress' || lesson.status === 'finished') return err(409, 4090, '讲次已开课/已结课,无法发布');
    const segs = D.segments[lesson.id] ?? [];
    // 空讲次:无任何环节 → 4201 detail=['empty'](放宽门槛下 checklist 全 true,故需先拦空讲次)
    if (segs.length === 0)
      return HttpResponse.json({ code: 4201, message: '讲次为空,无法发布', detail: ['empty'] }, { status: 409 });
    const checklist = computeChecklist(segs, paperStatusById());
    lesson.prepChecklist = checklist;
    const missing = CHECKLIST_KEYS.filter((k) => !checklist[k]);
    if (missing.length)
      return HttpResponse.json({ code: 4201, message: '备课检查未通过,存在缺失项', detail: missing }, { status: 409 });
    lesson.status = 'ready';
    return okVoid();
  })),
  http.get(`${BASE}/papers`, authed(({ request }) => {
    const url = new URL(request.url);
    const type = url.searchParams.get('type');
    let list = D.papers;
    if (type) list = list.filter((p) => p.type === type);
    return ok(paginate(list, url));
  })),
  // 创建即 published(A4 口径:契约无 /papers/:id/publish);totalScore 服务端重算
  http.post(`${BASE}/papers`, authed(async ({ request }) => {
    const body = (await request.json()) as { name: string; type: PaperType; questions: { questionId: number; score: number }[] };
    const questions = resolvePaperQuestions(body.questions);
    if (!questions) return err(404, 4040, '引用的题目不存在');
    const paper: PaperDto = {
      id: Math.max(0, ...D.papers.map((p) => p.id)) + 1,
      name: body.name, type: body.type, status: 'published',
      totalScore: questions.reduce((s, q) => s + q.score, 0), questions,
    };
    D.papers.push(paper);
    return ok(paper);
  })),
  http.get(`${BASE}/papers/:id`, authed(({ params }) => {
    const p = D.papers.find((x) => x.id === Number(params.id));
    return p ? ok(p) : err(404, 4040, '试卷不存在');
  })),
  // 改题/调分:被 assignment 引用 → 4302(A4 口径)
  http.put(`${BASE}/papers/:id`, authed(async ({ request, params }) => {
    const paper = D.papers.find((x) => x.id === Number(params.id));
    if (!paper) return err(404, 4040, '试卷不存在');
    if (D.assignments.some((a) => a.paperId === paper.id)) return err(409, 4302, '试卷已被作业引用,禁止修改');
    const body = (await request.json()) as { name: string; type: PaperType; questions: { questionId: number; score: number }[] };
    const questions = resolvePaperQuestions(body.questions);
    if (!questions) return err(404, 4040, '引用的题目不存在');
    Object.assign(paper, { name: body.name, type: body.type, questions, totalScore: questions.reduce((s, q) => s + q.score, 0) });
    return okVoid();
  })),
  // 作业总览(C3 #4:教师布置过的全部作业 → AssignmentBrief[];支持 courseId/lessonId/status 过滤)
  http.get(`${BASE}/assignments`, authed(({ request }) => {
    const url = new URL(request.url);
    const courseId = url.searchParams.get('courseId');
    const lessonId = url.searchParams.get('lessonId');
    const status = url.searchParams.get('status');
    let list = D.assignments;
    if (courseId) list = list.filter((a) => a.target.courseId === Number(courseId));
    if (lessonId) list = list.filter((a) => a.lessonId === Number(lessonId));
    let briefs = list.map(assignmentBrief);
    if (status === 'ongoing' || status === 'finished') briefs = briefs.filter((b) => b.status === status);
    // 最近发布在前
    briefs.sort((a, b) => (a.publishAt < b.publishAt ? 1 : -1));
    return ok(briefs);
  })),
  http.post(`${BASE}/assignments`, authed(async ({ request }) => {
    const body = (await request.json()) as {
      paperId: number; lessonId?: number; kind: AssignmentKind;
      target: { courseId?: number; studentIds?: number[] }; dueAt?: string;
    };
    const paper = D.papers.find((p) => p.id === body.paperId);
    if (!paper) return err(404, 4040, '试卷不存在');
    const assignment: AssignmentDto = {
      id: Math.max(0, ...D.assignments.map((a) => a.id)) + 1,
      paperId: paper.id, paperName: paper.name, lessonId: body.lessonId ?? null,
      kind: body.kind, target: body.target, publishAt: new Date().toISOString(),
      dueAt: body.dueAt ?? null,
      scoreCounted: body.kind !== 'correction' && body.kind !== 'wrong_redo',
      questionCount: paper.questions.length, totalScore: paper.totalScore,
    };
    D.assignments.push(assignment);
    return ok(assignment);
  })),
  http.get(`${BASE}/assignments/:id/progress`, authed(({ params }) => {
    if (Number(params.id) !== 1) return ok({ submitted: 0, totalStudents: 12, gradedSubjective: 0, pendingSubjective: 0 });
    const pending = D.gradingAnswers.filter((g) => g.finalScore == null).length;
    return ok({ submitted: 12, totalStudents: 12, gradedSubjective: 12 - pending, pendingSubjective: pending });
  })),

  // ================= 批改(B4:有状态 mock,口径同 A5 服务端) =================
  http.get(`${BASE}/grading/pending`, authed(() => {
    if (D.gradingState.finalized) return ok([]);
    const aiScores = D.gradingAnswers.map((g) => g.aiScore).filter((s): s is number => s != null);
    return ok([{
      assignmentId: 1, paperName: '第3讲课后作业 · 待定系数法',
      pendingCount: D.gradingAnswers.filter((g) => g.finalScore == null).length,
      aiAvgScore: aiScores.length ? Math.round((aiScores.reduce((a, b) => a + b, 0) / aiScores.length) * 10) / 10 : null,
    }]);
  })),
  // [C1] 某作业逐题作答名单(待复核/已复核;status 过滤)→ 驱动复核页学生切换条
  http.get(`${BASE}/grading/assignments/:id/answers`, authed(({ params, request }) => {
    const assignmentId = Number(params.id);
    const assignment = D.assignments.find((a) => a.id === assignmentId);
    if (!assignment) return ok([]); // 仅 seed 的第 3 讲作业有主观题待复核
    const paper = D.papers.find((p) => p.id === assignment.paperId);
    const status = new URL(request.url).searchParams.get('status');
    const briefs = D.gradingAnswers.map((g, i) => ({
      answerId: g.answerId, studentId: g.studentId, studentName: g.studentName,
      questionId: g.questionId,
      seq: paper?.questions.find((pq) => pq.questionId === g.questionId)?.seq ?? i + 1,
      status: (g.finalScore == null ? 'pending' : 'graded') as 'pending' | 'graded',
      aiScore: g.aiScore, finalScore: g.finalScore,
    }));
    const filtered = status === 'pending' || status === 'graded' ? briefs.filter((b) => b.status === status) : briefs;
    return ok(filtered);
  })),
  http.get(`${BASE}/grading/answers/:id`, authed(({ params }) => {
    const g = D.gradingAnswers.find((x) => x.answerId === Number(params.id));
    return g ? ok(g) : err(404, 4040, '答卷不存在');
  })),
  http.put(`${BASE}/grading/answers/:id/review`, authed(async ({ request, params }) => {
    const g = D.gradingAnswers.find((x) => x.answerId === Number(params.id));
    if (!g) return err(404, 4040, '答卷不存在');
    const body = (await request.json()) as { finalScore: number; comment?: string };
    g.finalScore = body.finalScore;
    g.comment = body.comment ?? null;
    return okVoid();
  })),
  // 出分:仍有未复核 → 4501 + detail=pendingAnswerIds(A5 口径)
  http.post(`${BASE}/grading/assignments/:id/finalize`, authed(() => {
    const pendingIds = D.gradingAnswers.filter((g) => g.finalScore == null).map((g) => g.answerId);
    // detail 为对象 {pendingAnswerIds}(A5 服务端口径,非裸数组);批改页兼容对象形状取 ids
    if (pendingIds.length)
      return HttpResponse.json({ code: 4501, message: '仍有未复核的主观题,无法出分', detail: { pendingAnswerIds: pendingIds } }, { status: 409 });
    D.gradingState.finalized = true;
    return okVoid();
  })),

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
  http.post(`${BASE}/analytics/students/:id/diagnose`, authed(() => ok(D.aiDiagnosis))),

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
