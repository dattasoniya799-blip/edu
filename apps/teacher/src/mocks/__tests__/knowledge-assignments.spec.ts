/**
 * C3 mock 全链路:知识点内容包(GET/PUT)往返 + 作业总览(GET /assignments → AssignmentBrief[])。
 * 经 msw/node + contracts createClient,验证 handlers/数据/客户端联通,对齐契约新字段。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupServer } from 'msw/node';
import type { AssignmentBriefDto, KpContentPackDto } from '@qiming/contracts';
import { createClient } from '@qiming/contracts';
import { handlers } from '../handlers';

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
afterAll(() => server.close());

const getPack = async (kpNodeId: number) =>
  (await api.get('/knowledge/content-packs/{kpNodeId}', { params: { kpNodeId } })).data as KpContentPackDto;

describe('知识点内容包 GET/PUT 往返(C3 #5)', () => {
  it('预置:知识点 102 已维护(讲解资源 1 + 随堂练卷 1),名称由服务端回填', async () => {
    const p = await getPack(102);
    expect(p.kpNodeId).toBe(102);
    expect(p.kpNodeName).toBe('一次函数的图象');
    expect(p.lectureResourceId).toBe(1);
    expect(p.lectureResourceName).toBe('函数图象平移 · 动画演示');
    expect(p.practicePaperId).toBe(1);
    expect(p.practicePaperName).toBe('第4讲 · 随堂练');
  });

  it('未维护知识点 → 空包(lecture/practice 为 null、summaryConfig 为 {})', async () => {
    const p = await getPack(104);
    expect(p.lectureResourceId).toBeNull();
    expect(p.practicePaperId).toBeNull();
    expect(p.summaryConfig).toEqual({});
  });

  it('PUT upsert:写讲解/练/小结 → 回读一致,只读名回填', async () => {
    await api.put('/knowledge/content-packs/{kpNodeId}', {
      params: { kpNodeId: 104 },
      body: { lectureResourceId: 2, practicePaperId: 1, summaryConfig: { personal_consolidation: { min: 3, max: 5 } } },
    });
    const p = await getPack(104);
    expect(p.lectureResourceId).toBe(2);
    expect(p.lectureResourceName).toBe('待定系数法 · 微课视频');
    expect(p.practicePaperId).toBe(1);
    expect(p.summaryConfig).toEqual({ personal_consolidation: { min: 3, max: 5 } });
  });

  it('PUT 字段缺省=不改,显式 null=清空(契约 KpContentPackInput 口径)', async () => {
    // 只传 lectureResourceId=null:清讲解,practice/summary 不动
    await api.put('/knowledge/content-packs/{kpNodeId}', { params: { kpNodeId: 104 }, body: { lectureResourceId: null } });
    const p = await getPack(104);
    expect(p.lectureResourceId).toBeNull();
    expect(p.practicePaperId).toBe(1); // 未传 → 保持
    expect(p.summaryConfig).toEqual({ personal_consolidation: { min: 3, max: 5 } });
  });

  it('内容包列表:某图谱下仅返回已维护的知识点(含预置 102 + 新建 104)', async () => {
    const list = (await api.get('/knowledge/content-packs', { query: { graphId: 1 } })).data as KpContentPackDto[];
    const ids = list.map((x) => x.kpNodeId);
    expect(ids).toContain(102);
    expect(ids).toContain(104);
  });
});

describe('作业总览 GET /assignments → AssignmentBrief[](C3 #4)', () => {
  it('列全部:含进度/讲次/状态;作业 1 进度随批改链动态算(未出分 → ongoing)', async () => {
    const list = (await api.get('/assignments')).data as AssignmentBriefDto[];
    expect(list.length).toBeGreaterThanOrEqual(2);
    const a1 = list.find((a) => a.id === 1)!;
    expect(a1.lessonTitle).toContain('第3讲');
    expect(a1.totalStudents).toBe(12);
    expect(a1.submitted).toBe(12);
    expect(a1.graded).toBe(8); // 12 - 4 份待复核
    expect(a1.status).toBe('ongoing');
  });

  it('status=finished 过滤 → 仅已结束作业(种子作业 2)', async () => {
    const list = (await api.get('/assignments', { query: { status: 'finished' } })).data as AssignmentBriefDto[];
    expect(list.every((a) => a.status === 'finished')).toBe(true);
    expect(list.some((a) => a.id === 2)).toBe(true);
  });

  it('lessonId 过滤 → 仅该讲作业', async () => {
    const list = (await api.get('/assignments', { query: { lessonId: 3 } })).data as AssignmentBriefDto[];
    expect(list.map((a) => a.id)).toEqual([1]);
  });

  it('新发布作业 → 出现在总览,初始零提交、ongoing', async () => {
    const hw = await api.post('/papers', { body: { name: 'C3 验证卷', type: 'homework', questions: [{ questionId: 1, score: 5 }] } });
    const asg = await api.post('/assignments', { body: { paperId: hw.data.id, lessonId: 4, kind: 'homework', target: { courseId: 1 }, dueAt: '2026-06-20T13:00:00.000Z' } });
    const list = (await api.get('/assignments')).data as AssignmentBriefDto[];
    const created = list.find((a) => a.id === asg.data.id)!;
    expect(created.submitted).toBe(0);
    expect(created.graded).toBe(0);
    expect(created.status).toBe('ongoing');
  });
});

describe('发布空讲次 → 4201 detail=[empty](C3 #P2)', () => {
  it('清空讲次 5 的环节后发布 → 4201,detail 含 empty', async () => {
    await api.put('/lessons/{id}/segments', { params: { id: 5 }, body: [] });
    await expect(api.post('/lessons/{id}/publish', { params: { id: 5 } }))
      .rejects.toMatchObject({ code: 4201, detail: ['empty'] });
  });
});

describe('未复核出分 → 4501 detail={pendingAnswerIds}(C3 #P2 对象形状)', () => {
  it('finalize 未复核 → 4501,detail 为对象,pendingAnswerIds 为待复核 ids', async () => {
    const e = await api.post('/grading/assignments/{id}/finalize', { params: { id: 1 } }).catch((x) => x);
    expect((e as { code?: number }).code).toBe(4501);
    const detail = (e as { detail?: unknown }).detail as { pendingAnswerIds: number[] };
    expect(Array.isArray(detail.pendingAnswerIds)).toBe(true);
    expect(detail.pendingAnswerIds.length).toBe(4);
  });
});
