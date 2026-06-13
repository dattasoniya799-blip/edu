/**
 * 验收覆盖(任务卡 A3 · 题库):
 * - 录入含 LaTeX/figures/rubric 的 solution 题 → 读取逐字段无损
 * - create 校验:选择题 options 必填且正确项数量合法;解答题 rubric 必填;
 *   tagNodeIds 至少含 1 个 curriculum_knowledge 节点
 * - 非 owner 改他人题 403(admin 可改);publish 草稿→published
 * - 组卷引用后删除 → HTTP 409 + 业务码 4301;软删后不可见
 * - 跨租户读他 org 题目 → 404(宪法 §7);student 访问题库 → 403
 */
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { A3_PASSWORD, A3Fixture, createA3Org, dropA3Org } from './fixtures/a3.fixtures';
import { createApp, loginStudentById, raw } from './fixtures/setup';

const SEED_TEACHER = { phone: '13800000002', password: 'Teacher@123' };

describe('题库 CRUD(A3)', () => {
  let app: INestApplication;
  let http: any;
  let fx: A3Fixture;
  let teacherA: string; // 出题人
  let teacherB: string; // 非 owner
  let admin: string;
  let student: string;
  let seedTeacherAt: string; // org1,用于跨租户用例
  let tagNodeIds: number[];

  const login = async (phone: string, password: string) => {
    const res = await request(http).post('/api/v1/auth/login').send({ phone, password }).expect(200);
    return res.body.data.accessToken as string;
  };
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  /** 含 LaTeX/figures/rubric 的解答题(验收:逐字段无损) */
  const solutionPayload = () => ({
    type: 'solution',
    stage: '初中',
    subject: '数学',
    textbookVersion: '人教版',
    chapter: '第十九章 一次函数',
    stemLatex:
      '已知一次函数 $y=kx+b$ 的图象经过点 $A(1,3)$ 与 $B(-1,-1)$,求 $\\frac{k+b}{2}$ 的值,并在坐标系中画出图象。',
    figures: [
      { ossKey: 'question_figure/a3/fig-axis.png', position: 1 },
      { ossKey: 'question_figure/a3/fig-line.png', position: 2 },
    ],
    answer: {
      referenceLatex:
        '由 $\\begin{cases}k+b=3\\\\-k+b=-1\\end{cases}$ 解得 $k=2,\\ b=1$,故 $\\frac{k+b}{2}=\\frac{3}{2}$。',
    },
    rubric: [
      { step: 1, desc: '由两点坐标列出方程组', score: 3 },
      { step: 2, desc: '解出 $k=2,b=1$', score: 4 },
      { step: 3, desc: '求值 $\\frac{3}{2}$ 并正确作图', score: 3 },
    ],
    analysisLatex: '考查待定系数法;注意转义字符 \\alpha\\beta 与换行 \\\\ 原样保存。',
    difficulty: 3,
    tagNodeIds,
  });

  /** 合法单选题 */
  const singlePayload = () => ({
    type: 'single',
    stage: '初中',
    subject: '数学',
    stemLatex: '将直线 $y=2x+1$ 向下平移 $3$ 个单位,所得直线的解析式为(  )',
    options: [
      { label: 'A', contentLatex: '$y=2x+4$', isCorrect: false },
      { label: 'B', contentLatex: '$y=2x-2$', isCorrect: true },
      { label: 'C', contentLatex: '$y=5x+1$', isCorrect: false },
      { label: 'D', contentLatex: '$y=-x+1$', isCorrect: false },
    ],
    answer: { choice: 'B' },
    difficulty: 1,
    tagNodeIds,
  });

  beforeAll(async () => {
    app = await createApp();
    http = app.getHttpServer();
    fx = await createA3Org();
    tagNodeIds = [Number(fx.pepNodeIds[0]), Number(fx.pepNodeIds[2]), Number(fx.abilityNodeId)];

    [teacherA, teacherB, admin, seedTeacherAt] = await Promise.all([
      login(fx.teacherAPhone, A3_PASSWORD),
      login(fx.teacherBPhone, A3_PASSWORD),
      login(fx.adminPhone, A3_PASSWORD),
      login(SEED_TEACHER.phone, SEED_TEACHER.password),
    ]);
    student = await loginStudentById(http, fx.studentId);
  });

  afterAll(async () => {
    await dropA3Org(fx.orgId);
    await raw.$disconnect();
    await app.close();
  });

  // ---------------- 验收:LaTeX/figures/rubric 无损 ----------------

  it('录入含 LaTeX/figures/rubric 的 solution 题 → 读取逐字段无损(验收项)', async () => {
    const payload = solutionPayload();
    const created = await request(http).post('/api/v1/questions').set(auth(teacherA)).send(payload).expect(200);
    const id = created.body.data.id;
    expect(created.body.code).toBe(0);
    expect(created.body.data.status).toBe('draft');

    const res = await request(http).get(`/api/v1/questions/${id}`).set(auth(teacherA)).expect(200);
    const q = res.body.data;
    // 逐字段对照(LaTeX 反斜杠、figures、rubric、answer 原样还原)
    expect(q.type).toBe(payload.type);
    expect(q.stage).toBe(payload.stage);
    expect(q.subject).toBe(payload.subject);
    expect(q.textbookVersion).toBe(payload.textbookVersion);
    expect(q.chapter).toBe(payload.chapter);
    expect(q.stemLatex).toBe(payload.stemLatex);
    expect(q.figures).toEqual(payload.figures);
    expect(q.answer).toEqual(payload.answer);
    expect(q.rubric).toEqual(payload.rubric);
    expect(q.analysisLatex).toBe(payload.analysisLatex);
    expect(q.difficulty).toBe(payload.difficulty);
    expect(q.status).toBe('draft');
    expect(q.options).toEqual([]);
    expect(q.ownerName).toBe('A3教师甲');
    expect(q.stats).toEqual({ correctRate: null, usedInPapers: 0 });
    // 三维标签:nodeId + graphType 正确
    expect(new Set(q.tags.map((t: any) => t.nodeId))).toEqual(new Set(tagNodeIds));
    expect(q.tags.find((t: any) => t.nodeId === Number(fx.abilityNodeId)).graphType).toBe('problem_solving_ability');
    expect(q.tags.filter((t: any) => t.graphType === 'curriculum_knowledge')).toHaveLength(2);
  });

  // ---------------- create 校验 ----------------

  it('create 校验:选择题 options/正确项数量、解答题 rubric、教材知识点标签', async () => {
    const post = (body: object) => request(http).post('/api/v1/questions').set(auth(teacherA)).send(body);

    // 单选缺 options → 400
    await post({ ...singlePayload(), options: undefined }).expect(400);
    // 单选 2 个正确项 → 400
    const twoCorrect = singlePayload();
    twoCorrect.options[0].isCorrect = true;
    await post(twoCorrect).expect(400);
    // 多选仅 1 个正确项 → 400
    await post({ ...singlePayload(), type: 'multi', answer: { choices: ['B'] } }).expect(400);
    // 解答题缺 rubric → 400
    await post({ ...solutionPayload(), rubric: undefined }).expect(400);
    await post({ ...solutionPayload(), rubric: [] }).expect(400);
    // 标签缺失 / 不含教材知识点 → 400
    await post({ ...solutionPayload(), tagNodeIds: undefined }).expect(400);
    const onlyAbility = await post({ ...solutionPayload(), tagNodeIds: [Number(fx.abilityNodeId)] }).expect(400);
    expect(onlyAbility.body.message).toContain('教材知识点');
    // 引用他 org 节点 → 400(租户注入下视同不存在)
    const org1Node = await raw.kpNode.findFirst({ where: { graph: { code: 'math_junior_pep_v1' } } });
    await post({ ...solutionPayload(), tagNodeIds: [Number(org1Node!.id)] }).expect(400);
    // answer 形状与题型不符 → 400
    await post({ ...singlePayload(), answer: { texts: ['B'] } }).expect(400);
  });

  // ---------------- publish ----------------

  it('publish:草稿 → published;重复入库 → 400', async () => {
    const id = (await request(http).post('/api/v1/questions').set(auth(teacherA)).send(singlePayload()).expect(200))
      .body.data.id;
    await request(http).post(`/api/v1/questions/${id}/publish`).set(auth(teacherA)).expect(200);
    const detail = await request(http).get(`/api/v1/questions/${id}`).set(auth(teacherA)).expect(200);
    expect(detail.body.data.status).toBe('published');
    await request(http).post(`/api/v1/questions/${id}/publish`).set(auth(teacherA)).expect(400);
  });

  // ---------------- 权限:owner / admin ----------------

  it('非 owner 改他人题 → 403;admin 可改(验收项)', async () => {
    const id = (await request(http).post('/api/v1/questions').set(auth(teacherA)).send(solutionPayload()).expect(200))
      .body.data.id;

    const denied = await request(http)
      .put(`/api/v1/questions/${id}`)
      .set(auth(teacherB))
      .send({ ...solutionPayload(), stemLatex: '教师乙试图篡改' })
      .expect(403);
    expect(denied.body.code).toBe(403);

    const adminEdit = { ...solutionPayload(), stemLatex: '管理员修订后的题干 $\\sqrt{2}$', difficulty: 2 };
    await request(http).put(`/api/v1/questions/${id}`).set(auth(admin)).send(adminEdit).expect(200);
    const after = (await request(http).get(`/api/v1/questions/${id}`).set(auth(teacherA)).expect(200)).body.data;
    expect(after.stemLatex).toBe(adminEdit.stemLatex);
    expect(after.difficulty).toBe(2);
    expect(after.ownerName).toBe('A3教师甲'); // owner 不因 admin 修改而变

    // 非 owner 删除 / 入库同样 403
    await request(http).delete(`/api/v1/questions/${id}`).set(auth(teacherB)).expect(403);
    await request(http).post(`/api/v1/questions/${id}/publish`).set(auth(teacherB)).expect(403);
  });

  // ---------------- 删除:软删 + 4301 ----------------

  it('组卷引用后删除 → HTTP 409 + 业务码 4301;解除引用后软删成功(验收项)', async () => {
    const id = (await request(http).post('/api/v1/questions').set(auth(teacherA)).send(singlePayload()).expect(200))
      .body.data.id;
    const paper = await raw.paper.create({
      data: { orgId: fx.orgId, creatorId: fx.teacherAId, name: 'A3 引用测试卷', type: 'practice' },
    });
    await raw.paperQuestion.create({
      data: { orgId: fx.orgId, paperId: paper.id, questionId: BigInt(id), seq: 1, score: 5 },
    });

    const blocked = await request(http).delete(`/api/v1/questions/${id}`).set(auth(teacherA)).expect(409);
    expect(blocked.body.code).toBe(4301); // ErrResp.code 为业务码
    // 详情统计可见被引用次数
    const detail = await request(http).get(`/api/v1/questions/${id}`).set(auth(teacherA)).expect(200);
    expect(detail.body.data.stats.usedInPapers).toBe(1);

    await raw.paperQuestion.deleteMany({ where: { paperId: paper.id } });
    await raw.paper.delete({ where: { id: paper.id } });

    await request(http).delete(`/api/v1/questions/${id}`).set(auth(teacherA)).expect(200);
    // 软删:接口不可见(404 / 列表排除),数据库行保留 deletedAt
    await request(http).get(`/api/v1/questions/${id}`).set(auth(teacherA)).expect(404);
    const list = await request(http).get('/api/v1/questions').set(auth(teacherA)).expect(200);
    expect(list.body.data.items.map((i: any) => i.id)).not.toContain(id);
    const row = await raw.question.findUnique({ where: { id: BigInt(id) } });
    expect(row).not.toBeNull();
    expect(row!.deletedAt).not.toBeNull();
  });

  // ---------------- 列表过滤 / 分页 ----------------

  it('列表:type/status/tagNodeId/keyword 过滤与分页', async () => {
    const list = async (query: object) =>
      (await request(http).get('/api/v1/questions').set(auth(teacherA)).query(query).expect(200)).body.data;

    const all = await list({});
    expect(all.total).toBeGreaterThanOrEqual(2);

    const solutions = await list({ type: 'solution' });
    expect(solutions.items.every((i: any) => i.type === 'solution')).toBe(true);
    expect(solutions.items.length).toBeGreaterThanOrEqual(1);

    const published = await list({ status: 'published' });
    expect(published.items.every((i: any) => i.status === 'published')).toBe(true);

    const byTag = await list({ tagNodeId: Number(fx.abilityNodeId) });
    expect(byTag.total).toBeGreaterThanOrEqual(1);
    expect(byTag.items.every((i: any) => i.tags.some((t: any) => t.nodeId === Number(fx.abilityNodeId)))).toBe(true);

    const byKeyword = await list({ keyword: '向下平移' });
    expect(byKeyword.items.every((i: any) => i.stemLatex.includes('向下平移'))).toBe(true);
    expect(byKeyword.total).toBeGreaterThanOrEqual(1);

    const page1 = await list({ page: 1, size: 1 });
    expect(page1.items).toHaveLength(1);
    expect(page1.total).toBe(all.total);
  });

  // ---------------- 跨租户 / 角色 ----------------

  it('跨租户读他 org 题目 → 404(宪法 §7);student 访问题库 → 403', async () => {
    const id = (await request(http).post('/api/v1/questions').set(auth(teacherA)).send(singlePayload()).expect(200))
      .body.data.id;
    await request(http).get(`/api/v1/questions/${id}`).set(auth(seedTeacherAt)).expect(404);
    await request(http).put(`/api/v1/questions/${id}`).set(auth(seedTeacherAt)).send(singlePayload()).expect(404);
    await request(http).delete(`/api/v1/questions/${id}`).set(auth(seedTeacherAt)).expect(404);

    await request(http).get('/api/v1/questions').set(auth(student)).expect(403);
    await request(http).post('/api/v1/questions').set(auth(student)).send(singlePayload()).expect(403);
    await request(http).get(`/api/v1/questions/${id}`).set(auth(student)).expect(403);
  });
});
