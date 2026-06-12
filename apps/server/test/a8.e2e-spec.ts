/**
 * 验收覆盖(任务卡 A8 · 学情与 AI 账单聚合):
 * - 课程掌握热力:只取 curriculum 维度,数字 = 夹具手算账本,且与测试内独立重算(raw 对账)一致;
 *   ability 维度节点不得出现;quit / 未选课学生不入聚合。
 * - 重点关注:任一 curriculum 节点 mastery<60 或 7 日未活跃,reason 文案化(两类原因可叠加)。
 * - 单生 30 天报告:mastery 全维度 + wrongOpenCount + attempts30d,与手算一致。
 * - seed 数据对账:seed 课程热力 / 关注名单 / 学生报告 → 测试内按口径独立重算逐项比对。
 * - 空数据课程返回空数组而非报错;跨租户 404 + 角色门禁(宪法 §7)。
 * - /admin/ai-usage/*:A2 已完整实现并在 admin.e2e-spec 对账通过,本套件不重复(边界裁定)。
 */
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { A8_PASSWORD, A8Fixture, createA8Org, dropA8Org } from './fixtures/a8.fixtures';
import { createApp, makeTicket, raw } from './fixtures/setup';

const exactKeys = (obj: object, keys: string[]) =>
  expect(Object.keys(obj).sort()).toEqual([...keys].sort());

const HEAT_KEYS = ['nodeId', 'nodeName', 'avgMastery', 'studentCount'];
const ATTENTION_KEYS = ['studentId', 'name', 'reason'];
const REPORT_KEYS = ['mastery', 'wrongOpenCount', 'attempts30d'];
const MASTERY_ITEM_KEYS = ['nodeId', 'nodeName', 'graphType', 'mastery', 'sampleCount'];

const DAY = 86400_000;
/** 独立实现的 UTC 日对齐窗口(与实现无共享代码,对账用) */
const utcDayStart = (d = new Date()) =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
const daysAgo = (n: number) => new Date(utcDayStart().getTime() - n * DAY);

/** 课程热力独立重算:active 选课学生 × curriculum 快照 → 按节点 avg/count(口径=任务卡) */
async function expectedCourseMastery(courseId: bigint) {
  const enrolled = await raw.courseStudent.findMany({
    where: { courseId, status: 'active' },
    select: { studentId: true },
  });
  const ids = enrolled.map((e) => e.studentId);
  if (!ids.length) return [];
  const snaps = await raw.masterySnapshot.findMany({
    where: { studentId: { in: ids }, node: { graph: { graphType: 'curriculum_knowledge' } } },
    include: { node: { select: { name: true } } },
  });
  const byNode = new Map<string, { nodeId: bigint; nodeName: string; sum: number; count: number }>();
  for (const s of snaps) {
    const k = String(s.nodeId);
    const cur = byNode.get(k) ?? { nodeId: s.nodeId, nodeName: s.node.name, sum: 0, count: 0 };
    cur.sum += s.mastery;
    cur.count += 1;
    byNode.set(k, cur);
  }
  return [...byNode.values()]
    .sort((a, b) => Number(a.nodeId - b.nodeId))
    .map((n) => ({
      nodeId: Number(n.nodeId),
      nodeName: n.nodeName,
      avgMastery: Math.round(n.sum / n.count),
      studentCount: n.count,
    }));
}

/** 重点关注独立重算(只算「应入列学生集合」,reason 文案由专项用例验证) */
async function expectedAttentionIds(courseId: bigint): Promise<number[]> {
  const enrolled = await raw.courseStudent.findMany({
    where: { courseId, status: 'active' },
    select: { studentId: true },
  });
  const ids = enrolled.map((e) => e.studentId);
  if (!ids.length) return [];
  const [low, active] = await Promise.all([
    raw.masterySnapshot.findMany({
      where: {
        studentId: { in: ids },
        mastery: { lt: 60 },
        node: { graph: { graphType: 'curriculum_knowledge' } },
      },
      select: { studentId: true },
    }),
    raw.attempt.findMany({
      where: {
        studentId: { in: ids },
        OR: [{ startedAt: { gte: daysAgo(7) } }, { submittedAt: { gte: daysAgo(7) } }],
      },
      select: { studentId: true },
    }),
  ]);
  const lowSet = new Set(low.map((x) => String(x.studentId)));
  const activeSet = new Set(active.map((x) => String(x.studentId)));
  return ids
    .filter((id) => lowSet.has(String(id)) || !activeSet.has(String(id)))
    .map(Number)
    .sort((a, b) => a - b);
}

