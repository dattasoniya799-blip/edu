import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type Redis from 'ioredis';
import type { PageResp, TeacherDto } from '@qiming/contracts';
import { AuditService } from '../audit/audit.service';
import type { JwtUser } from '../auth/auth.service';
import { hashPassword, randomToken } from '../auth/password.util';
import { PrismaService } from '../prisma/prisma.service';
import { REDIS } from '../redis/redis.module';
import { TeacherInputDto, TeacherListQueryDto } from './admin.dto';
import { num, profileField } from './helpers';
import { SmsService } from './sms.service';

type UserRow = {
  id: bigint;
  name: string;
  phone: string | null;
  teacherNo: string | null;
  status: 'active' | 'disabled' | 'pending';
  profile: unknown;
};

@Injectable()
export class TeachersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly sms: SmsService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  // ---------------- 列表 ----------------
  async list(q: TeacherListQueryDto): Promise<PageResp<TeacherDto>> {
    const where = {
      role: 'teacher' as const,
      deletedAt: null,
      ...(q.status ? { status: q.status } : {}),
      ...(q.keyword
        ? {
            OR: [
              { name: { contains: q.keyword } },
              { phone: { contains: q.keyword } },
              { teacherNo: { contains: q.keyword } },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.client.user.findMany({
        where,
        orderBy: { id: 'asc' },
        skip: (q.page - 1) * q.size,
        take: q.size,
      }),
      this.prisma.client.user.count({ where }),
    ]);
    return { items: await this.decorate(rows), total };
  }

  // ---------------- 创建(短信发初始密码) ----------------
  async create(user: JwtUser, dto: TeacherInputDto, ip?: string): Promise<TeacherDto> {
    await this.assertPhoneFree(dto.phone);
    const teacherNo = dto.teacherNo ?? (await this.nextNo());
    await this.assertTeacherNoFree(teacherNo);

    const initialPassword = `Qm${randomToken(5)}!`; // 仅短信(模拟)下发,不落日志
    const created = await this.prisma.client.user.create({
      data: {
        orgId: BigInt(user.orgId),
        role: 'teacher',
        name: dto.name,
        phone: dto.phone,
        teacherNo,
        passwordHash: await hashPassword(initialPassword),
        status: 'active',
        profile: { stage: dto.stage, subject: dto.subject },
      },
    });
    this.sms.sendInitialPassword(dto.phone);
    await this.audit.log({
      actorId: user.uid, orgId: user.orgId, action: 'admin.teacher.create',
      targetType: 'user', targetId: num(created.id), ip,
    });
    const [item] = await this.decorate([created]);
    return item;
  }

  // ---------------- 编辑 ----------------
  async update(user: JwtUser, id: number, dto: TeacherInputDto, ip?: string): Promise<null> {
    const t = await this.findTeacherOr404(id);
    await this.assertPhoneFree(dto.phone, t.id);
    const teacherNo = dto.teacherNo ?? t.teacherNo ?? (await this.nextNo());
    if (teacherNo !== t.teacherNo) await this.assertTeacherNoFree(teacherNo);

    await this.prisma.client.user.update({
      where: { id: t.id },
      data: {
        name: dto.name,
        phone: dto.phone,
        teacherNo,
        profile: { stage: dto.stage, subject: dto.subject },
      },
    });
    await this.audit.log({
      actorId: user.uid, orgId: user.orgId, action: 'admin.teacher.update',
      targetType: 'user', targetId: id, ip,
    });
    return null;
  }

  // ---------------- 停用(软删) ----------------
  async disable(user: JwtUser, id: number, ip?: string): Promise<null> {
    const t = await this.findTeacherOr404(id);
    await this.prisma.client.user.update({
      where: { id: t.id },
      data: { status: 'disabled', deletedAt: new Date() },
    });
    await this.revokeRefreshTokens(id);
    await this.audit.log({
      actorId: user.uid, orgId: user.orgId, action: 'admin.teacher.disable',
      targetType: 'user', targetId: id, ip,
    });
    return null;
  }

  // ---------------- 重置密码并短信通知 ----------------
  async resetPassword(user: JwtUser, id: number, ip?: string): Promise<null> {
    const t = await this.findTeacherOr404(id);
    const newPassword = `Qm${randomToken(5)}!`;
    await this.prisma.client.user.update({
      where: { id: t.id },
      data: { passwordHash: await hashPassword(newPassword) },
    });
    await this.revokeRefreshTokens(id); // 重置后旧刷新令牌全部作废
    if (t.phone) this.sms.sendPasswordReset(t.phone);
    await this.audit.log({
      actorId: user.uid, orgId: user.orgId, action: 'admin.teacher.reset_password',
      targetType: 'user', targetId: id, ip,
    });
    return null;
  }

  // ---------------- 内部 ----------------
  private async findTeacherOr404(id: number) {
    const t = await this.prisma.client.user.findFirst({
      where: { id: BigInt(id), role: 'teacher', deletedAt: null },
    });
    if (!t) throw new NotFoundException('教师不存在');
    return t;
  }

  /** 手机号(登录账号)在本机构 admin/teacher 中唯一 */
  private async assertPhoneFree(phone: string, exceptId?: bigint) {
    const dup = await this.prisma.client.user.findFirst({
      where: {
        phone, role: { in: ['admin', 'teacher'] }, deletedAt: null,
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
    });
    if (dup) throw new ConflictException('该手机号已被其他账号使用');
  }

  private async assertTeacherNoFree(teacherNo: string) {
    const dup = await this.prisma.client.user.findFirst({ where: { teacherNo } });
    if (dup) throw new ConflictException('工号已存在');
  }

  /** 自动生成工号 T-XXXX(取现有最大序号 +1) */
  private async nextNo(): Promise<string> {
    const rows = await this.prisma.client.user.findMany({
      where: { teacherNo: { startsWith: 'T-' } },
      select: { teacherNo: true },
    });
    const max = rows.reduce((m, r) => {
      const n = Number(r.teacherNo?.slice(2));
      return Number.isFinite(n) && n > m ? n : m;
    }, 0);
    return `T-${String(max + 1).padStart(4, '0')}`;
  }

  /** 与 A1 AuthService 的 Redis 键约定一致(rt:{jti} / rtu:{uid}) */
  private async revokeRefreshTokens(uid: number) {
    const jtis = await this.redis.smembers(`rtu:${uid}`);
    if (jtis.length) await this.redis.del(...jtis.map((j) => `rt:${j}`));
    await this.redis.del(`rtu:${uid}`);
  }

  /** 批量补齐 courseCount/questionCount/resourceCount */
  private async decorate(rows: UserRow[]): Promise<TeacherDto[]> {
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const [courses, questions, resources] = await Promise.all([
      this.prisma.client.course.groupBy({
        by: ['teacherId'], where: { teacherId: { in: ids }, deletedAt: null }, _count: { _all: true },
      }),
      this.prisma.client.question.groupBy({
        by: ['ownerId'], where: { ownerId: { in: ids }, deletedAt: null }, _count: { _all: true },
      }),
      this.prisma.client.resource.groupBy({
        by: ['ownerId'], where: { ownerId: { in: ids }, deletedAt: null }, _count: { _all: true },
      }),
    ]);
    const courseCnt = new Map(courses.map((c) => [String(c.teacherId), c._count._all]));
    const questionCnt = new Map(questions.map((c) => [String(c.ownerId), c._count._all]));
    const resourceCnt = new Map(resources.map((c) => [String(c.ownerId), c._count._all]));

    return rows.map((u) => ({
      id: num(u.id),
      name: u.name,
      teacherNo: u.teacherNo ?? '',
      phone: u.phone ?? '',
      stage: profileField(u.profile, 'stage'),
      subject: profileField(u.profile, 'subject'),
      status: u.status,
      courseCount: courseCnt.get(String(u.id)) ?? 0,
      questionCount: questionCnt.get(String(u.id)) ?? 0,
      resourceCount: resourceCnt.get(String(u.id)) ?? 0,
    }));
  }
}
