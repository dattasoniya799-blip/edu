/**
 * 验收覆盖(任务卡 A1):
 * - 管理员登录(13800000001/Admin@123)→ /me 返回 org settings
 * - 无 token → 401
 * - 学生 ticket 兑换成功且第二次失效;设备重复绑定被拒
 * - 刷新轮换(旧 refresh 重放 → 401);登出后 refresh 失效
 * - 修改密码(原密码错 → 401;改后新密码可登录);scrypt → argon2 静默升级
 */
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createApp, createOrg2, dropOrg2, makeTicket, raw, Org2Fixture } from './fixtures/setup';

const SEED_ADMIN = { phone: '13800000001', password: 'Admin@123' };

describe('认证(A1)', () => {
  let app: INestApplication;
  let http: any;
  let org2: Org2Fixture;

  beforeAll(async () => {
    app = await createApp();
    http = app.getHttpServer();
    org2 = await createOrg2();
  });

  afterAll(async () => {
    await dropOrg2(org2.orgId);
    await raw.$disconnect();
    await app.close();
  });

  it('healthz 免鉴权可用', async () => {
    const res = await request(http).get('/healthz').expect(200);
    expect(res.body.data.db).toBe(true);
    expect(res.body.data.redis).toBe(true);
  });

  it('管理员登录 → /me 返回 org settings', async () => {
    const login = await request(http)
      .post('/api/v1/auth/login')
      .send(SEED_ADMIN)
      .expect(200);
    expect(login.body.code).toBe(0);
    const { accessToken, refreshToken, me } = login.body.data;
    expect(accessToken).toBeTruthy();
    expect(refreshToken).toBeTruthy();
    expect(me.role).toBe('admin');

    const meRes = await request(http)
      .get('/api/v1/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    const data = meRes.body.data;
    expect(data.orgName).toBe('启明演示机构');
    expect(data.orgSettings.ai).toEqual({ qaGuideOnly: true, preGrading: true });
    expect(data.orgSettings.studentHours).toEqual({ start: '06:00', end: '22:30' });
    expect(data.orgSettings.deviceBinding).toBe(true);
  });

  it('seed 的 scrypt 哈希在首次登录后静默升级为 argon2(密码不变)', async () => {
    const u = await raw.user.findFirst({ where: { phone: SEED_ADMIN.phone, role: 'admin' } });
    expect(u!.passwordHash!.startsWith('$argon2')).toBe(true);
    // 升级后原密码仍可登录
    await request(http).post('/api/v1/auth/login').send(SEED_ADMIN).expect(200);
  });

  it('密码错误 → 401;学生手机号走密码登录 → 401', async () => {
    await request(http)
      .post('/api/v1/auth/login')
      .send({ phone: SEED_ADMIN.phone, password: 'wrong-pass' })
      .expect(401);
    await request(http)
      .post('/api/v1/auth/login')
      .send({ phone: '13900990003', password: 'whatever123' })
      .expect(401);
  });

  it('无 token 访问 /me → 401(错误体 {code,message})', async () => {
    const res = await request(http).get('/api/v1/me').expect(401);
    expect(res.body.code).toBe(401);
    expect(typeof res.body.message).toBe('string');
  });

  it('刷新轮换:新对签发,旧 refresh 重放 → 401', async () => {
    const login = await request(http).post('/api/v1/auth/login').send(SEED_ADMIN).expect(200);
    const rt0 = login.body.data.refreshToken;

    const r1 = await request(http).post('/api/v1/auth/refresh').send({ refreshToken: rt0 }).expect(200);
    expect(r1.body.data.accessToken).toBeTruthy();
    expect(r1.body.data.refreshToken).not.toBe(rt0);

    await request(http).post('/api/v1/auth/refresh').send({ refreshToken: rt0 }).expect(401);
  });

  it('logout 后 refresh 全部失效', async () => {
    const login = await request(http)
      .post('/api/v1/auth/login')
      .send({ phone: org2.adminPhone, password: org2.password })
      .expect(200);
    const { accessToken, refreshToken } = login.body.data;

    await request(http).post('/api/v1/auth/logout').set('Authorization', `Bearer ${accessToken}`).expect(200);
    await request(http).post('/api/v1/auth/refresh').send({ refreshToken }).expect(401);
  });

  it('学生 ticket 兑换成功且第二次失效', async () => {
    const token = await makeTicket(org2.orgId, org2.studentId);
    const res = await request(http)
      .post('/api/v1/auth/student/qr-exchange')
      .send({ token, deviceFingerprint: 'pad-e2e-001', deviceName: 'iPad (e2e)' })
      .expect(200);
    expect(res.body.data.me.role).toBe('student');
    expect(res.body.data.accessToken).toBeTruthy();

    const device = await raw.device.findFirst({ where: { studentId: org2.studentId } });
    expect(device?.deviceFingerprint).toBe('pad-e2e-001');

    // 一次性:同一 token 第二次兑换 → 401
    await request(http)
      .post('/api/v1/auth/student/qr-exchange')
      .send({ token, deviceFingerprint: 'pad-e2e-001', deviceName: 'iPad (e2e)' })
      .expect(401);
  });

  it('设备重复绑定被拒(已绑 A 机,新 ticket 换 B 机 → 403)', async () => {
    const token = await makeTicket(org2.orgId, org2.studentId);
    await request(http)
      .post('/api/v1/auth/student/qr-exchange')
      .send({ token, deviceFingerprint: 'pad-e2e-OTHER', deviceName: 'iPad (其他)' })
      .expect(403);
  });

  it('过期 ticket → 401', async () => {
    const token = await makeTicket(org2.orgId, org2.studentId, { expired: true });
    await request(http)
      .post('/api/v1/auth/student/qr-exchange')
      .send({ token, deviceFingerprint: 'pad-e2e-001', deviceName: 'iPad (e2e)' })
      .expect(401);
  });

  it('修改密码:原密码错 → 401;改成功后新密码可登录、旧密码失效', async () => {
    const login = await request(http)
      .post('/api/v1/auth/login')
      .send({ phone: org2.teacherPhone, password: org2.password })
      .expect(200);
    const at = login.body.data.accessToken;

    await request(http)
      .put('/api/v1/me/password')
      .set('Authorization', `Bearer ${at}`)
      .send({ oldPassword: 'totally-wrong', newPassword: 'NewPass@456' })
      .expect(401);

    await request(http)
      .put('/api/v1/me/password')
      .set('Authorization', `Bearer ${at}`)
      .send({ oldPassword: org2.password, newPassword: 'NewPass@456' })
      .expect(200);

    await request(http)
      .post('/api/v1/auth/login')
      .send({ phone: org2.teacherPhone, password: org2.password })
      .expect(401);
    await request(http)
      .post('/api/v1/auth/login')
      .send({ phone: org2.teacherPhone, password: 'NewPass@456' })
      .expect(200);
  });

  it('新密码不足 8 位 → 400 参数校验', async () => {
    const login = await request(http).post('/api/v1/auth/login').send(SEED_ADMIN).expect(200);
    await request(http)
      .put('/api/v1/me/password')
      .set('Authorization', `Bearer ${login.body.data.accessToken}`)
      .send({ oldPassword: SEED_ADMIN.password, newPassword: 'short' })
      .expect(400);
  });

  it('账号/密码/设备动作写入 audit_logs', async () => {
    const count = await raw.auditLog.count({
      where: { orgId: org2.orgId, action: { in: ['auth.login', 'auth.qr_exchange', 'me.password_change', 'auth.logout'] } },
    });
    expect(count).toBeGreaterThanOrEqual(4);
  });
});
