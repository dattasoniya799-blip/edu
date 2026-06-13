/**
 * 验收覆盖(任务卡 A3 · 知识图谱只读):
 * - /kp/graphs 三类图谱节点数与 IMPORT_REPORT.md 对账一致
 * - /kp/nodes?graphId=教材&chapter=一次函数 数量与导入报告(源文件)对账一致
 * - grade 过滤数量与报告"年级分布"一致;keyword 过滤;graphId 必填(400)
 * - 角色门禁(student 403 / 无 token 401);跨租户 graphId → 404(宪法 §7)
 */
import { INestApplication } from '@nestjs/common';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import request from 'supertest';
import { A3_PASSWORD, A3Fixture, createA3Org, dropA3Org } from './fixtures/a3.fixtures';
import { createApp, loginStudentById, raw } from './fixtures/setup';

const SEED_TEACHER = { phone: '13800000002', password: 'Teacher@123' };

// ---- 对账数据源:IMPORT_REPORT.md 与教材图谱源 JSON ----
const DATA_DIR = resolve(__dirname, '../../../data/knowledge-graphs');
const report = readFileSync(resolve(DATA_DIR, 'IMPORT_REPORT.md'), 'utf8');
const pepSource = JSON.parse(readFileSync(resolve(DATA_DIR, 'math_junior_pep_v1.json'), 'utf8')) as {
  nodes: { name: string; grade?: string; chapter?: string }[];
};

