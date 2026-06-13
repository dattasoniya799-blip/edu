/** e2e 公共设施:起应用(同 main.ts 配置)+ 第二机构夹具(跨租户用例) */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { hashPassword } from '../../src/auth/password.util';
import { ProbeModule } from './probe.module';

export async function createApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule, ProbeModule],
  }).compile();
  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api/v1', { exclude: ['healthz'] });
  await app.init();
  return app;
}

/** 原生 client(不带租户注入)— 仅测试夹具使用 */
export const raw = new PrismaClient();

export interface Org2Fixture {
  orgId: bigint;
  adminId: bigint;
  teacherId: bigint;
  studentId: bigint;
  adminPhone: string;
  teacherPhone: string;
  password: string;
}

/** 临时建第二机构(验收项:两机构互查任何资源 → 404) */
export async function createOrg2(): Promise<Org2Fixture> {
  const password = 'Org2@Pass123';
  const hash = await hashPassword(password);
  const org = await raw.org.create({
    data: {
      name: 'e2e第二机构',
      settings: {
        ai: { qaGuideOnly: true, preGrading: true },
        studentHours: { start: '06:00', end: '22:30' },
        deviceBinding: true,
      },
    },
  });
  const admin = await raw.user.create({
    data: { orgId: org.id, role: 'admin', name: 'e2e管理员', phone: '13900990001', passwordHash: hash },
  });
  const teacher = await raw.user.create({
    data: { orgId: org.id, role: 'teacher', name: 'e2e教师', phone: '13900990002', passwordHash: hash },
  });
  const student = await raw.user.create({
    data: { orgId: org.id, role: 'student', name: 'e2e学生', phone: '13900990003', studentNo: 'E2E-S001' },
  });
  return {
    orgId: org.id, adminId: admin.id, teacherId: teacher.id, studentId: student.id,
    adminPhone: admin.phone!, teacherPhone: teacher.phone!, password,
  };
}

export async function dropOrg2(orgId: bigint): Promise<void> {
  await raw.device.deleteMany({ where: { orgId } });
  await raw.loginTicket.deleteMany({ where: { orgId } });
  await raw.auditLog.deleteMany({ where: { orgId } });
  await raw.user.deleteMany({ where: { orgId } });
  await raw.org.deleteMany({ where: { id: orgId } });
}

/**
 * IMPL2 学生登录助手:为夹具学生写入已知密码并置 active,然后走新的账号密码登录
 * (POST /auth/student/login),返回 accessToken。替代已删除的 qr-exchange 流。
 */
export const STUDENT_TEST_PASSWORD = 'Student@123';
export async function loginStudentById(
  http: unknown,
  studentId: bigint,
  password = STUDENT_TEST_PASSWORD,
): Promise<string> {
  const u = await raw.user.update({
    where: { id: studentId },
    data: { passwordHash: await hashPassword(password), status: 'active' },
  });
  const res = await request(http as never)
    .post('/api/v1/auth/student/login')
    .send({ studentNo: u.studentNo, password })
    .expect(200);
  return res.body.data.accessToken as string;
}

export async function makeTicket(orgId: bigint, studentId: bigint, opts?: { expired?: boolean }) {
  const token = `e2e-${Math.random().toString(36).slice(2)}${Date.now()}`;
  await raw.loginTicket.create({
    data: {
      orgId, studentId, token,
      expiresAt: new Date(Date.now() + (opts?.expired ? -60_000 : 10 * 60_000)),
    },
  });
  return token;
}
