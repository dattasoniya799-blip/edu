import { Injectable } from '@nestjs/common';
import type { AiUsageBreakdownDto, AiUsageSummaryDto, MeDto, PageResp } from '@qiming/contracts';
import { AuditService } from '../audit/audit.service';
import type { JwtUser } from '../auth/auth.service';
import { AuthService } from '../auth/auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { AiQuotaInputDto, PageQueryDto, SettingsInputDto } from './admin.dto';
import { dayKey, daysAgoUtc, dec, iso, num, periodOf, round2, round4, utcDayStart, utcMonthStart } from './helpers';

const FEATURE_LABELS: Record<string, string> = {
  class_companion: '课堂伴学',
  qa: 'AI 答疑',
  pre_grading: '主观题预批',
  diagnosis: '学情诊断',
};

export interface DashboardData {
  teacherCount: number;
  studentCount: number;
  weekAttendanceRate: number | null;
  monthAiCost: number;
  todayLessonCount: number;
  recentEvents: { text: string; time: string }[];
}

export interface AuditLogItem {
  actorName: string;
  action: string;
  targetType: string | null;
  createdAt: string;
}

@Injectable()
export class InsightsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly auth: AuthService,
  ) {}

  // ---------------- 总览 ----------------
  async dashboard(): Promise<DashboardData> {
    const todayStart = utcDayStart();
    const todayEnd = new Date(todayStart.getTime() + 86400_000);
    const [teacherCount, studentCount, monthCost, todayLessonCount, recent] = await Promise.all([
      this.prisma.client.user.count({ where: { role: 'teacher', deletedAt: null } }),
      this.prisma.client.user.count({ where: { role: 'student', deletedAt: null } }),
      this.prisma.client.aiCall.aggregate({
        where: { createdAt: { gte: utcMonthStart() } },
        _sum: { cost: true },
      }),
      this.prisma.client.lesson.count({
        where: { scheduledStart: { gte: todayStart, lt: todayEnd } },
      }),
      this.prisma.client.auditLog.findMany({ orderBy: { id: 'desc' }, take: 5 }),
    ]);

    // 近 7 天到课率:已结束会话的实际加入人次 / 应到人次;无会话 → null
    const weekSessions = await this.prisma.client.classSession.findMany({
      where: { status: 'ended', actualEnd: { gte: daysAgoUtc(7) } },
      select: { id: true },
    });
    let weekAttendanceRate: number | null = null;
    if (weekSessions.length) {
      const ids = weekSessions.map((s) => s.id);
      const [total, joined] = await Promise.all([
        this.prisma.client.sessionParticipant.count({ where: { sessionId: { in: ids } } }),
        this.prisma.client.sessionParticipant.count({
          where: { sessionId: { in: ids }, joinAt: { not: null } },
        }),
      ]);
      weekAttendanceRate = total > 0 ? round2(joined / total) : null;
    }

    const actorNames = await this.actorNames(recent.map((r) => r.actorId));
    return {
      teacherCount,
      studentCount,
      weekAttendanceRate: dec(weekAttendanceRate),
      monthAiCost: round4(Number(monthCost._sum.cost ?? 0)),
      todayLessonCount,
      recentEvents: recent.map((r) => ({
        text: `${actorNames.get(String(r.actorId)) ?? '系统'} · ${r.action}`,
        time: iso(r.createdAt),
      })),
    };
  }

  // ---------------- AI 用量 · 摘要 ----------------
  async aiUsageSummary(): Promise<AiUsageSummaryDto> {
    const monthStart = utcMonthStart();
    const [agg, quota, lessonRefs] = await Promise.all([
      this.prisma.client.aiCall.aggregate({
        where: { createdAt: { gte: monthStart } },
        _sum: { tokensIn: true, tokensOut: true, cost: true },
      }),
      this.prisma.client.aiQuota.findFirst({ where: { period: periodOf() } }),
      this.prisma.client.aiCall.findMany({
        where: { createdAt: { gte: monthStart }, lessonId: { not: null } },
        select: { lessonId: true },
        distinct: ['lessonId'],
      }),
    ]);
    const totalCost = round4(Number(agg._sum.cost ?? 0));
    const monthlyLimit = Number(quota?.monthlyLimit ?? 0);
    return {
      period: periodOf(),
      totalTokens: (agg._sum.tokensIn ?? 0) + (agg._sum.tokensOut ?? 0),
      totalCost,
      monthlyLimit,
      usedPercent: monthlyLimit > 0 ? round2((totalCost / monthlyLimit) * 100) : 0,
      avgCostPerLesson: lessonRefs.length ? round4(totalCost / lessonRefs.length) : null,
    };
  }

  // ---------------- AI 用量 · 近 N 日曲线(零填充) ----------------
  async aiUsageDaily(days: number): Promise<{ date: string; tokens: number; cost: number }[]> {
    const since = daysAgoUtc(days - 1);
    const calls = await this.prisma.client.aiCall.findMany({
      where: { createdAt: { gte: since } },
      select: { createdAt: true, tokensIn: true, tokensOut: true, cost: true },
    });
    const buckets = new Map<string, { tokens: number; cost: number }>();
    for (let i = 0; i < days; i++) {
      buckets.set(dayKey(new Date(since.getTime() + i * 86400_000)), { tokens: 0, cost: 0 });
    }
    for (const c of calls) {
      const b = buckets.get(dayKey(c.createdAt));
      if (!b) continue;
      b.tokens += c.tokensIn + c.tokensOut;
      b.cost += Number(c.cost);
    }
    return [...buckets.entries()].map(([date, b]) => ({
      date,
      tokens: b.tokens,
      cost: round4(b.cost),
    }));
  }

  // ---------------- AI 用量 · 按功能拆分(本月) ----------------
  async aiUsageBreakdown(): Promise<AiUsageBreakdownDto[]> {
    const rows = await this.prisma.client.aiCall.groupBy({
      by: ['feature'],
      where: { createdAt: { gte: utcMonthStart() } },
      _sum: { tokensIn: true, tokensOut: true, cost: true },
    });
    const totalCost = rows.reduce((s, r) => s + Number(r._sum.cost ?? 0), 0);
    return rows
      .map((r) => {
        const cost = round4(Number(r._sum.cost ?? 0));
        return {
          key: r.feature,
          label: FEATURE_LABELS[r.feature] ?? r.feature,
          tokens: (r._sum.tokensIn ?? 0) + (r._sum.tokensOut ?? 0),
          cost,
          percent: totalCost > 0 ? round2((cost / totalCost) * 100) : 0,
        };
      })
      .sort((a, b) => b.cost - a.cost);
  }

  // ---------------- 额度读写 ----------------
  async quotaGet(): Promise<{ monthlyLimit: number; alertThreshold: number; overPolicy: string }> {
    const quota = await this.prisma.client.aiQuota.findFirst({ where: { period: periodOf() } });
    return {
      monthlyLimit: Number(quota?.monthlyLimit ?? 0),
      alertThreshold: quota?.alertThreshold ?? 80,
      overPolicy: quota?.overPolicy ?? 'disable_qa',
    };
  }

  async quotaPut(user: JwtUser, dto: AiQuotaInputDto, ip?: string): Promise<null> {
    const period = periodOf();
    await this.prisma.client.aiQuota.upsert({
      where: { orgId_period: { orgId: BigInt(user.orgId), period } },
      update: { monthlyLimit: dto.monthlyLimit, alertThreshold: dto.alertThreshold, overPolicy: dto.overPolicy },
      create: { orgId: BigInt(user.orgId), period, monthlyLimit: dto.monthlyLimit, alertThreshold: dto.alertThreshold, overPolicy: dto.overPolicy },
    });
    await this.audit.log({
      actorId: user.uid, orgId: user.orgId, action: 'admin.ai_quota.update',
      targetType: 'ai_quota', detail: { ...dto }, ip,
    });
    return null;
  }

  // ---------------- 设置读写 ----------------
  async settingsGet(user: JwtUser): Promise<MeDto> {
    return this.auth.me(user);
  }

  async settingsPut(user: JwtUser, dto: SettingsInputDto, ip?: string): Promise<null> {
    const org = await this.prisma.client.org.findFirstOrThrow({});
    const settings = (org.settings ?? {}) as Record<string, any>;
    // AI 功能开关统一写进 settings.ai 子对象;缺省字段不动(保留既有值)。
    // qaGuideOnly→qa.service;preGrading→attempt.service 预批入队门禁;
    // classCompanion→classroom 旁白;diagnosis→analytics 诊断端点门禁。
    const aiPatch: Record<string, boolean> = {};
    if (dto.qaGuideOnly !== undefined) aiPatch.qaGuideOnly = dto.qaGuideOnly;
    if (dto.preGrading !== undefined) aiPatch.preGrading = dto.preGrading;
    if (dto.classCompanion !== undefined) aiPatch.classCompanion = dto.classCompanion;
    if (dto.diagnosis !== undefined) aiPatch.diagnosis = dto.diagnosis;
    if (Object.keys(aiPatch).length) {
      settings.ai = { ...(settings.ai ?? {}), ...aiPatch };
    }
    if (dto.studentHours) {
      settings.studentHours = { start: dto.studentHours.start, end: dto.studentHours.end };
    }
    await this.prisma.client.org.update({ where: { id: org.id }, data: { settings } });
    await this.audit.log({
      actorId: user.uid, orgId: user.orgId, action: 'admin.settings.update',
      targetType: 'org', targetId: num(org.id), detail: { ...dto }, ip,
    });
    return null;
  }

  // ---------------- 审计日志 ----------------
  async auditLogs(q: PageQueryDto): Promise<PageResp<AuditLogItem>> {
    const [rows, total] = await Promise.all([
      this.prisma.client.auditLog.findMany({
        orderBy: { id: 'desc' },
        skip: (q.page - 1) * q.size,
        take: q.size,
      }),
      this.prisma.client.auditLog.count(),
    ]);
    const actorNames = await this.actorNames(rows.map((r) => r.actorId));
    return {
      items: rows.map((r) => ({
        actorName: actorNames.get(String(r.actorId)) ?? '系统',
        action: r.action,
        targetType: r.targetType ?? null,
        createdAt: iso(r.createdAt),
      })),
      total,
    };
  }

  // ---------------- 内部 ----------------
  private async actorNames(actorIds: bigint[]): Promise<Map<string, string>> {
    if (!actorIds.length) return new Map();
    const users = await this.prisma.client.user.findMany({
      where: { id: { in: [...new Set(actorIds.map(String))].map(BigInt) } },
      select: { id: true, name: true },
    });
    return new Map(users.map((u) => [String(u.id), u.name]));
  }
}
