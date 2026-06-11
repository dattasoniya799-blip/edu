import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { MasteryItemDto, PageResp, StudentDto } from '@qiming/contracts';
import { AuditService } from '../audit/audit.service';
import type { JwtUser } from '../auth/auth.service';
import { randomToken } from '../auth/password.util';
import { PrismaService } from '../prisma/prisma.service';
import { StudentInputDto, StudentListQueryDto } from './admin.dto';
import { daysAgoUtc, iso, num, profileField } from './helpers';
import { SmsService } from './sms.service';

const TICKET_TTL_MS = 7 * 86400_000; // 与 seed 口径一致:登录码 7 天有效

@Injectable()
export class StudentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly sms: SmsService,
  ) {}

  // ---------------- 列表 ----------------
  async list(q: StudentListQueryDto): Promise<PageResp<StudentDto>> {
    const where = {
      role: 'student' as const,
      deletedAt: null,
      ...(q.courseId
        ? { enrollments: { some: { courseId: BigInt(q.courseId), status: 'active' } } }
        : {}),
      ...(q.deviceBound === true ? { device: { isNot: null } } : {}),
      ...(q.deviceBound === false ? { device: { is: null } } : {}),
      ...(q.keyword
        ? {
            OR: [
              { name: { contains: q.keyword } },
              { phone: { contains: q.keyword } },
              { studentNo: { contains: q.keyword } },
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
    return { items: await this.decorate(rows.map((r) => r.id)), total };
  }

  // ---------------- 创建(向家长手机发登录码) ----------------
  async create(user: JwtUser, dto: StudentInputDto, ip?: string): Promise<StudentDto> {
    const studentNo = dto.studentNo ?? (await this.nextNo());
    await this.assertStudentNoFree(studentNo);
    const courseIds = await this.assertCoursesExist(dto.courseIds ?? []);

    const orgId = BigInt(user.orgId);
    const created = await this.prisma.client.$transaction(async (tx) => {
      const s = await tx.user.create({
        data: {
          orgId,
          role: 'student',
          name: dto.name,
          phone: dto.parentPhone,
          studentNo,
          status: 'pending', // 首次扫码登录后由 A1 流程激活
          profile: { grade: dto.grade },
        },
      });
      if (courseIds.length) {
        await tx.courseStudent.createMany({
          data: courseIds.map((cid) => ({ orgId, courseId: cid, studentId: s.id })),
        });
      }
      await tx.loginTicket.create({
        data: {
          orgId,
          studentId: s.id,
          token: `tk_${randomToken(16)}`,
          expiresAt: new Date(Date.now() + TICKET_TTL_MS),
        },
      });
      return s;
    });
    this.sms.sendLoginTicket(dto.parentPhone);
    await this.audit.log({
      actorId: user.uid, orgId: user.orgId, action: 'admin.student.create',
      targetType: 'user', targetId: num(created.id), ip,
    });
    const [item] = await this.decorate([created.id]);
    return item;
  }

  // ---------------- 编辑 ----------------
  async update(user: JwtUser, id: number, dto: StudentInputDto, ip?: string): Promise<null> {
    const s = await this.findStudentOr404(id);
    const studentNo = dto.studentNo ?? s.studentNo ?? (await this.nextNo());
    if (studentNo !== s.studentNo) await this.assertStudentNoFree(studentNo);

    await this.prisma.client.user.update({
      where: { id: s.id },
      data: {
        name: dto.name,
        phone: dto.parentPhone,
        studentNo,
        profile: { grade: dto.grade },
      },
    });
    if (dto.courseIds) await this.syncEnrollments(BigInt(user.orgId), s.id, dto.courseIds);
    await this.audit.log({
      actorId: user.uid, orgId: user.orgId, action: 'admin.student.update',
      targetType: 'user', targetId: id, ip,
    });
    return null;
  }

  // ---------------- 档案(课程+设备+学情摘要) ----------------
  async profile(id: number): Promise<{ student: StudentDto; mastery: MasteryItemDto[]; wrongOpenCount: number }> {
    const s = await this.findStudentOr404(id);
    const [snapshots, wrongOpenCount, [student]] = await Promise.all([
      this.prisma.client.masterySnapshot.findMany({
        where: { studentId: s.id },
        include: { node: { select: { name: true, graph: { select: { graphType: true } } } } },
        orderBy: { nodeId: 'asc' },
      }),
      this.prisma.client.wrongBookEntry.count({ where: { studentId: s.id, status: 'open' } }),
      this.decorate([s.id]),
    ]);
    const mastery: MasteryItemDto[] = snapshots.map((m) => ({
      nodeId: num(m.nodeId),
      nodeName: m.node.name,
      graphType: m.node.graph.graphType,
      mastery: m.mastery,
      sampleCount: m.sampleCount,
    }));
    return { student, mastery, wrongOpenCount };
  }

  // ---------------- 生成/重发平板登录码 ----------------
  async loginTicket(user: JwtUser, id: number, ip?: string): Promise<{ token: string; expiresAt: string }> {
    const s = await this.findStudentOr404(id);
    const expiresAt = new Date(Date.now() + TICKET_TTL_MS);
    const token = `tk_${randomToken(16)}`;
    await this.prisma.client.$transaction(async (tx) => {
      // 旧的未用登录码立即作废(重发语义)
      await tx.loginTicket.updateMany({
        where: { studentId: s.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      await tx.loginTicket.create({
        data: { orgId: BigInt(user.orgId), studentId: s.id, token, expiresAt },
      });
    });
    if (s.phone) this.sms.sendLoginTicket(s.phone);
    await this.audit.log({
      actorId: user.uid, orgId: user.orgId, action: 'admin.student.login_ticket',
      targetType: 'user', targetId: id, ip,
    });
    return { token, expiresAt: iso(expiresAt) };
  }

  // ---------------- 解绑设备 ----------------
  async unbindDevice(user: JwtUser, id: number, ip?: string): Promise<null> {
    const s = await this.findStudentOr404(id);
    const { count } = await this.prisma.client.device.deleteMany({ where: { studentId: s.id } });
    if (count === 0) throw new NotFoundException('该学生未绑定设备');
    await this.audit.log({
      actorId: user.uid, orgId: user.orgId, action: 'admin.student.unbind_device',
      targetType: 'device', targetId: id, ip,
    });
    return null;
  }

  // ---------------- 内部 ----------------
  private async findStudentOr404(id: number) {
    const s = await this.prisma.client.user.findFirst({
      where: { id: BigInt(id), role: 'student', deletedAt: null },
    });
    if (!s) throw new NotFoundException('学生不存在');
    return s;
  }

  private async assertStudentNoFree(studentNo: string) {
    const dup = await this.prisma.client.user.findFirst({ where: { studentNo } });
    if (dup) throw new ConflictException('学号已存在');
  }

  private async assertCoursesExist(courseIds: number[]): Promise<bigint[]> {
    if (!courseIds.length) return [];
    const ids = [...new Set(courseIds)].map(BigInt);
    const found = await this.prisma.client.course.findMany({
      where: { id: { in: ids }, deletedAt: null },
      select: { id: true },
    });
    if (found.length !== ids.length) throw new NotFoundException('课程不存在');
    return ids;
  }

  /** 全量同步选课:缺的补 active,多的置 quit(保留历史) */
  private async syncEnrollments(orgId: bigint, studentId: bigint, courseIds: number[]) {
    const target = await this.assertCoursesExist(courseIds);
    const targetSet = new Set(target.map(String));
    const existing = await this.prisma.client.courseStudent.findMany({ where: { studentId } });
    const existingMap = new Map(existing.map((e) => [String(e.courseId), e]));

    for (const cid of target) {
      const cur = existingMap.get(String(cid));
      if (!cur) {
        await this.prisma.client.courseStudent.create({ data: { orgId, courseId: cid, studentId } });
      } else if (cur.status !== 'active') {
        await this.prisma.client.courseStudent.update({ where: { id: cur.id }, data: { status: 'active' } });
      }
    }
    for (const e of existing) {
      if (!targetSet.has(String(e.courseId)) && e.status === 'active') {
        await this.prisma.client.courseStudent.update({ where: { id: e.id }, data: { status: 'quit' } });
      }
    }
  }

  private async nextNo(): Promise<string> {
    const rows = await this.prisma.client.user.findMany({
      where: { studentNo: { startsWith: 'S-' } },
      select: { studentNo: true },
    });
    const max = rows.reduce((m, r) => {
      const n = Number(r.studentNo?.slice(2));
      return Number.isFinite(n) && n > m ? n : m;
    }, 0);
    return `S-${String(max + 1).padStart(4, '0')}`;
  }

  /** 组装 StudentDto(课程/设备/近 7 天学习时长) */
  private async decorate(ids: bigint[]): Promise<StudentDto[]> {
    if (!ids.length) return [];
    const [rows, study] = await Promise.all([
      this.prisma.client.user.findMany({
        where: { id: { in: ids } },
        include: {
          device: true,
          enrollments: {
            where: { status: 'active', course: { deletedAt: null } },
            include: { course: { select: { id: true, name: true, classType: true } } },
            orderBy: { courseId: 'asc' },
          },
        },
        orderBy: { id: 'asc' },
      }),
      this.prisma.client.attempt.groupBy({
        by: ['studentId'],
        where: { studentId: { in: ids }, startedAt: { gte: daysAgoUtc(7) } },
        _sum: { durationSec: true },
      }),
    ]);
    const studyMap = new Map(study.map((s) => [String(s.studentId), s._sum.durationSec ?? 0]));
    // 维持入参顺序
    const byId = new Map(rows.map((r) => [String(r.id), r]));
    return ids
      .map((id) => byId.get(String(id)))
      .filter((u): u is NonNullable<typeof u> => !!u)
      .map((u) => ({
        id: num(u.id),
        name: u.name,
        studentNo: u.studentNo ?? '',
        parentPhone: u.phone ?? '',
        grade: profileField(u.profile, 'grade'),
        status: u.status,
        courses: u.enrollments.map((e) => ({
          id: num(e.course.id),
          name: e.course.name,
          classType: e.course.classType,
        })),
        device: u.device
          ? { name: u.device.deviceName ?? '', boundAt: iso(u.device.boundAt) }
          : null,
        weekStudySec: studyMap.get(String(u.id)) ?? 0,
      }));
  }
}
