/** 编译期冒烟:验证 SDK 的路径/参数/响应推断。本文件不运行,只参与 tsc 检查 */
import { createClient } from './client';
const api = createClient({ getToken: () => null });
async function smoke() {
  const me = await api.get('/me');
  const _role: 'admin' | 'teacher' | 'student' = me.data.role;        // 字面量联合被推断
  const t = await api.get('/admin/teachers', { query: { page: 1, size: 20 } });
  const _n: number = t.data.total;
  const q = await api.post('/questions', { body: {
    type: 'solution', stage: '初中', subject: '数学',
    stemLatex: '求 $f(x)$', answer: { referenceLatex: 'x=1' },
    rubric: [{ step: 1, desc: '设式', score: 3 }], tagNodeIds: [1, 42, 80],
  }});
  const _id: number = q.data.id;
  const sub = await api.put('/student/attempts/{id}/answers/{qid}', {
    params: { id: 1, qid: 2 }, body: { response: { choice: 'B' } },
  });
  const _judged: boolean = sub.data.judged;
  // @ts-expect-error 不存在的路径必须编译失败
  await api.get('/no/such/path');
  // @ts-expect-error 错误的 body 字段必须编译失败
  await api.post('/auth/login', { body: { phone: 1, password: 'x' } });
  void [_role, _n, _id, _judged];
}
void smoke;
