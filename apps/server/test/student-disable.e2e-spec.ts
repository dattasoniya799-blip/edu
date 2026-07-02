/**
 * 验收覆盖(经用户批准的契约增量:DELETE /admin/students/{id} 停用学生):
 * - RBAC:teacher token 调 DELETE → 403;无 token → 401;不存在学生 → 404
 * - 停用:200 OkVoid;仅置 status=disabled、不写 deletedAt;审计 admin.student.disable
 * - 停用后:学号密码登录 → 403;停用前的 refreshToken 已被吊销 → 401
 * - 列表:默认仍可见;?status=disabled 命中;?status=active 不含
 * - enable 恢复:status=active,可再登录
 * 夹具纪律:自建数据用 13958 开头手机号,afterAll 全量清理;seed 数据只读。
 */
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { ApiResp, StudentDto } from '@qiming/contracts';
import { createApp, raw } from './fixtures/setup';

const SEED_ADMIN = { phone: '13800000001', password: 'Admin@123' };
const SEED_TEACHER = { phone: '13800000002', password: 'Teacher@123' };

describe('停用学生 DELETE /admin/students/{id}(契约增量)', () => {
  let app: INestApplication;
  let http: any;
  let adminAt: string;
  let teacherAt: string;

  let org1Id: bigint;
  let testStart: Date;

  let studentId = 0;
  let studentNo = '';
  let studentPwd = '';
  let studentRt = ''; // 停用前签发的 refreshToken(停用应吊销)

  const login = async (phone: string, password: string) => {
    const res = await request(http).post('/api/v1/auth/login').send({ phone, password }).expect(200);
    return res.body.data.accessToken as string;
  };
  const get = (url: string, at: string) => request(http).get(`/api/v1${url}`).set('Authorization', `Bearer ${at}`);
  const post = (url: string, at: string) => request(http).post(`/api/v1${url}`).set('Authorization', `Bearer ${at}`);
  const del = (url: string, at: string) => request(http).delete(`/api/v1${url}`).set('Authorization', `Bearer ${at}`);
  const studentLogin = () =>
    request(http).post('/api/v1/auth/student/login').send({ studentNo, password: studentPwd });

  beforeAll(async () => {
    testStart = new Date();
    app = await createApp();
    http = app.getHttpServer();
    org1Id = (await raw.org.findFirstOrThrow({ orderBy: { id: 'asc' } })).id;

    adminAt = await login(SEED_ADMIN.phone, SEED_ADMIN.password);
    teacherAt = await login(SEED_TEACHER.phone, SEED_TEACHER.password);

    // 夹具学生(13958 号段)+ 重置密码取明文 → 预登录一次拿 refreshToken
    const created = await post('/admin/students', adminAt)
      .send({ name: '停用契约学生', parentPhone: '13958000001', grade: '初二' })
      .expect(200);
    const body = created.body as ApiResp<StudentDto>;
    studentId = body.data.id;
    studentNo = body.data.studentNo;
    const reset = await post(`/admin/students/${studentId}/reset-password`, adminAt).expect(200);
    studentPwd = reset.body.data.password as string;
    const first = await studentLogin().expect(200);
    studentRt = first.body.data.refreshToken as string;
  });

  afterAll(async () => {
    if (studentId) {
      await raw.courseStudent.deleteMany({ where: { studentId: BigInt(studentId) } });
      await raw.user.deleteMany({ where: { id: BigInt(studentId) } });
    }
    await raw.auditLog.deleteMany({ where: { orgId: org1Id, createdAt: { gte: testStart } } });
    await raw.$disconnect();
    await app.close();
  });

  it('门禁:teacher token → 403;无 token → 401;不存在学生 → 404', async () => {
    await del(`/admin/students/${studentId}`, teacherAt).expect(403);
    await request(http).delete(`/api/v1/admin/students/${studentId}`).expect(401);
    await del('/admin/students/999999999', adminAt).expect(404);
    // 未被误停用
    const u = await raw.user.findUniqueOrThrow({ where: { id: BigInt(studentId) } });
    expect(u.status).toBe('active');
  });

  it('停用:200 OkVoid;仅置 status=disabled、不写 deletedAt;审计 admin.student.disable', async () => {
    const res = await del(`/admin/students/${studentId}`, adminAt).expect(200);
    expect(res.body).toEqual({ code: 0, message: 'ok', data: null });

    const u = await raw.user.findUniqueOrThrow({ where: { id: BigInt(studentId) } });
    expect(u.status).toBe('disabled');
    expect(u.deletedAt).toBeNull(); // 停用 ≠ 删除

    const log = await raw.auditLog.findFirst({
      where: { orgId: org1Id, action: 'admin.student.disable', targetId: BigInt(studentId) },
    });
    expect(log).not.toBeNull();
    expect(log!.targetType).toBe('user');
  });

  it('停用后:学号密码登录 → 403;停用前的 refreshToken 已吊销 → 401', async () => {
    await studentLogin().expect(403);
    await request(http).post('/api/v1/auth/refresh').send({ refreshToken: studentRt }).expect(401);
  });

  it('列表:默认仍可见;?status=disabled 命中;?status=active 不含', async () => {
    const all = await get('/admin/students?keyword=停用契约学生&size=50', adminAt).expect(200);
    expect((all.body.data.items as StudentDto[]).map((s) => s.id)).toContain(studentId);
    const dis = await get('/admin/students?keyword=停用契约学生&status=disabled&size=50', adminAt).expect(200);
    expect((dis.body.data.items as StudentDto[]).map((s) => s.id)).toContain(studentId);
    expect((dis.body.data.items as StudentDto[]).every((s) => s.status === 'disabled')).toBe(true);
    const act = await get('/admin/students?keyword=停用契约学生&status=active&size=50', adminAt).expect(200);
    expect((act.body.data.items as StudentDto[]).map((s) => s.id)).not.toContain(studentId);
  });

  it('enable 恢复:status=active,可再登录', async () => {
    await post(`/admin/students/${studentId}/enable`, adminAt).expect(200);
    const u = await raw.user.findUniqueOrThrow({ where: { id: BigInt(studentId) } });
    expect(u.status).toBe('active');
    await studentLogin().expect(200);
  });
});
