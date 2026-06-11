/**
 * 验收覆盖(任务卡 A1):
 * - 两机构互查任何资源 → 404(临时建第二机构数据)
 * - teacher 调 /admin/* → 403;admin → 200
 * - 无租户上下文的查询被机制性拒绝
 */
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { runAsUser } from '../src/common/tenant-context';
import { createApp, createOrg2, dropOrg2, raw, Org2Fixture } from './fixtures/setup';

const SEED_ADMIN = { phone: '13800000001', password: 'Admin@123' };
const SEED_TEACHER = { phone: '13800000002', password: 'Teacher@123' };

describe('多租户 + RBAC(A1)', () => {
  let app: INestApplication;
  let http: any;
  let org2: Org2Fixture;
  let org1AdminAt: string;
  let org1TeacherAt: string;
  let org2AdminAt: string;

  const login = async (phone: string, password: string) => {
    const res = await request(http).post('/api/v1/auth/login').send({ phone, password }).expect(200);
    return res.body.data.accessToken as string;
  };

  beforeAll(async () => {
    app = await createApp();
    http = app.getHttpServer();
    org2 = await createOrg2();
    org1AdminAt = await login(SEED_ADMIN.phone, SEED_ADMIN.password);
    org1TeacherAt = await login(SEED_TEACHER.phone, SEED_TEACHER.password);
    org2AdminAt = await login(org2.adminPhone, org2.password);
  });

  afterAll(async () => {
    await dropOrg2(org2.orgId);
    await raw.$disconnect();
    await app.close();
  });

  it('teacher 调 /admin/* → 403;admin → 200', async () => {
    const denied = await request(http)
      .get('/api/v1/admin/__probe')
      .set('Authorization', `Bearer ${org1TeacherAt}`)
      .expect(403);
    expect(denied.body.code).toBe(403);

    await request(http)
      .get('/api/v1/admin/__probe')
      .set('Authorization', `Bearer ${org1AdminAt}`)
      .expect(200);
  });

  it('无 token 调 /admin/* → 401', async () => {
    await request(http).get('/api/v1/admin/__probe').expect(401);
  });

  it('两机构互查资源 → 404(org1 查 org2 的用户,反向同理)', async () => {
    // org1 管理员查 org2 学生 → 404
    await request(http)
      .get(`/api/v1/__probe/users/${org2.studentId}`)
      .set('Authorization', `Bearer ${org1AdminAt}`)
      .expect(404);

    // org2 管理员查 org1 的 seed 管理员 → 404
    const org1Admin = await raw.user.findFirst({ where: { phone: SEED_ADMIN.phone, role: 'admin' } });
    await request(http)
      .get(`/api/v1/__probe/users/${org1Admin!.id}`)
      .set('Authorization', `Bearer ${org2AdminAt}`)
      .expect(404);

    // 本机构自查 → 200(证明 404 是租户隔离而非接口问题)
    const ok = await request(http)
      .get(`/api/v1/__probe/users/${org2.studentId}`)
      .set('Authorization', `Bearer ${org2AdminAt}`)
      .expect(200);
    expect(ok.body.data.id).toBe(Number(org2.studentId));
  });

  it('租户注入:create 自动填充 org_id;Org 表只能读到本机构', async () => {
    const prisma = app.get(PrismaService);
    await runAsUser({ uid: Number(org2.adminId), orgId: Number(org2.orgId), role: 'admin' }, async () => {
      // findMany 自动 where org_id:看不到 org1 的 12 名 seed 学生
      const students = await prisma.client.user.findMany({ where: { role: 'student' } });
      expect(students.every((s: { orgId: bigint }) => s.orgId === org2.orgId)).toBe(true);

      // Org 表限定 id = 当前 org
      const orgs = await prisma.client.org.findMany();
      expect(orgs.map((o: { id: bigint }) => Number(o.id))).toEqual([Number(org2.orgId)]);

      // create 自动填充 org_id(不显式传 orgId)
      const created = await prisma.client.auditLog.create({
        // 故意不传 orgId,验证扩展自动填充(类型上 orgId 必填,运行时由注入补齐)
        data: { actorId: org2.adminId, action: 'e2e.tenant_check' } as never,
      });
      expect(created.orgId).toBe(org2.orgId);
    });
  });

  it('无租户上下文的查询被机制性拒绝(禁止绕过注入)', async () => {
    const prisma = app.get(PrismaService);
    await expect(prisma.client.user.findMany()).rejects.toThrow(/无租户上下文/);
  });
});
