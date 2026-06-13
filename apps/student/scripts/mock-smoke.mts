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

  // 学生学号 + 密码登录
  const sLogin = await api.post('/auth/student/login', {
    body: { studentNo: 'S-0001', password: 'Student@123' },
  });
  token = sLogin.data.accessToken;
  assert(sLogin.data.me.name === '林小满', '学生 S-0001 密码登录为 林小满');
  const today = await api.get('/student/today');
  assert(!!today.data.todayLesson, '/student/today 返回今日课程');
  const wrong = await api.get('/student/wrong-book', { query: { page: 1, size: 20 } });
  assert(wrong.data.total === 6, '错题本 6 条(B5 seed 口径)');

  // B5:作业全流程冒烟(开始 → 答题 → 幂等续答 → 交卷)
  const started = await api.post('/student/attempts', { body: { assignmentId: 2 } });
  const at = started.data as typeof started.data & { questions: { questionId: number; type: string }[] };
  assert(at.status === 'in_progress' && at.questions.length === 3, '开始订正作答:in_progress,题面 3 题随 attempt 下发');
  const r1 = await api.put('/student/attempts/{id}/answers/{qid}', {
    params: { id: at.id, qid: at.questions[0].questionId },
    body: { response: { choice: 'A' } as never },
  });
  assert(r1.data.judged === true && r1.data.isCorrect === false && !!r1.data.analysisLatex, '单选判错:即时判分并下发解析');
  const again = await api.post('/student/attempts', { body: { assignmentId: 2 } });
  assert(again.data.id === at.id, '再次 POST 返回同一 in_progress(断点续答)');
  await api.put('/student/attempts/{id}/answers/{qid}', { params: { id: at.id, qid: at.questions[1].questionId }, body: { response: { texts: ['x'] } as never } });
  await api.put('/student/attempts/{id}/answers/{qid}', { params: { id: at.id, qid: at.questions[2].questionId }, body: { response: { photoOssKey: 'mock/up.jpg' } as never } });
  const submitted = await api.post('/student/attempts/{id}/submit', { params: { id: at.id } });
  assert(submitted.data.status === 'submitted', '交卷:含解答题 → submitted 待复核');

  // 错误密码
  token = null;
  const bad = await api.post('/auth/login', { body: { phone: '13800000001', password: 'wrong' } }).catch((e) => e);
  assert(bad instanceof Error, '错误密码被拒绝');

  console.log('\nmock 冒烟全部通过');
} finally {
  server.close();
}
