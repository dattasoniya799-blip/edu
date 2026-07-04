import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { AiDiagnosisDto, MasteryItemDto } from '@qiming/contracts';
import { DiagnosisService } from '../ai/features/diagnosis.service';
import { daysAgoUtc, iso, num } from '../admin/helpers';
import type { JwtUser } from '../auth/auth.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * A8 · 学情聚合(openapi /analytics/*)
 * - 课程掌握热力:按 course 的 active 选课学生聚合 mastery_snapshots,
 *   只取 curriculum 维度(节点所属图谱 graphType=curriculum_knowledge)。
 * - 重点关注:任一 curriculum 节点 mastery<60 或 近 7 日未活跃(无作答活动),reason 文案化。
 * - 单生 30 天报告:mastery 全维度快照 + 错题 open 数 + 近 30 天作答次数。
 * 口径(契约未明说处,README A8 节同步):
 * - 「活跃」= 近 7 日(UTC 日对齐窗口)内有任一 attempt 开始或交卷;
 * - attempts30d = 近 30 天(UTC 日对齐)内开始的 attempts 总数(不限状态);
 * - 空数据(无学生/无快照)一律返回空数组,不报错;课程/学生不存在或跨租户 → 404。
 */

export interface CourseMasteryItem {
  nodeId: number;
  nodeName: string;
  avgMastery: number;
  studentCount: number;
}

export interface AttentionItem {
  studentId: number;
  name: string;
  reason: string;
}

export interface StudentReportData {
  mastery: MasteryItemDto[];
  wrongOpenCount: number;
  attempts30d: number;
}

const LOW_MASTERY = 60;
const INACTIVE_DAYS = 7;
const REPORT_DAYS = 30;

