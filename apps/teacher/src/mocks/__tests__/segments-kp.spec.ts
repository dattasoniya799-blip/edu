/**
 * 编排 mock 全链路(msw/node + contracts createClient):
 * 环节标注知识点(写 kpNodeId,服务端回填 kpNodeName)+ 放宽发布(IMPL2 #3 验收)
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupServer } from 'msw/node';
import type { LessonSegmentDto } from '@qiming/contracts';
import { createClient } from '@qiming/contracts';
import { handlers } from '../handlers';

const server = setupServer(...handlers);
let token: string | null = null;
const api = createClient({
  baseUrl: 'http://localhost/api/v1',
  getToken: () => token,
  fetchImpl: (...args: Parameters<typeof fetch>) => globalThis.fetch(...args),
});

const LESSON = 4;

beforeAll(async () => {
  server.listen({ onUnhandledRequest: 'error' });
  const login = await api.post('/auth/login', { body: { phone: '13800000002', password: 'Teacher@123' } });
  token = login.data.accessToken;
});
afterAll(() => server.close());

async function getSegments() {
  return (await api.get('/lessons/{id}/segments', { params: { id: LESSON } })).data as LessonSegmentDto[];
}

describe('环节知识点标注(kpNodeId 写 / kpNodeName 回填)', () => {
  it('写 kpNodeId 后保存,服务端按图谱回填 kpNodeName;清除后变 null', async () => {
    const segs = await getSegments();
    // 给开场环节标注「待定系数法」(节点 103)
    const next = segs.map((s, i) => (i === 0 ? { ...s, kpNodeId: 103 } : s));
    await api.put('/lessons/{id}/segments', { params: { id: LESSON }, body: next });

    const afterSet = await getSegments();
    expect(afterSet[0].kpNodeId).toBe(103);
    expect(afterSet[0].kpNodeName).toBe('待定系数法'); // 只读名由服务端回填

    // 清除知识点
    await api.put('/lessons/{id}/segments', {
      params: { id: LESSON },
      body: afterSet.map((s, i) => (i === 0 ? { ...s, kpNodeId: null } : s)),
    });
    const afterClear = await getSegments();
    expect(afterClear[0].kpNodeId).toBeNull();
    expect(afterClear[0].kpNodeName).toBeNull();
  });
});

describe('放宽发布(仅 practice/homework 挂卷拦截)', () => {
  it('练习挂已发布卷、无作业环节 → 直接发布成功(不因缺四类拦截)', async () => {
    const segs = await getSegments();
    // 仅保留 warmup + lecture + practice(挂已发布卷 paperId 1),无 homework/summary
    const body = segs
      .filter((s) => s.type !== 'homework' && s.type !== 'summary')
      .map((s, i) => ({ ...s, seq: i + 1 }));
    await api.put('/lessons/{id}/segments', { params: { id: LESSON }, body });
    await expect(api.post('/lessons/{id}/publish', { params: { id: LESSON } })).resolves.toMatchObject({ code: 0 });
  });

  it('练习未挂卷 → 4201,detail 仅含 practice', async () => {
    const segs = await getSegments();
    const body = segs.map((s) => (s.type === 'practice' ? { ...s, paperId: null } : s));
    await api.put('/lessons/{id}/segments', { params: { id: LESSON }, body });
    await expect(api.post('/lessons/{id}/publish', { params: { id: LESSON } }))
      .rejects.toMatchObject({ code: 4201, detail: ['practice'] });
  });
});