describe('学情聚合(A8)', () => {
  let app: INestApplication;
  let http: any;
  let fx: A8Fixture;
  let teacher: string;
  let admin: string;
  let student: string;
  let teacherB: string;
  let adminB: string;

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const login = async (phone: string, password: string) => {
    const res = await request(http).post('/api/v1/auth/login').send({ phone, password }).expect(200);
    return res.body.data.accessToken as string;
  };
  const studentLogin = async (orgId: bigint, sid: bigint, fp: string) => {
    const ticket = await makeTicket(orgId, sid);
    const res = await request(http)
      .post('/api/v1/auth/student/qr-exchange')
      .send({ token: ticket, deviceFingerprint: fp, deviceName: 'A8 测试平板' })
      .expect(200);
    return res.body.data.accessToken as string;
  };
  const get = (url: string, token: string) => request(http).get(`/api/v1${url}`).set(auth(token));

  beforeAll(async () => {
    app = await createApp();
    http = app.getHttpServer();
    fx = await createA8Org();
    teacher = await login(fx.teacherPhone, A8_PASSWORD);
    admin = await login(fx.adminPhone, A8_PASSWORD);
    student = await studentLogin(fx.orgId, fx.s1Id, 'a8-fp-1');
    teacherB = await login(fx.teacherBPhone, A8_PASSWORD);
    adminB = await login(fx.adminBPhone, A8_PASSWORD);
  });

  afterAll(async () => {
    await app.close();
    await dropA8Org(fx.orgId, fx.orgBId);
    await raw.$disconnect();
  });

  // ================= 课程掌握热力 =================

  it('验收:课程热力 = 手算账本(N1 avg70/3人,N2 avg45/1人),只含 curriculum 维度,quit/未选课不入聚合', async () => {
    const res = await get(`/analytics/courses/${fx.courseId}/mastery`, teacher).expect(200);
    const data = res.body.data;
    // 手算:N1=(80+40+90)/3=70(s3 quit 的 10、s4 未选课的 99 不参与);N2 仅 s1 的 45
    expect(data).toEqual([
      { nodeId: Number(fx.node1Id), nodeName: 'A8·一次函数概念', avgMastery: 70, studentCount: 3 },
      { nodeId: Number(fx.node2Id), nodeName: 'A8·图象平移', avgMastery: 45, studentCount: 1 },
    ]);
    for (const item of data) exactKeys(item, HEAT_KEYS);
    // ability 维度节点(M1,s1 有 30 分快照)不得出现
    expect(data.some((d: any) => d.nodeId === Number(fx.nodeM1Id))).toBe(false);
    // 测试内独立重算对账(raw,无共享代码)
    expect(data).toEqual(await expectedCourseMastery(fx.courseId));
  });

  it('验收:空数据课程 → mastery/attention 均返回空数组而非报错', async () => {
    const heat = await get(`/analytics/courses/${fx.emptyCourseId}/mastery`, teacher).expect(200);
    expect(heat.body.data).toEqual([]);
    const attention = await get(`/analytics/courses/${fx.emptyCourseId}/attention`, teacher).expect(200);
    expect(attention.body.data).toEqual([]);
  });

  // ================= 重点关注 =================

  it('验收:重点关注 —— s1(curriculum 节点<60)、s2(<60 且 7 日未活跃,双原因叠加),s5 不入列;reason 文案化', async () => {
    const res = await get(`/analytics/courses/${fx.courseId}/attention`, teacher).expect(200);
    const data = res.body.data;
    expect(data).toEqual([
      { studentId: Number(fx.s1Id), name: 'A8学生一', reason: '「A8·图象平移」掌握度 45,低于 60' },
      {
        studentId: Number(fx.s2Id),
        name: 'A8学生二',
        reason: '「A8·一次函数概念」掌握度 40,低于 60;近 7 日未活跃',
      },
    ]);
    for (const item of data) exactKeys(item, ATTENTION_KEYS);
    // s1 的 ability 维度 M1=30 不触发规则(只看 curriculum);s5(90 分且 2 天前作答)不入列
    expect(data.some((d: any) => d.studentId === Number(fx.s5Id))).toBe(false);
    // 入列集合与独立重算一致
    expect(data.map((d: any) => d.studentId)).toEqual(await expectedAttentionIds(fx.courseId));
  });

  // ================= 单生 30 天报告 =================

  it('验收:单生 30 天报告 —— mastery 全维度 3 条 + wrongOpenCount=2 + attempts30d=1(40 天前的不计)', async () => {
    const res = await get(`/analytics/students/${fx.s1Id}`, teacher).expect(200);
    const data = res.body.data;
    exactKeys(data, REPORT_KEYS);
    expect(data.mastery).toEqual([
      { nodeId: Number(fx.node1Id), nodeName: 'A8·一次函数概念', graphType: 'curriculum_knowledge', mastery: 80, sampleCount: 5 },
      { nodeId: Number(fx.node2Id), nodeName: 'A8·图象平移', graphType: 'curriculum_knowledge', mastery: 45, sampleCount: 4 },
      { nodeId: Number(fx.nodeM1Id), nodeName: 'A8·运算能力', graphType: 'problem_solving_ability', mastery: 30, sampleCount: 2 },
    ]);
    for (const item of data.mastery) exactKeys(item, MASTERY_ITEM_KEYS);
    expect(data.wrongOpenCount).toBe(2); // 2 open + 1 cleared
    expect(data.attempts30d).toBe(1); // 1 天前的计入,40 天前的在窗口外
    // admin 同样可读(openapi [teacher/admin])
    const asAdmin = await get(`/analytics/students/${fx.s1Id}`, admin).expect(200);
    expect(asAdmin.body.data).toEqual(data);
  });

  // ================= seed 数据对账(只读) =================

  it('验收:seed 课程「初二数学提高班」热力/关注/学生报告 → 与测试内独立重算逐项一致', async () => {
    const seedCourse = await raw.course.findFirstOrThrow({ where: { name: '初二数学提高班' } });
    const seedTeacher = await login('13800000002', 'Teacher@123');

    // 热力对账(seed 写入 144 条快照,curriculum 维度逐节点 avg/count)
    const heat = await get(`/analytics/courses/${seedCourse.id}/mastery`, seedTeacher).expect(200);
    const expectedHeat = await expectedCourseMastery(seedCourse.id);
    expect(expectedHeat.length).toBeGreaterThan(0); // seed 数据非空,对账有效
    expect(heat.body.data).toEqual(expectedHeat);

    // 关注名单对账(入列集合;文案抽查关键字)
    const attention = await get(`/analytics/courses/${seedCourse.id}/attention`, seedTeacher).expect(200);
    expect(attention.body.data.map((d: any) => d.studentId)).toEqual(
      await expectedAttentionIds(seedCourse.id),
    );
    for (const item of attention.body.data) {
      exactKeys(item, ATTENTION_KEYS);
      expect(item.reason).toMatch(/低于 60|未活跃/);
    }

    // 单生报告对账:取 seed 第一名学生,逐节点 + 计数与 raw 重算一致
    const seedStudent = await raw.user.findFirstOrThrow({
      where: { orgId: seedCourse.orgId, role: 'student', deletedAt: null },
      orderBy: { id: 'asc' },
    });
    const report = await get(`/analytics/students/${seedStudent.id}`, seedTeacher).expect(200);
    const snaps = await raw.masterySnapshot.findMany({
      where: { studentId: seedStudent.id },
      include: { node: { select: { name: true, graph: { select: { graphType: true } } } } },
      orderBy: { nodeId: 'asc' },
    });
    expect(report.body.data.mastery).toEqual(
      snaps.map((m) => ({
        nodeId: Number(m.nodeId),
        nodeName: m.node.name,
        graphType: m.node.graph.graphType,
        mastery: m.mastery,
        sampleCount: m.sampleCount,
      })),
    );
    expect(report.body.data.wrongOpenCount).toBe(
      await raw.wrongBookEntry.count({ where: { studentId: seedStudent.id, status: 'open' } }),
    );
    expect(report.body.data.attempts30d).toBe(
      await raw.attempt.count({
        where: { studentId: seedStudent.id, startedAt: { gte: daysAgo(30) } },
      }),
    );
  });

  // ================= 跨租户 404 + 角色门禁(宪法 §7) =================

  it('跨租户互查 → 404(宪法 §7):课程热力/关注/学生报告双向全覆盖', async () => {
    await get(`/analytics/courses/${fx.courseId}/mastery`, teacherB).expect(404);
    await get(`/analytics/courses/${fx.courseId}/attention`, teacherB).expect(404);
    await get(`/analytics/students/${fx.s1Id}`, teacherB).expect(404);
    await get(`/analytics/students/${fx.s1Id}`, adminB).expect(404);
    // 反向:机构A 教师查机构B 学生
    await get(`/analytics/students/${fx.studentBId}`, teacher).expect(404);
  });

  it('角色门禁:student 全部 403;admin 调课程热力/关注 → 403(openapi [teacher]);无 token → 401', async () => {
    await get(`/analytics/courses/${fx.courseId}/mastery`, student).expect(403);
    await get(`/analytics/courses/${fx.courseId}/attention`, student).expect(403);
    await get(`/analytics/students/${fx.s1Id}`, student).expect(403);
    await get(`/analytics/courses/${fx.courseId}/mastery`, admin).expect(403);
    await get(`/analytics/courses/${fx.courseId}/attention`, admin).expect(403);
    await request(http).get(`/api/v1/analytics/courses/${fx.courseId}/mastery`).expect(401);
  });

  it('404:不存在的课程;以教师 id 查学生报告(非 student)→ 404', async () => {
    await get('/analytics/courses/99999999/mastery', teacher).expect(404);
    await get('/analytics/courses/99999999/attention', teacher).expect(404);
    await get('/analytics/students/99999999', teacher).expect(404);
    await get(`/analytics/students/${fx.teacherId}`, teacher).expect(404);
  });
});
