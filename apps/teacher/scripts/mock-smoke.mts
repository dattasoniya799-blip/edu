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
  assert(login.data.me.role === 'admin' && login.data.me.orgName === '启明演示机构', '管理员 13800000001/Admin@123 登录,机构=启明演示机构');

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
  assert(ablNodes.data.length === 4, '/kp/nodes 能力图谱 4 节点');
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

  // 学生登录码兑换
  const sLogin = await api.post('/auth/student/qr-exchange', {
    body: { token: 'QM-DEMO', deviceFingerprint: 'fp-smoke', deviceName: 'smoke-tablet' },
  });
  token = sLogin.data.accessToken;
  assert(sLogin.data.me.name === '林小满', '学生登录码 QM-DEMO 兑换为 林小满');
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
