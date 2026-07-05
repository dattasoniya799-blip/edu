/**
 * 验收覆盖(任务卡 A1):
 * - 管理员登录(13800000001/Admin@123)→ /me 返回 org settings
 * - 无 token → 401
 * - 学生账号密码登录(reset-password 取明文 → student/login);停用学生 → 403
 * - 刷新轮换(旧 refresh 重放 → 401);登出后 refresh 失效
 * - 修改密码(原密码错 → 401;改后新密码可登录);scrypt → argon2 静默升级
 */
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createApp, createOrg2, dropOrg2, raw, Org2Fixture } from './fixtures/setup';

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
    expect(data.orgName).toBe('鲸云演示机构');
    // 断言对齐本轮 seed.ts 新 orgSettings 形状(新增 classCompanion/diagnosis=true,
    // studentHours 放宽为全天 00:00-23:59,移除 deviceBinding)
    expect(data.orgSettings.ai).toEqual({
      qaGuideOnly: true, preGrading: true, classCompanion: true, diagnosis: true,
    });
    expect(data.orgSettings.studentHours).toEqual({ start: '00:00', end: '23:59' });
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

  it('管理员重置学生密码 → 返回明文 → 学生账号密码登录成功;错误密码 → 401', async () => {
    // 管理员登录 → 重置学生密码,拿到明文临时密码
    const adminLogin = await request(http)
      .post('/api/v1/auth/login')
      .send({ phone: org2.adminPhone, password: org2.password })
      .expect(200);
    const adminAt = adminLogin.body.data.accessToken;

    const reset = await request(http)
      .post(`/api/v1/admin/students/${org2.studentId}/reset-password`)
      .set('Authorization', `Bearer ${adminAt}`)
      .expect(200);
    const tempPassword = reset.body.data.password;
    expect(typeof tempPassword).toBe('string');
    expect(tempPassword.length).toBeGreaterThanOrEqual(8);

    // 学生用学号 + 临时密码登录
    const student = await raw.user.findFirstOrThrow({ where: { id: org2.studentId } });
    const ok = await request(http)
      .post('/api/v1/auth/student/login')
      .send({ studentNo: student.studentNo, password: tempPassword })
      .expect(200);
    expect(ok.body.data.me.role).toBe('student');
    expect(ok.body.data.accessToken).toBeTruthy();
    expect(ok.body.data.refreshToken).toBeTruthy();

    // 错误密码 → 401;未知学号 → 401
    await request(http)
      .post('/api/v1/auth/student/login')
      .send({ studentNo: student.studentNo, password: 'wrong-pass' })
      .expect(401);
    await request(http)
      .post('/api/v1/auth/student/login')
      .send({ studentNo: 'NO-SUCH-STUDENT', password: tempPassword })
      .expect(401);
  });

  it('停用学生 → 账号密码登录被拒(403)', async () => {
    const adminLogin = await request(http)
      .post('/api/v1/auth/login')
      .send({ phone: org2.adminPhone, password: org2.password })
      .expect(200);
    const reset = await request(http)
      .post(`/api/v1/admin/students/${org2.studentId}/reset-password`)
      .set('Authorization', `Bearer ${adminLogin.body.data.accessToken}`)
      .expect(200);
    const pwd = reset.body.data.password;
    const student = await raw.user.findFirstOrThrow({ where: { id: org2.studentId } });

    await raw.user.update({ where: { id: org2.studentId }, data: { status: 'disabled' } });
    await request(http)
      .post('/api/v1/auth/student/login')
      .send({ studentNo: student.studentNo, password: pwd })
      .expect(403);
    await raw.user.update({ where: { id: org2.studentId }, data: { status: 'active' } });
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

  it('账号/密码/登录动作写入 audit_logs', async () => {
    const count = await raw.auditLog.count({
      where: { orgId: org2.orgId, action: { in: ['auth.login', 'auth.student_login', 'me.password_change', 'auth.logout'] } },
    });
    expect(count).toBeGreaterThanOrEqual(4);
  });
});