@Injectable()
export class AnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly diagnosis: DiagnosisService,
  ) {}

  // ---------------- 课程掌握热力 ----------------
  async courseMastery(courseId: number): Promise<CourseMasteryItem[]> {
    const course = await this.courseOr404(courseId);
    const studentIds = await this.activeStudentIds(course.id);
    if (!studentIds.length) return [];

    const snaps = await this.curriculumSnapshots(studentIds);
    const byNode = new Map<string, { nodeId: bigint; nodeName: string; sum: number; count: number }>();
    for (const s of snaps) {
      const k = String(s.nodeId);
      const cur = byNode.get(k) ?? { nodeId: s.nodeId, nodeName: s.node.name, sum: 0, count: 0 };
      cur.sum += s.mastery;
      cur.count += 1; // (studentId,nodeId) 唯一 → 每行即一名学生
      byNode.set(k, cur);
    }
    return [...byNode.values()]
      .sort((a, b) => Number(a.nodeId - b.nodeId))
      .map((n) => ({
        nodeId: num(n.nodeId),
        nodeName: n.nodeName,
        avgMastery: Math.round(n.sum / n.count),
        studentCount: n.count,
      }));
  }

  // ---------------- 重点关注学生 ----------------
  async courseAttention(courseId: number): Promise<AttentionItem[]> {
    const course = await this.courseOr404(courseId);
    const studentIds = await this.activeStudentIds(course.id);
    if (!studentIds.length) return [];

    const since = daysAgoUtc(INACTIVE_DAYS);
    const [students, lowSnaps, activeRows] = await Promise.all([
      this.prisma.client.user.findMany({
        where: { id: { in: studentIds }, role: 'student', deletedAt: null },
        select: { id: true, name: true },
        orderBy: { id: 'asc' },
      }),
      this.curriculumSnapshots(studentIds, { mastery: { lt: LOW_MASTERY } }),
      this.prisma.client.attempt.findMany({
        where: {
          studentId: { in: studentIds },
          OR: [{ startedAt: { gte: since } }, { submittedAt: { gte: since } }],
        },
        select: { studentId: true },
      }),
    ]);

    const lowByStudent = new Map<string, { name: string; mastery: number; nodeId: bigint }[]>();
    for (const s of lowSnaps) {
      const k = String(s.studentId);
      if (!lowByStudent.has(k)) lowByStudent.set(k, []);
      lowByStudent.get(k)!.push({ name: s.node.name, mastery: s.mastery, nodeId: s.nodeId });
    }
    const activeSet = new Set(activeRows.map((a) => String(a.studentId)));

    const items: AttentionItem[] = [];
    for (const stu of students) {
      const k = String(stu.id);
      const lows = (lowByStudent.get(k) ?? []).sort(
        (a, b) => a.mastery - b.mastery || Number(a.nodeId - b.nodeId),
      );
      const reasons: string[] = [];
      if (lows.length === 1) {
        reasons.push(`「${lows[0].name}」掌握度 ${lows[0].mastery},低于 ${LOW_MASTERY}`);
      } else if (lows.length > 1) {
        reasons.push(
          `「${lows[0].name}」等 ${lows.length} 个知识点掌握度低于 ${LOW_MASTERY}(最低 ${lows[0].mastery})`,
        );
      }
      if (!activeSet.has(k)) reasons.push(`近 ${INACTIVE_DAYS} 日未活跃`);
      if (!reasons.length) continue;
      items.push({ studentId: num(stu.id), name: stu.name, reason: reasons.join(';') });
    }
    return items;
  }

  // ---------------- 单生 30 天报告 ----------------
  async studentReport(studentId: number): Promise<StudentReportData> {
    const student = await this.prisma.client.user.findFirst({
      where: { id: BigInt(studentId), role: 'student', deletedAt: null },
      select: { id: true },
    });
    if (!student) throw new NotFoundException('学生不存在');

    const [snaps, wrongOpenCount, attempts30d] = await Promise.all([
      this.prisma.client.masterySnapshot.findMany({
        where: { studentId: student.id },
        include: { node: { select: { name: true, graph: { select: { graphType: true } } } } },
        orderBy: { nodeId: 'asc' },
      }),
      this.prisma.client.wrongBookEntry.count({
        where: { studentId: student.id, status: 'open' },
      }),
      this.prisma.client.attempt.count({
        where: { studentId: student.id, startedAt: { gte: daysAgoUtc(REPORT_DAYS) } },
      }),
    ]);

    return {
      mastery: snaps.map((m) => ({
        nodeId: num(m.nodeId),
        nodeName: m.node.name,
        graphType: m.node.graph.graphType,
        mastery: m.mastery,
        sampleCount: m.sampleCount,
      })),
      wrongOpenCount,
      attempts30d,
    };
  }

  // ---------------- AI 学情诊断 ----------------
  /**
   * POST /analytics/students/:id/diagnose:聚合该生掌握度(curriculum 快照)+ 未清错题 +
   * 近 30 天作答,喂 DiagnosisService(feature=diagnosis)产出诊断文字与薄弱知识点。
   * 受 org.settings.ai.diagnosis 开关控制(关则 4xx);学生须属本机构(租户注入 → 跨租户 404)。
   */
  async diagnose(user: JwtUser, studentId: number): Promise<AiDiagnosisDto> {
    if (!(await this.diagnosisEnabled()))
      throw new ForbiddenException('AI学情诊断未开启,请联系机构管理员在平台设置中开启');

    const student = await this.prisma.client.user.findFirst({
      where: { id: BigInt(studentId), role: 'student', deletedAt: null },
      select: { id: true },
    });
    if (!student) throw new NotFoundException('学生不存在');

    const [snaps, wrongOpenCount, attempts30d] = await Promise.all([
      this.prisma.client.masterySnapshot.findMany({
        where: {
          studentId: student.id,
          node: { graph: { graphType: 'curriculum_knowledge' } },
        },
        include: { node: { select: { name: true } } },
        orderBy: { mastery: 'asc' },
      }),
      this.prisma.client.wrongBookEntry.count({
        where: { studentId: student.id, status: 'open' },
      }),
      this.prisma.client.attempt.count({
        where: { studentId: student.id, startedAt: { gte: daysAgoUtc(REPORT_DAYS) } },
      }),
    ]);
    const weakNodes = snaps
      .filter((s) => s.mastery < LOW_MASTERY)
      .slice(0, 5)
      .map((s) => ({ name: s.node.name, mastery: s.mastery }));

    const out = await this.diagnosis.diagnose({
      orgId: user.orgId,
      studentId: num(student.id),
      days: REPORT_DAYS,
      attemptCount: attempts30d,
      wrongCount: wrongOpenCount,
      weakNodes,
      trace: { userId: user.uid },
    });

    return {
      summary: out.summary,
      weakPoints: weakNodes.map((n) => ({
        kpName: n.name,
        reason: `掌握度 ${n.mastery},低于 ${LOW_MASTERY}`,
      })),
      generatedAt: iso(new Date()),
    };
  }

  /** org.settings.ai.diagnosis 开关(默认关:opt-in 特性,未显式开启则拒绝) */
  private async diagnosisEnabled(): Promise<boolean> {
    const org = await this.prisma.client.org.findFirst({ select: { settings: true } });
    const ai = (org?.settings as { ai?: { diagnosis?: boolean } } | null)?.ai;
    return ai?.diagnosis === true;
  }

  // ---------------- 内部 ----------------
  private async courseOr404(id: number) {
    const course = await this.prisma.client.course.findFirst({
      where: { id: BigInt(id), deletedAt: null },
      select: { id: true },
    });
    if (!course) throw new NotFoundException('课程不存在'); // 跨租户经租户注入天然 404(宪法 §7)
    return course;
  }

  private async activeStudentIds(courseId: bigint): Promise<bigint[]> {
    const rows = await this.prisma.client.courseStudent.findMany({
      where: { courseId, status: 'active' },
      select: { studentId: true },
    });
    return rows.map((r) => r.studentId);
  }

  /** 只取 curriculum 维度快照(graphType=curriculum_knowledge),可附加 mastery 过滤 */
  private curriculumSnapshots(studentIds: bigint[], extra: { mastery?: { lt: number } } = {}) {
    return this.prisma.client.masterySnapshot.findMany({
      where: {
        studentId: { in: studentIds },
        node: { graph: { graphType: 'curriculum_knowledge' } },
        ...extra,
      },
      include: { node: { select: { name: true } } },
    });
  }
}
