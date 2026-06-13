/**
 * mock 冒烟:用 msw/node 起同一份 handlers,经 contracts createClient 走登录 → /me → 业务接口
 * (浏览器里 msw 走 Service Worker,此脚本验证 handlers/数据/客户端联通逻辑)
 * 运行:npm run test:mock
 */
import { setupServer } from 'msw/node';
import { createClient } from '../../../packages/contracts/src/index';
import { handlers } from '../src/mocks/handlers';

const server = setupServer(...handlers);
server.listen({ onUnhandledRequest: 'error' });

let token: string | null = null;
let sawUnauthorized = false;
const api = createClient({
  baseUrl: 'http://localhost/api/v1',
  getToken: () => token,
  onUnauthorized: () => { sawUnauthorized = true; },
});

const assert = (cond: unknown, msg: string) => { if (!cond) throw new Error(`✗ ${msg}`); console.log(`✓ ${msg}`); };

try {
  // 未登录 → 401 触发 onUnauthorized
  await api.get('/me').catch(() => undefined);
  assert(sawUnauthorized, '未登录访问 /me 触发 401 → onUnauthorized');

  // 管理员登录
  const login = await api.post('/auth/login', { body: { phone: '13800000001', password: 'Admin@123' } });
  token = login.data.accessToken;
  assert(login.data.me.role === 'admin' && login.data.me.orgName === '鲸云演示机构', '管理员 13800000001/Admin@123 登录,机构=鲸云演示机构');

  const me = await api.get('/me');
  assert(me.data.name === '王校长', '/me 返回 王校长');

  const teachers = await api.get('/admin/teachers', { query: { page: 1, size: 20 } });
  assert(teachers.data.total === 2, '教师列表 2 人(seed 口径)');

  const stus = await api.get('/admin/students', { query: { page: 1, size: 50 } });
  assert(stus.data.total === 12, '学生列表 12 人(seed 口径)');

  const dash = await api.get('/admin/dashboard');
  assert(dash.data.studentCount === 12, '管理员总览 studentCount=12');

  // 教师登录 + 题库
  const tLogin = await api.post('/auth/login', { body: { phone: '13800000002', password: 'Teacher@123' } });
  token = tLogin.data.accessToken;
  const qs = await api.get('/questions', { query: { page: 1, size: 50 } });
  assert(qs.data.total === 30, '题库 30 题(seed 口径)');
  const courses = await api.get('/teacher/courses');
  assert(courses.data.length === 2, '教师课程 2 门');

  // ===== B3 录题全链路:图谱 → 直传两步流 → 录入原型含图解答题 → 入库 → 列表回显 =====
  const graphs = await api.get('/kp/graphs');
  assert(graphs.data.length === 3, '/kp/graphs 三维图谱(教材/能力/策略)');
  const kpNodes = await api.get('/kp/nodes', { query: { graphId: 1 } });
  assert(kpNodes.data.length === 6, '/kp/nodes 教材图谱 6 节点');
  const ablNodes = await api.get('/kp/nodes', { query: { graphId: 2 } });
  assert(ablNodes.data.length === 41, '/kp/nodes 能力图谱 41 节点(FIX2:对齐真实图谱)');
  const strNodes = await api.get('/kp/nodes', { query: { graphId: 3 } });
  assert(strNodes.data.length === 35, '/kp/nodes 策略图谱 35 节点(FIX2:对齐真实图谱)');
  const gradeNodes = await api.get('/kp/nodes', { query: { graphId: 1, grade: '初二' } });
  assert(gradeNodes.data.length === 6, '/kp/nodes 按年级筛选');

  const sts = await api.post('/uploads/sts', { body: { purpose: 'question_figure', fileName: 'fig-1.svg' } });
  assert(sts.data.uploadUrl.includes('question_figure') && !!sts.data.ossKey, '/uploads/sts 签发直传凭证');
  const put = await fetch(sts.data.uploadUrl, { method: 'PUT', body: '<svg/>' });
  assert(put.ok, '预签名 PUT 假端点直传成功(两步流第 2 步)');

  // 原型 t-editor 中那道含图解答题
  const created = await api.post('/questions', {
    body: {
      type: 'solution', stage: '初中', subject: '数学',
      textbookVersion: '人教版', chapter: '第十九章 一次函数',
      stemLatex: '如图,在平面直角坐标系中,一次函数 $y=kx+b\\ (k\\neq 0)$ 的图象经过点 $A(1,3)$ 与点 $B(-1,-1)$。\n\n(1) 求该一次函数的解析式;\n\n(2) 设图象与 $x$ 轴交于点 $C$,求 $\\triangle OAC$ 的面积;\n\n(3) 解方程组并验证交点:\n$$\\begin{cases} y=2x+1 \\\\ y=-x+4 \\end{cases}$$',
      figures: [{ ossKey: sts.data.ossKey, position: 1 }],
      options: [],
      answer: { referenceLatex: '设 $y=kx+b$,代入 $A(1,3)$、$B(-1,-1)$ 得 $k=2,\\ b=1$,解析式为 $y=2x+1$。' },
      rubric: [
        { step: 1, desc: '设式并代入两点', score: 3 },
        { step: 2, desc: '求出解析式', score: 4 },
        { step: 3, desc: '正确求出三角形面积', score: 3 },
      ],
      analysisLatex: '把两点代入得 $\\begin{cases} k+b=3 \\\\ -k+b=-1 \\end{cases}$,解得 $k=2,\\ b=1$。',
      difficulty: 3,
      tagNodeIds: [102, 103, 201, 301],
    },
  });
  assert(created.data.status === 'draft' && created.data.figures.length === 1, '录题保存为草稿(含 1 张图)');
  assert(
    created.data.tags.some((t) => t.graphType === 'curriculum_knowledge' && t.name === '待定系数法')
    && created.data.tags.some((t) => t.graphType === 'problem_solving_ability'),
    'tagNodeIds 解析为三维标签',
  );
  const detail = await api.get('/questions/{id}', { params: { id: created.data.id } });
  assert(detail.data.stemLatex.includes('\\triangle OAC'), '题目详情回读题干一致');
  await api.post('/questions/{id}/publish', { params: { id: created.data.id } });
  const after = await api.get('/questions', { query: { page: 1, size: 50, status: 'published' } });
  assert(after.data.items.some((q) => q.id === created.data.id), '提交入库后列表回显(status=published)');
  const byTag = await api.get('/questions', { query: { page: 1, size: 50, tagNodeId: 103 } });
  assert(byTag.data.items.some((q) => q.id === created.data.id), '按 tagNodeId 筛选命中新题');
  await api.del('/questions/{id}', { params: { id: created.data.id } });
  const afterDel = await api.get('/questions', { query: { page: 1, size: 50 } });
  assert(afterDel.data.total === 30, '删除后题库回到 30 题');

  // ===== B4 编排→发布→组卷→发布作业全链路(有状态 mock) =====
  const lessons = await api.get('/courses/{id}/lessons', { params: { id: 1 } });
  assert(lessons.data.length === 6, '讲次时间线 6 讲(seed 口径)');
  assert(lessons.data[3].status === 'draft' && lessons.data[3].prepChecklist.homework === false,
    '第 4 讲初始 draft,checklist 缺 homework');

  // 放宽发布(IMPL2 #3):仅 practice/homework 未挂发布卷才拦截;先验证练习未挂卷 → 4201 仅含 practice
  const segs4base = await api.get('/lessons/{id}/segments', { params: { id: 4 } });
  await api.put('/lessons/{id}/segments', {
    params: { id: 4 },
    body: segs4base.data.map((s) => (s.type === 'practice' ? { ...s, paperId: null } : s)),
  });
  const pubNoPaper = await api.post('/lessons/{id}/publish', { params: { id: 4 } }).catch((e) => e);
  assert(pubNoPaper instanceof Error && (pubNoPaper as { code?: number }).code === 4201
    && Array.isArray((pubNoPaper as { detail?: unknown }).detail)
    && ((pubNoPaper as { detail: string[] }).detail).includes('practice')
    && !((pubNoPaper as { detail: string[] }).detail).includes('homework'),
    '练习未挂卷发布 → 4201 + detail 仅含 practice(放宽:缺四类不拦截)');
  // 还原练习挂卷 → 缺 homework/summary 也能直接发布
  await api.put('/lessons/{id}/segments', { params: { id: 4 }, body: segs4base.data });
  const pub1 = await api.post('/lessons/{id}/publish', { params: { id: 4 } });
  assert(pub1.code === 0, '练习挂发布卷、无作业环节 → 直接发布成功(放宽发布)');

  const hw = await api.post('/papers', {
    body: { name: '第4讲课后作业 · 一次函数的图象平移', type: 'homework', questions: [{ questionId: 1, score: 5 }, { questionId: 5, score: 5 }, { questionId: 4, score: 10 }] },
  });
  assert(hw.data.status === 'published' && hw.data.totalScore === 20, '组卷创建即 published,totalScore=Σ=20');

  const asg = await api.post('/assignments', {
    body: { paperId: hw.data.id, lessonId: 4, kind: 'homework', target: { courseId: 1 }, dueAt: '2026-06-17T13:00:00.000Z' },
  });
  assert(asg.data.id > 1 && asg.data.scoreCounted && asg.data.questionCount === 3, '发布作业:assignment 创建,homework 计分');

  const segs4 = await api.get('/lessons/{id}/segments', { params: { id: 4 } });
  await api.put('/lessons/{id}/segments', {
    params: { id: 4 },
    body: [...segs4.data, { seq: segs4.data.length + 1, type: 'homework', durationMin: 0, config: {}, resourceId: null, paperId: hw.data.id }],
  });
  const l4 = await api.get('/lessons/{id}', { params: { id: 4 } });
  assert(l4.data.prepChecklist.homework === true, '挂载作业卷后 checklist.homework=true(PUT segments 同步重算)');
  await api.post('/lessons/{id}/publish', { params: { id: 4 } });
  const l4after = await api.get('/lessons/{id}', { params: { id: 4 } });
  assert(l4after.data.status === 'ready', '补齐后发布 → 讲次状态变 ready(验收项)');

  const lockedPut = await api.put('/papers/{id}', {
    params: { id: hw.data.id },
    body: { name: 'x', type: 'homework', questions: [{ questionId: 1, score: 5 }] },
  }).catch((e) => e);
  assert(lockedPut instanceof Error && (lockedPut as { code?: number }).code === 4302, '被 assignment 引用的卷禁改 → 4302');

  // ===== B4 批改复核链路(第 3 讲作业,4 份解答题) =====
  const pending0 = await api.get('/grading/pending');
  assert(pending0.data[0]?.pendingCount === 4, '/grading/pending:4 份待复核(seed 口径)');
  // [C1] 名单端点驱动复核页切换条
  const briefs0 = await api.get('/grading/assignments/{id}/answers', { params: { id: 1 } });
  assert(briefs0.data.length === 4 && briefs0.data.every((b) => b.status === 'pending'),
    '/grading/assignments/1/answers:4 份逐题名单,全 pending(驱动切换条)');
  const briefsPending = await api.get('/grading/assignments/{id}/answers', { params: { id: 1 }, query: { status: 'pending' } });
  assert(briefsPending.data.length === 4, '名单 status=pending 过滤(只看待复核)');
  const fin0 = await api.post('/grading/assignments/{id}/finalize', { params: { id: 1 } }).catch((e) => e);
  assert(fin0 instanceof Error && (fin0 as { code?: number }).code === 4501
    && Array.isArray((fin0 as { detail?: unknown }).detail) && ((fin0 as { detail: number[] }).detail).length === 4,
    '未复核完出分 → 4501 + detail=pendingAnswerIds(A5 形状)');

  const g41 = await api.get('/grading/answers/{id}', { params: { id: 41 } });
  assert(g41.data.studentName === '许诺' && g41.data.aiScore === 7 && g41.data.finalScore === null, '单份详情:许诺 AI 预批 7/10');
  await api.put('/grading/answers/{id}/review', { params: { id: 41 }, body: { finalScore: 5, comment: '注意还原方向' } });
  const pending1 = await api.get('/grading/pending');
  assert(pending1.data[0]?.pendingCount === 3, '改分确认后 pending 数下降 4→3(验收项)');
  await api.post('/grading/assignments/{id}/adopt-ai', { params: { id: 1 } });
  const pending2 = await api.get('/grading/pending');
  assert(pending2.data[0]?.pendingCount === 0, '全部采纳 AI 分后 pending=0');
  const prog = await api.get('/assignments/{id}/progress', { params: { id: 1 } });
  assert(prog.data.pendingSubjective === 0 && prog.data.gradedSubjective === 12, 'progress 与复核状态对账');
  await api.post('/grading/assignments/{id}/finalize', { params: { id: 1 } });
  const pending3 = await api.get('/grading/pending');
  assert(pending3.data.length === 0, '出分后待复核列表清空');

  // 学生学号 + 密码登录
  const sLogin = await api.post('/auth/student/login', {
    body: { studentNo: 'S-0001', password: 'Student@123' },
  });
  token = sLogin.data.accessToken;
  assert(sLogin.data.me.name === '林小满', '学生 S-0001 密码登录为 林小满');
  const today = await api.get('/student/today');
  assert(!!today.data.todayLesson, '/student/today 返回今日课程');
  const wrong = await api.get('/student/wrong-book', { query: { page: 1, size: 20 } });
  assert(wrong.data.total === 2, '错题本 2 条');

  // 错误密码
  token = null;
  const bad = await api.post('/auth/login', { body: { phone: '13800000001', password: 'wrong' } }).catch((e) => e);
  assert(bad instanceof Error, '错误密码被拒绝');

  console.log('\nmock 冒烟全部通过');
} finally {
  server.close();
}
