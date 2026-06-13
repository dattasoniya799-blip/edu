/**
 * C1 round3 #2:知识点内容库能从真实知识图谱加载并搜索。
 * 纯逻辑:① 选 curriculum_knowledge 图谱;② 关键词过滤。
 * 真因:此前页面把知识点树与内容包/资源/卷放在同一个 Promise.all,
 *       内容包接口失败(404)→ 整个 then 抛错 → setNodes 从未执行 → 树/搜索全空。
 * 容错验收(msw):内容包 404 时,/kp/nodes 仍正常返回节点(树不再被次要数据拖垮)。
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import type { KpGraphDto, KpNodeDto } from '@qiming/contracts';
import { createClient } from '@qiming/contracts';
import { handlers } from '../../../../mocks/handlers';
import { filterNodesByKeyword, pickKnowledgeGraph } from '../knowledge';

describe('pickKnowledgeGraph', () => {
  const g = (id: number, graphType: KpGraphDto['graphType']): KpGraphDto =>
    ({ id, code: `g${id}`, graphType, subject: '数学', nodeCount: 0 });

  it('优先选 curriculum_knowledge 图谱(即使不在首位)', () => {
    const graphs = [g(1, 'problem_solving_ability'), g(2, 'curriculum_knowledge'), g(3, 'problem_solving_strategy')];
    expect(pickKnowledgeGraph(graphs)?.id).toBe(2);
  });
  it('无教材图谱 → 退回第一个', () => {
    expect(pickKnowledgeGraph([g(7, 'problem_solving_ability')])?.id).toBe(7);
  });
  it('空数组 → undefined', () => {
    expect(pickKnowledgeGraph([])).toBeUndefined();
  });
});

describe('filterNodesByKeyword', () => {
  const nodes = [
    { id: 1, name: '一次函数的概念' },
    { id: 2, name: '二次函数' },
    { id: 3, name: '正数和负数' },
  ] as KpNodeDto[];
  it('空关键词 → 全部(副本)', () => {
    expect(filterNodesByKeyword(nodes, '   ').map((n) => n.id)).toEqual([1, 2, 3]);
  });
  it('按名称子串过滤', () => {
    expect(filterNodesByKeyword(nodes, '函数').map((n) => n.id)).toEqual([1, 2]);
  });
});

describe('知识点树不被次要数据(内容包/资源/卷)拖垮(round3 #2)', () => {
  const server = setupServer(...handlers);
  let token: string | null = null;
  const api = createClient({
    baseUrl: 'http://localhost/api/v1',
    getToken: () => token,
    fetchImpl: (...args: Parameters<typeof fetch>) => globalThis.fetch(...args),
  });
  beforeAll(async () => {
    server.listen({ onUnhandledRequest: 'error' });
    const login = await api.post('/auth/login', { body: { phone: '13800000002', password: 'Teacher@123' } });
    token = login.data.accessToken;
  });
  afterEach(() => server.resetHandlers());
  afterAll(() => server.close());

  it('内容包 404 时,/kp/nodes 仍正常返回教材知识点(可渲染/搜索)', async () => {
    // 复刻"内容包接口不可用"的线上故障
    server.use(http.get('*/api/v1/knowledge/content-packs', () =>
      HttpResponse.json({ code: 404, message: 'Cannot GET /knowledge/content-packs' }, { status: 404 })));

    const graphs = (await api.get('/kp/graphs')).data as KpGraphDto[];
    const graph = pickKnowledgeGraph(graphs)!;
    expect(graph.graphType).toBe('curriculum_knowledge');

    // 主数据:节点照常加载(与内容包解耦)
    const nodes = (await api.get('/kp/nodes', { query: { graphId: graph.id } })).data as KpNodeDto[];
    expect(nodes.length).toBeGreaterThan(0);
    expect(filterNodesByKeyword(nodes, '函数').length).toBeGreaterThan(0);

    // 次要数据:内容包确实 404(页面对其单独 catch,不影响树)
    await expect(api.get('/knowledge/content-packs', { query: { graphId: graph.id } }))
      .rejects.toMatchObject({ httpStatus: 404 });
  });
});
