/**
 * 全功能核验修复回归(fix-verify):
 * ① 手机号格式校验:POST/PUT /admin/teachers、/admin/students 非法手机号 → 400,合法 → 200
 * ② 密码重置吊销 access token:admin 重置学生/教师、用户自助改密三路径,
 *    改密前签发的旧 access token → 401(口径同"凭证无效或已过期"),新登录 → 200
 * ③ Redis 键 auth:pwdreset:{uid}:值≈重置 epoch 秒,TTL = JWT_ACCESS_TTL
 * 夹具手机号用 13956 号段(避开既有 1391-1395)。
 */
import { INestApplication } from '@nestjs/common';
import Redis from 'ioredis';
import request from 'supertest';
import { hashPassword } from '../src/auth/password.util';
import { PWD_RESET_KEY, ttlSeconds } from '../src/auth/pwd-reset';
import { createApp, raw } from './fixtures/setup';

const PASSWORD = 'Fixv@Pass123';
/** 13956 号段:P(1)=13956000001 */
const P = (n: number) => `13956${String(n).padStart(6, '0')}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('核验修复:手机号校验 + 密码重置吊销 access token(fix-verify)', () => {
  let app: INestApplication;
  let http: any;
  let redis: Redis;
  let orgId: bigint;
  let adminAt: string;
  let teacherId: number;
  let studentId: number;

  const post = (url: string) => request(http).post(`/api/v1${url}`).set('Authorization', `Bearer ${adminAt}`);
  const put = (url: string) => request(http).put(`/api/v1${url}`).set('Authorization', `Bearer ${adminAt}`);
  const me = (at: string) => request(http).get('/api/v1/me').set('Authorization', `Bearer ${at}`);

  beforeAll(async () => {
    app = await createApp();
    http = app.getHttpServer();
    redis = new Redis(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379');

    const org = await raw.org.create({
      data: {
        name: 'fixv核验机构',
        settings: {
          ai: { qaGuideOnly: true, preGrading: true },
          studentHours: { start: '00:00', end: '23:59' },
          deviceBinding: true,
        },
      },
    });
    orgId = org.id;
    await raw.user.create({
      data: { orgId, role: 'admin', name: 'fixv管理员', phone: P(1), passwordHash: await hashPassword(PASSWORD) },
    });
    const login = await request(http)
      .post('/api/v1/auth/login')
      .send({ phone: P(1), password: PASSWORD })
      .expect(200);
    adminAt = login.body.data.accessToken;
  });

  afterAll(async () => {
    const users = await raw.user.findMany({ where: { orgId }, select: { id: true } });
    if (users.length) await redis.del(...users.map((u) => PWD_RESET_KEY(Number(u.id))));
    await raw.auditLog.deleteMany({ where: { orgId } });
    await raw.user.deleteMany({ where: { orgId } });
    await raw.org.deleteMany({ where: { id: orgId } });
    await redis.quit();
    await raw.$disconnect();
    await app.close();
  });

  // ================= ① 手机号格式校验 =================
  describe('① 手机号格式校验(^1[3-9]\\d{9}$)', () => {
    it('POST /admin/teachers:非法手机号 → 400(含"手机号格式不正确"),合法 → 200', async () => {
      for (const phone of ['123', '12356000001', '1395600001', '139560000011', '1395600000a']) {
        const res = await post('/admin/teachers')
          .send({ name: 'fixv教师', phone, stage: '初中', subject: '数学' })
          .expect(400);
        expect(JSON.stringify(res.body)).toContain('手机号格式不正确');
      }
      const ok = await post('/admin/teachers')
        .send({ name: 'fixv教师', phone: P(11), teacherNo: 'FIXV-T001', stage: '初中', subject: '数学' })
        .expect(200);
      teacherId = ok.body.data.id;
      expect(teacherId).toBeGreaterThan(0);
    });

    it('PUT /admin/teachers/:id:非法手机号 → 400,合法 → 200', async () => {
      await put(`/admin/teachers/${teacherId}`)
        .send({ name: 'fixv教师', phone: '123', stage: '初中', subject: '数学' })
        .expect(400);
      await put(`/admin/teachers/${teacherId}`)
        .send({ name: 'fixv教师', phone: P(12), stage: '初中', subject: '数学' })
        .expect(200);
    });

    it('POST /admin/students:非法家长手机号 → 400(含"手机号格式不正确"),合法 → 200', async () => {
      for (const parentPhone of ['123', '23956000021', '1395600002']) {
        const res = await post('/admin/students')
          .send({ name: 'fixv学生', parentPhone, grade: '初二' })
          .expect(400);
        expect(JSON.stringify(res.body)).toContain('手机号格式不正确');
      }
      const ok = await post('/admin/students')
        .send({ name: 'fixv学生', parentPhone: P(21), studentNo: 'FIXV-S001', grade: '初二' })
        .expect(200);
      studentId = ok.body.data.id;
      expect(studentId).toBeGreaterThan(0);
    });

    it('PUT /admin/students/:id:非法家长手机号 → 400,合法 → 200', async () => {
      await put(`/admin/students/${studentId}`)
        .send({ name: 'fixv学生', parentPhone: 'abc12345678', grade: '初二' })
        .expect(400);
      await put(`/admin/students/${studentId}`)
        .send({ name: 'fixv学生', parentPhone: P(22), grade: '初三' })
        .expect(200);
    });
  });

  // ================= ② 密码重置吊销 access token =================
  describe('② 密码重置后旧 access token 立即失效', () => {
    it('admin 重置学生密码:旧 access → 401,新登录 → 200;Redis 键值与 TTL 正确', async () => {
      // 第一次重置拿明文 → 学生登录,持有"旧" access token
      const r1 = await post(`/admin/students/${studentId}/reset-password`).expect(200);
      const student = await raw.user.findFirstOrThrow({ where: { id: BigInt(studentId) } });
      const login1 = await request(http)
        .post('/api/v1/auth/student/login')
        .send({ studentNo: student.studentNo, password: r1.body.data.password })
        .expect(200);
      const oldAt = login1.body.data.accessToken;
      await me(oldAt).expect(200); // 重置前旧 token 正常

      // 跨秒后再次重置(守卫用 iat < resetAt 严格小于,需保证重置秒 > 旧 token iat)
      await sleep(1100);
      const r2 = await post(`/admin/students/${studentId}/reset-password`).expect(200);

      // 旧 access token → 401,口径与既有 401 一致
      const denied = await me(oldAt).expect(401);
      expect(denied.body.message).toBe('凭证无效或已过期');

      // ③ Redis 键:值≈当前 epoch 秒,TTL=JWT_ACCESS_TTL(默认 2h=7200s)
      const key = PWD_RESET_KEY(studentId);
      const val = await redis.get(key);
      const ttl = await redis.ttl(key);
      const expectTtl = ttlSeconds(process.env.JWT_ACCESS_TTL ?? '2h');
      expect(Math.abs(Number(val) - Math.floor(Date.now() / 1000))).toBeLessThanOrEqual(5);
      expect(ttl).toBeGreaterThan(expectTtl - 60);
      expect(ttl).toBeLessThanOrEqual(expectTtl);

      // 新登录(可能与重置同秒,严格小于不误杀)→ /me 200
      const login2 = await request(http)
        .post('/api/v1/auth/student/login')
        .send({ studentNo: student.studentNo, password: r2.body.data.password })
        .expect(200);
      await me(login2.body.data.accessToken).expect(200);
    });

    it('admin 重置教师密码:旧 access → 401,新登录 → 200', async () => {
      const r1 = await post(`/admin/teachers/${teacherId}/reset-password`).expect(200);
      const login1 = await request(http)
        .post('/api/v1/auth/login')
        .send({ phone: P(12), password: r1.body.data.password })
        .expect(200);
      const oldAt = login1.body.data.accessToken;
      await me(oldAt).expect(200);

      await sleep(1100);
      const r2 = await post(`/admin/teachers/${teacherId}/reset-password`).expect(200);
      const denied = await me(oldAt).expect(401);
      expect(denied.body.message).toBe('凭证无效或已过期');

      const login2 = await request(http)
        .post('/api/v1/auth/login')
        .send({ phone: P(12), password: r2.body.data.password })
        .expect(200);
      await me(login2.body.data.accessToken).expect(200);
    });

    it('自助改密 PUT /me/password:改密请求本身成功,其后旧 access → 401,新密码登录 → 200', async () => {
      // 学生写入已知密码并登录(与既有测试口径一致)
      const student = await raw.user.findFirstOrThrow({ where: { id: BigInt(studentId) } });
      await raw.user.update({ where: { id: student.id }, data: { passwordHash: await hashPassword(PASSWORD) } });
      const login1 = await request(http)
        .post('/api/v1/auth/student/login')
        .send({ studentNo: student.studentNo, password: PASSWORD })
        .expect(200);
      const oldAt = login1.body.data.accessToken;

      await sleep(1100);
      await request(http)
        .put('/api/v1/me/password')
        .set('Authorization', `Bearer ${oldAt}`)
        .send({ oldPassword: PASSWORD, newPassword: 'FixvNew@456' })
        .expect(200);

      // 同一 token 的后续请求 → 401
      const denied = await me(oldAt).expect(401);
      expect(denied.body.message).toBe('凭证无效或已过期');

      // 新密码登录 → 200
      const login2 = await request(http)
        .post('/api/v1/auth/student/login')
        .send({ studentNo: student.studentNo, password: 'FixvNew@456' })
        .expect(200);
      await me(login2.body.data.accessToken).expect(200);
    });
  });
});
