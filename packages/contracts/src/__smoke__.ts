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
  const ol = await api.post('/courseware/outline', { body: {
    sourceText: '一次函数 $y=kx+b$ 的图象与性质……', pageCount: 8, style: { id: 'chalk' },
  }});
  const _prompt: string = ol.data.pages[0].imagePrompt;
  const job = await api.post('/courseware/jobs', { body: {
    name: '一次函数的图象与性质', style: { id: 'custom', customText: '水彩手绘' },
    pages: [{ title: '定义', body: '形如 $y=kx+b$', imagePrompt: '黑板上写着定义' }],
  }});
  const _jobId: string = job.data.jobId;
  const jb = await api.get('/courseware/jobs/{jobId}', { params: { jobId: _jobId } });
  const _jobStatus: 'queued' | 'running' | 'done' | 'failed' = jb.data.status;  // 字面量联合被推断
  const retried = await api.post('/courseware/jobs/{jobId}/retry', { params: { jobId: _jobId } });
  const _null: null = retried.data;
  // @ts-expect-error 不存在的路径必须编译失败
  await api.get('/no/such/path');
  // @ts-expect-error 错误的 body 字段必须编译失败
  await api.post('/auth/login', { body: { phone: 1, password: 'x' } });
  // @ts-expect-error jobId 是字符串路径参数(非数字 id),传数字必须编译失败
  await api.get('/courseware/jobs/{jobId}', { params: { jobId: 1 } });
  // @ts-expect-error 大纲缺 required 的 style 必须编译失败
  await api.post('/courseware/outline', { body: { sourceText: 'x', pageCount: 3 } });
  void [_role, _n, _id, _judged, _prompt, _jobStatus, _null];
}
void smoke;
