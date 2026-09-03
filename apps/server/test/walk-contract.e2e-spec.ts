/**
 * 2026-09-02 契约变更(task/walk-contract,经用户批准)验收:
 * - Paper 聚合:subject(卷内题目学科众数 / 空卷 null)、kpNodes(教材知识点去重);GET /papers 按 subject / kpNodeId / status 筛
 * - 草稿态:POST /papers status=draft → 草稿;草稿不可布置(400);POST /papers/:id/publish → published(幂等);他人 publish → 403
 * - 课堂课件下发:讲解环节挂普通资源(image)→ class:join 快照 courseware[0].resource{type,name,url},url 为签名直链可 GET;
 *   结构化 meta.pages 仍按逐页下发(不受影响);ai_courseware 资源仍排除
 * 夹具:walk.fixtures(独立机构);跨租户 404 由既有套件覆盖。
 */
import { INestApplication } from '@nestjs/common';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { io as ioc } from 'socket.io-client';
import { PaperService } from '../src/paper/paper.service';
import { createWalkOrg, dropWalkOrg, WALK_PASSWORD, WalkFixture } from './fixtures/walk.fixtures';
import { createApp, raw } from './fixtures/setup';

describe('契约变更 · 试卷分类 / 草稿态 / 课堂课件下发(2026-09-02)', () => {
  let app: INestApplication;
  let http: any;
  let port: number;
  let fx: WalkFixture;
  let teacherAt: string;
  let studentAt: string;

  const post = (url: string, at: string) => request(http).post(`/api/v1${url}`).set('Authorization', `Bearer ${at}`);
  const put = (url: string, at: string) => request(http).put(`/api/v1${url}`).set('Authorization', `Bearer ${at}`);
  const get = (url: string, at: string) => request(http).get(`/api/v1${url}`).set('Authorization', `Bearer ${at}`);

  beforeAll(async () => {
    app = await createApp();
    await app.listen(0);
    http = app.getHttpServer();
    port = (http.address() as AddressInfo).port;
    fx = await createWalkOrg();
    teacherAt = (await request(http).post('/api/v1/auth/login').send({ phone: fx.teacherPhone, password: WALK_PASSWORD }).expect(200)).body.data.accessToken;
    studentAt = (await request(http).post('/api/v1/auth/student/login').send({ studentNo: fx.s1No, password: WALK_PASSWORD }).expect(200)).body.data.accessToken;
  });

  afterAll(async () => {
    await dropWalkOrg(fx.orgId);
    await raw.$disconnect();
    await app.close();
  });

  it('aggregateSubject:全一致取该学科;混合取众数(并列取先出现);空卷 null', () => {
    expect(PaperService.aggregateSubject(['数学', '数学'])).toBe('数学');
    expect(PaperService.aggregateSubject(['物理', '数学', '数学'])).toBe('数学');
    expect(PaperService.aggregateSubject(['化学', '数学'])).toBe('化学');
    expect(PaperService.aggregateSubject([])).toBeNull();
  });

  it('GET /papers:每张卷带 subject / kpNodes;subject / kpNodeId / status 筛选生效', async () => {
    const list = await get('/papers?size=50', teacherAt).expect(200);
    const seed = list.body.data.items.find((p: { id: number }) => p.id === Number(fx.paperId));
    expect(seed.subject).toBe('数学');
    expect(seed.kpNodes).toEqual([{ id: expect.any(Number), name: fx.kpNodeName }]);
    const bySubject = await get('/papers?subject=%E6%95%B0%E5%AD%A6&size=50', teacherAt).expect(200);
    expect(bySubject.body.data.items.every((p: { subject: string }) => p.subject === '数学')).toBe(true);
    expect(bySubject.body.data.total).toBeGreaterThan(0);
    const none = await get('/papers?subject=%E5%8C%96%E5%AD%A6&size=50', teacherAt).expect(200);
    expect(none.body.data.total).toBe(0);
    const byKp = await get(`/papers?kpNodeId=${seed.kpNodes[0].id}&size=50`, teacherAt).expect(200);
    expect(byKp.body.data.items.map((p: { id: number }) => p.id)).toContain(Number(fx.paperId));
    const byKpNone = await get('/papers?kpNodeId=999999999&size=50', teacherAt).expect(200);
    expect(byKpNone.body.data.total).toBe(0);
  });

  it('草稿态:status=draft 创建 → 列表 status 筛选 → 草稿不可布置(400)→ publish 转正(幂等)→ 可布置;非创建者 publish → 403', async () => {
    const draft = await post('/papers', teacherAt)
      .send({ name: 'WALK 草稿卷', type: 'practice', status: 'draft', questions: [{ questionId: Number(fx.qSingleId), score: 5 }] })
      .expect(200);
    expect(draft.body.data.status).toBe('draft');
    const drafts = await get('/papers?status=draft&size=50', teacherAt).expect(200);
    expect(drafts.body.data.items.map((p: { id: number }) => p.id)).toContain(draft.body.data.id);
    const published = await get('/papers?status=published&size=50', teacherAt).expect(200);
    expect(published.body.data.items.map((p: { id: number }) => p.id)).not.toContain(draft.body.data.id);
    // 缺省 status 仍 published(向后兼容)
    const legacy = await post('/papers', teacherAt)
      .send({ name: 'WALK 缺省卷', type: 'practice', questions: [{ questionId: Number(fx.qSingleId), score: 5 }] })
      .expect(200);
    expect(legacy.body.data.status).toBe('published');
    // 草稿不可布置
    const blocked = await post('/assignments', teacherAt)
      .send({ paperId: draft.body.data.id, kind: 'homework', target: { courseId: Number(fx.courseId) } })
      .expect(400);
    expect(blocked.body.message).toContain('尚未发布');
    // 非创建者(管理员之外的其他教师)publish → 403
    const other = await raw.user.create({ data: { orgId: fx.orgId, role: 'teacher', name: 'WALK他师', phone: '13904000002', passwordHash: (await raw.user.findUniqueOrThrow({ where: { id: fx.teacherId } })).passwordHash } });
    const otherAt = (await request(http).post('/api/v1/auth/login').send({ phone: '13904000002', password: WALK_PASSWORD }).expect(200)).body.data.accessToken;
    await post(`/papers/${draft.body.data.id}/publish`, otherAt).expect(403);
    await raw.user.delete({ where: { id: other.id } });
    // 创建者 publish → published;再 publish 幂等 200
    await post(`/papers/${draft.body.data.id}/publish`, teacherAt).expect(200);
    await post(`/papers/${draft.body.data.id}/publish`, teacherAt).expect(200);
    const detail = await get(`/papers/${draft.body.data.id}`, teacherAt).expect(200);
    expect(detail.body.data.status).toBe('published');
    const ok = await post('/assignments', teacherAt)
      .send({ paperId: draft.body.data.id, kind: 'homework', target: { courseId: Number(fx.courseId) } })
      .expect(200);
    expect(ok.body.data.paperId).toBe(draft.body.data.id);
  });

  it('课堂课件下发:讲解环节挂 image 资源 → 快照 courseware[0].resource 为签名直链且可 GET;结构化 pages 资源仍逐页下发;ai_courseware 排除', async () => {
    // 上传一张 png 作为课件资源
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');
    const sts = await post('/uploads/sts', teacherAt).send({ purpose: 'resource', fileName: 'kejian.png', contentType: 'image/png', size: png.length }).expect(200);
    await request(http).put(String(sts.body.data.uploadUrl).replace(/^https?:\/\/[^/]+/, '')).set('Content-Type', 'image/png').send(png).expect(200);
    const res = await post('/resources', teacherAt).send({ type: 'image', name: 'WALK 课件图', ossKey: sts.body.data.ossKey, size: png.length, meta: {} }).expect(200);
    // 结构化逐页课件 + AI 课件(直接落库)
    const structured = await raw.resource.create({
      data: { orgId: fx.orgId, ownerId: fx.teacherId, type: 'pdf', name: 'WALK 结构化课件', ossKey: `resource/${Number(fx.orgId)}/x/structured.pdf`, size: 1, meta: { pages: [{ title: '第一页', body: '正文' }] } },
    });
    const ai = await raw.resource.create({
      data: { orgId: fx.orgId, ownerId: fx.teacherId, type: 'ppt', name: 'WALK AI 课件', ossKey: `resource/${Number(fx.orgId)}/x/ai.ppt`, size: 1, meta: { kind: 'ai_courseware' } },
    });
    // 新讲次:三个讲解环节各挂一种 + 一个随堂练(发布需 ≥1 环节)
    const lesson = await raw.lesson.create({ data: { orgId: fx.orgId, courseId: fx.courseId, seq: 2, title: 'WALK 第2讲', status: 'draft' } });
    await put(`/lessons/${lesson.id}/segments`, teacherAt)
      .send([
        { seq: 1, type: 'lecture', durationMin: 10, config: {}, resourceId: res.body.data.id, paperId: null, kpNodeId: null, unitSeq: 1 },
        { seq: 2, type: 'lecture', durationMin: 10, config: {}, resourceId: Number(structured.id), paperId: null, kpNodeId: null, unitSeq: 2 },
        { seq: 3, type: 'lecture', durationMin: 10, config: {}, resourceId: Number(ai.id), paperId: null, kpNodeId: null, unitSeq: 3 },
      ])
      .expect(200);
    await post(`/lessons/${lesson.id}/publish`, teacherAt).expect(200);
    const detail = await get(`/lessons/${lesson.id}`, teacherAt).expect(200);
    const sessionId = detail.body.data.sessionId as number;
    expect(sessionId).not.toBeNull();

    const snap = await new Promise<any>((resolve, reject) => {
      const s = ioc(`http://127.0.0.1:${port}/classroom`, { auth: { token: studentAt }, transports: ['websocket'], reconnection: false });
      s.on('connect_error', (e) => reject(e));
      s.on('connect', () => s.emit('class:join', { sessionId }, (x: unknown) => { s.close(); resolve(x); }));
      setTimeout(() => reject(new Error('join timeout')), 8000);
    });
    const pages = snap.courseware as { title: string; body: string; resource?: { type: string; name: string; url: string } }[];
    expect(pages).toHaveLength(2); // image 直链页 + 结构化 1 页;ai_courseware 排除
    const imgPage = pages.find((p) => p.resource);
    expect(imgPage).toBeDefined();
    expect(imgPage!.title).toBe('WALK 课件图');
    expect(imgPage!.resource).toEqual({ type: 'image', name: 'WALK 课件图', url: expect.stringContaining('/api/v1/storage/') });
    const file = await request(http).get(String(imgPage!.resource!.url).replace(/^https?:\/\/[^/]+/, '')).expect(200);
    expect(file.headers['content-type']).toMatch(/^image\/png/);
    const structuredPage = pages.find((p) => !p.resource);
    expect(structuredPage).toEqual({ title: '第一页', body: '正文', narration: '' });
    // 会话 / 参与者随 dropWalkOrg 清理
  });
});