/** 从报告中取某图谱的"入库节点数" */
function reportNodeCount(graphFile: string): number {
  const section = report.split(/^## /m).find((s) => s.startsWith(graphFile));
  const m = section?.match(/节点: 源文件 \d+ → 入库 (\d+)/);
  if (!m) throw new Error(`IMPORT_REPORT.md 缺少 ${graphFile} 的节点对账行`);
  return Number(m[1]);
}

/** 从报告中取教材图谱的年级分布 */
function reportGradeDist(graphFile: string): Record<string, number> {
  const section = report.split(/^## /m).find((s) => s.startsWith(graphFile));
  const m = section?.match(/年级分布: (.+)/);
  if (!m) throw new Error(`IMPORT_REPORT.md 缺少 ${graphFile} 的年级分布行`);
  const dist: Record<string, number> = {};
  for (const [, grade, count] of m[1].matchAll(/([^\s:]+):(\d+)/g)) dist[grade] = Number(count);
  return dist;
}

describe('知识图谱只读(A3)', () => {
  let app: INestApplication;
  let http: any;
  let teacherAt: string;
  let fx: A3Fixture;
  let fxTeacherAt: string;
  let studentAt: string;
  let graphsByCode: Record<string, { id: number; graphType: string; nodeCount: number }>;

  const login = async (phone: string, password: string) => {
    const res = await request(http).post('/api/v1/auth/login').send({ phone, password }).expect(200);
    return res.body.data.accessToken as string;
  };

  beforeAll(async () => {
    app = await createApp();
    http = app.getHttpServer();
    teacherAt = await login(SEED_TEACHER.phone, SEED_TEACHER.password);

    fx = await createA3Org();
    fxTeacherAt = await login(fx.teacherAPhone, A3_PASSWORD);
    studentAt = await loginStudentById(http, fx.studentId);

    const res = await request(http).get('/api/v1/kp/graphs').set('Authorization', `Bearer ${teacherAt}`).expect(200);
    graphsByCode = Object.fromEntries(res.body.data.map((g: any) => [g.code, g]));
  });

  afterAll(async () => {
    await dropA3Org(fx.orgId);
    await raw.$disconnect();
    await app.close();
  });

  it('/kp/graphs:三类图谱节点数与 IMPORT_REPORT.md 入库数一致', () => {
    expect(graphsByCode['math_junior_pep_v1']).toMatchObject({
      graphType: 'curriculum_knowledge',
      subject: '数学',
      nodeCount: reportNodeCount('math_junior_pep_v1.json'),
    });
    expect(graphsByCode['math_junior_ability_v1'].nodeCount).toBe(reportNodeCount('math_junior_ability_v1.json'));
    expect(graphsByCode['math_junior_strategy_v1'].nodeCount).toBe(reportNodeCount('math_junior_strategy_v1.json'));
  });

  it('教材图谱按章节"一次函数"查询:数量与导入源文件一致(验收项)', async () => {
    const expected = pepSource.nodes.filter((n) => (n.chapter ?? '').includes('一次函数')).length;
    expect(expected).toBeGreaterThan(0);

    const res = await request(http)
      .get('/api/v1/kp/nodes')
      .query({ graphId: graphsByCode['math_junior_pep_v1'].id, chapter: '一次函数' })
      .set('Authorization', `Bearer ${teacherAt}`)
      .expect(200);
    expect(res.body.data).toHaveLength(expected);
    for (const n of res.body.data) {
      expect(n.chapter).toContain('一次函数');
      expect(n.graphId).toBe(graphsByCode['math_junior_pep_v1'].id);
      // KpNode 契约字段齐全
      for (const k of ['id', 'code', 'name', 'parentCode', 'level', 'category', 'grade', 'chapter', 'section', 'difficulty', 'examWeight', 'summary'])
        expect(n).toHaveProperty(k);
    }
  });

  it('grade 过滤:初一/初二/初三数量与报告"年级分布"一致', async () => {
    const dist = reportGradeDist('math_junior_pep_v1.json');
    for (const grade of ['初一', '初二', '初三']) {
      const res = await request(http)
        .get('/api/v1/kp/nodes')
        .query({ graphId: graphsByCode['math_junior_pep_v1'].id, grade })
        .set('Authorization', `Bearer ${teacherAt}`)
        .expect(200);
      expect(res.body.data).toHaveLength(dist[grade]);
    }
  });

  it('keyword 过滤:命中名称包含关键词的节点(与源文件一致)', async () => {
    const expected = pepSource.nodes.filter((n) => n.name.includes('一次函数')).length;
    const res = await request(http)
      .get('/api/v1/kp/nodes')
      .query({ graphId: graphsByCode['math_junior_pep_v1'].id, keyword: '一次函数' })
      .set('Authorization', `Bearer ${teacherAt}`)
      .expect(200);
    expect(res.body.data).toHaveLength(expected);
    for (const n of res.body.data) expect(n.name).toContain('一次函数');
  });

  it('graphId 必填:缺省 → 400', async () => {
    const res = await request(http).get('/api/v1/kp/nodes').set('Authorization', `Bearer ${teacherAt}`).expect(400);
    expect(res.body.code).toBe(400);
  });

  it('跨租户:他 org 的 graphId → 404;/kp/graphs 只见本 org 图谱(宪法 §7)', async () => {
    await request(http)
      .get('/api/v1/kp/nodes')
      .query({ graphId: graphsByCode['math_junior_pep_v1'].id })
      .set('Authorization', `Bearer ${fxTeacherAt}`)
      .expect(404);

    const own = await request(http).get('/api/v1/kp/graphs').set('Authorization', `Bearer ${fxTeacherAt}`).expect(200);
    expect(own.body.data.map((g: any) => g.code).sort()).toEqual(['a3_ability_mini', 'a3_pep_mini']);

    // 不存在的 graphId 同样 404
    await request(http)
      .get('/api/v1/kp/nodes')
      .query({ graphId: 99999999 })
      .set('Authorization', `Bearer ${teacherAt}`)
      .expect(404);
  });

  it('角色门禁:student → 403;无 token → 401', async () => {
    await request(http).get('/api/v1/kp/graphs').set('Authorization', `Bearer ${studentAt}`).expect(403);
    await request(http).get('/api/v1/kp/graphs').expect(401);
  });
});
