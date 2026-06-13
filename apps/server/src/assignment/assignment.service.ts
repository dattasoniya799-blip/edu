import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { AssignmentBriefDto, AssignmentDto } from '@qiming/contracts';
import { iso, num } from '../admin/helpers';
import type { JwtUser } from '../auth/auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { AssignmentInputDto, AssignmentListQueryDto } from './assignment.dto';

export interface AssignmentProgress {
  submitted: number;
  totalStudents: number;
  gradedSubjective: number;
  pendingSubjective: number;
}

const PAPER_JOIN = {
  paper: { select: { name: true, totalScore: true, _count: { select: { questions: true } } } },
};

type AssignmentRow = {
  id: bigint;
  paperId: bigint;
  lessonId: bigint | null;
  kind: AssignmentDto['kind'];
  target: unknown;
  publishAt: Date;
  dueAt: Date | null;
  scoreCounted: boolean;
  paper: { name: string; totalScore: unknown; _count: { questions: number } };
};

/**
 * 作业发布(任务卡 A4):
 * - target 支持 {courseId}(整班)或 {studentIds}(指定学生),二选一
 * - 订正/错题重做(correction/wrong_redo)不计分:scoreCounted=false
 * - listForStudent 是学生可见性(目标解析)的唯一口径,A5 的 /student/assignments 直接复用
 */
@Injectable()
export class AssignmentService {
  constructor(private readonly prisma: PrismaService) {}

  /** POST /assignments */
  async create(_user: JwtUser, dto: AssignmentInputDto): Promise<AssignmentDto> {
    const paper = await this.prisma.client.paper.findFirst({
      where: { id: BigInt(dto.paperId) },
      select: { id: true },
    });
    if (!paper) throw new NotFoundException('试卷不存在');

    const target = await this.resolveTarget(dto);

    let lessonCourseId: bigint | null = null;
    if (dto.lessonId != null) {
      const lesson = await this.prisma.client.lesson.findFirst({
        where: { id: BigInt(dto.lessonId) },
        select: { id: true, courseId: true },
      });
      if (!lesson) throw new NotFoundException('讲次不存在');
      lessonCourseId = lesson.courseId;
    }

    // FIX4 · #4:讲次与目标必须一致 —— 讲次属于目标课程 / 目标学生在该讲次所属课程在册
    await this.assertTargetConsistency(target, lessonCourseId);

    const created = await this.prisma.client.assignment.create({
      data: {
        paperId: paper.id,
        lessonId: dto.lessonId != null ? BigInt(dto.lessonId) : null,
        kind: dto.kind,
        target: target as object,
        dueAt: dto.dueAt ? new Date(dto.dueAt) : null,
        scoreCounted: dto.kind !== 'correction' && dto.kind !== 'wrong_redo',
      } as never,
      include: PAPER_JOIN,
    });
    return this.toDto(created as AssignmentRow);
  }

  /** GET /assignments/:id/progress */
  async progress(id: number): Promise<AssignmentProgress> {
    const a = await this.prisma.client.assignment.findFirst({
      where: { id: BigInt(id) },
      select: { id: true, paperId: true, target: true },
    });
    if (!a) throw new NotFoundException('作业不存在');

    const target = a.target as { courseId?: number; studentIds?: number[] };
    const totalStudents =
      target.courseId != null
        ? await this.prisma.client.courseStudent.count({
            where: { courseId: BigInt(target.courseId), status: 'active' },
          })
        : (target.studentIds ?? []).length;

    const submittedRows = await this.prisma.client.attempt.groupBy({
      by: ['studentId'],
      where: { assignmentId: a.id, status: { in: ['submitted', 'graded'] } },
    });
    const submitted = submittedRows.length;

    // 主观题(solution)复核进度:graded = grading_records.final_score 已写入
    const subjective = await this.prisma.client.paperQuestion.findMany({
      where: { paperId: a.paperId, question: { type: 'solution' } },
      select: { questionId: true },
    });
    let gradedSubjective = 0;
    let pendingSubjective = 0;
    if (subjective.length) {
      const subjIds = subjective.map((s) => s.questionId);
      const answerWhere = {
        questionId: { in: subjIds },
        attempt: { assignmentId: a.id, status: { in: ['submitted', 'graded'] as never } },
      };
      const [totalSubjAnswers, graded] = await Promise.all([
        this.prisma.client.answer.count({ where: answerWhere }),
        this.prisma.client.gradingRecord.count({
          where: { finalScore: { not: null }, answer: answerWhere },
        }),
      ]);
      gradedSubjective = graded;
      pendingSubjective = totalSubjAnswers - graded;
    }
    return { submitted, totalStudents, gradedSubjective, pendingSubjective };
  }

  /**
   * GET /assignments 作业总览(C3-back #C,[teacher]):教师布置过的全部作业 + 进度概览。
   * 归属:作业的 lesson.course 或 target.courseId 属于本教师课程(他师/跨租户天然不出现)。
   * - submitted = 已交学生数(attempt status∈{submitted,graded},按学生去重)
   * - graded    = 已出分学生数(attempt status=graded 去重)
   * - status    = finished(已有提交且全部出分,即 finalize 完成)/ ongoing(其余)
   */
  async briefList(user: JwtUser, q: AssignmentListQueryDto): Promise<AssignmentBriefDto[]> {
    const myCourses = await this.prisma.client.course.findMany({
      where: { teacherId: BigInt(user.uid), deletedAt: null },
      select: { id: true },
    });
    const myCourseIds = new Set(myCourses.map((c) => String(c.id)));
    if (!myCourseIds.size) return [];

    const rows = await this.prisma.client.assignment.findMany({
      where: { ...(q.lessonId != null ? { lessonId: BigInt(q.lessonId) } : {}) },
      include: {
        paper: { select: { name: true } },
        lesson: { select: { id: true, title: true, courseId: true } },
        attempts: { select: { studentId: true, status: true } },
      },
      orderBy: { id: 'desc' },
    });

    const owned = rows.filter((a) => {
      const t = a.target as { courseId?: number; studentIds?: number[] };
      const lessonCourseId = a.lesson ? String(a.lesson.courseId) : null;
      const targetCourseId = t.courseId != null ? String(t.courseId) : null;
      const mine =
        (lessonCourseId != null && myCourseIds.has(lessonCourseId)) ||
        (targetCourseId != null && myCourseIds.has(targetCourseId));
      if (!mine) return false;
      if (q.courseId != null) {
        const cid = String(q.courseId);
        return lessonCourseId === cid || targetCourseId === cid;
      }
      return true;
    });

    // totalStudents:整班 → active 选课数(批量 groupBy 避免 N+1);studentIds → 数组长度
    const courseTargetIds = [
      ...new Set(
        owned
          .map((a) => (a.target as { courseId?: number }).courseId)
          .filter((v): v is number => v != null),
      ),
    ];
    const courseCounts = new Map<string, number>();
    if (courseTargetIds.length) {
      const grouped = await this.prisma.client.courseStudent.groupBy({
        by: ['courseId'],
        where: { courseId: { in: courseTargetIds.map(BigInt) }, status: 'active' },
        _count: { _all: true },
      });
      for (const g of grouped) courseCounts.set(String(g.courseId), g._count._all);
    }

    const briefs: AssignmentBriefDto[] = owned.map((a) => {
      const t = a.target as { courseId?: number; studentIds?: number[] };
      const totalStudents =
        t.courseId != null
          ? courseCounts.get(String(t.courseId)) ?? 0
          : (t.studentIds ?? []).length;
      const submittedSet = new Set<string>();
      const gradedSet = new Set<string>();
      for (const at of a.attempts) {
        if (at.status === 'submitted' || at.status === 'graded')
          submittedSet.add(String(at.studentId));
        if (at.status === 'graded') gradedSet.add(String(at.studentId));
      }
      const submitted = submittedSet.size;
      const graded = gradedSet.size;
      const status: 'ongoing' | 'finished' =
        submitted > 0 && graded === submitted ? 'finished' : 'ongoing';
      return {
        id: num(a.id),
        paperName: a.paper.name,
        lessonId: a.lessonId == null ? null : num(a.lessonId),
        lessonTitle: a.lesson?.title ?? null,
        kind: a.kind,
        publishAt: iso(a.publishAt),
        dueAt: iso(a.dueAt),
        submitted,
        totalStudents,
        graded,
        status,
      };
    });

    return q.status ? briefs.filter((b) => b.status === q.status) : briefs;
  }

  /**
   * 学生可见作业(目标解析口径,A5 /student/assignments 复用):
   * - target.courseId → 学生在该课程的有效选课(active)
   * - target.studentIds → 包含该学生
   * - status:pending=未交,done=已交(submitted/graded),all=全部
   */
  async listForStudent(
    user: JwtUser,
    status: 'pending' | 'done' | 'all' = 'pending',
  ): Promise<AssignmentDto[]> {
    const sid = BigInt(user.uid);
    const enrolled = await this.prisma.client.courseStudent.findMany({
      where: { studentId: sid, status: 'active' },
      select: { courseId: true },
    });
    const myCourses = new Set(enrolled.map((e) => num(e.courseId)));

    const all = await this.prisma.client.assignment.findMany({
      where: { publishAt: { lte: new Date() } },
      include: PAPER_JOIN,
      orderBy: { id: 'desc' },
    });
    const visible = all.filter((a) => {
      const t = a.target as { courseId?: number; studentIds?: number[] };
      return t.courseId != null
        ? myCourses.has(Number(t.courseId))
        : (t.studentIds ?? []).includes(num(sid));
    });
    if (status === 'all') return visible.map((a) => this.toDto(a as AssignmentRow));

    const doneRows = visible.length
      ? await this.prisma.client.attempt.findMany({
          where: {
            studentId: sid,
            assignmentId: { in: visible.map((a) => a.id) },
            status: { in: ['submitted', 'graded'] },
          },
          select: { assignmentId: true },
        })
      : [];
    const done = new Set(doneRows.map((r) => String(r.assignmentId)));
    return visible
      .filter((a) => (status === 'done' ? done.has(String(a.id)) : !done.has(String(a.id))))
      .map((a) => this.toDto(a as AssignmentRow));
  }

  // ---------------- 内部 ----------------

  /** target 互斥校验 + 引用存在性(跨租户经租户注入自然 404) */
  private async resolveTarget(
    dto: AssignmentInputDto,
  ): Promise<{ courseId: number } | { studentIds: number[] }> {
    const hasCourse = dto.target.courseId != null;
    const hasStudents = (dto.target.studentIds ?? []).length > 0;
    if (hasCourse === hasStudents)
      throw new BadRequestException('target 必须且只能提供 courseId 或 studentIds 之一');

    if (hasCourse) {
      const course = await this.prisma.client.course.findFirst({
        where: { id: BigInt(dto.target.courseId!), deletedAt: null },
        select: { id: true },
      });
      if (!course) throw new NotFoundException('课程不存在');
      return { courseId: dto.target.courseId! };
    }
    const ids = [...new Set(dto.target.studentIds!)];
    const found = await this.prisma.client.user.count({
      where: { id: { in: ids.map(BigInt) }, role: 'student', deletedAt: null },
    });
    if (found !== ids.length) throw new NotFoundException('学生不存在');
    return { studentIds: ids };
  }

  /**
   * FIX4 · #4:作业一致性校验(仅当挂了讲次才有"目标课程"可比对):
   * - target.courseId:必须等于讲次所属课程(挂 A 课讲次却发给 B 课 → 400);
   * - target.studentIds:每个学生都须为讲次所属课程的 active 在册学生(否则 → 400)。
   * 业务错误,统一 400(BadRequestException);无讲次时不约束(沿用原行为)。
   */
  private async assertTargetConsistency(
    target: { courseId: number } | { studentIds: number[] },
    lessonCourseId: bigint | null,
  ): Promise<void> {
    if (lessonCourseId == null) return;
    if ('courseId' in target) {
      if (BigInt(target.courseId) !== lessonCourseId)
        throw new BadRequestException('讲次不属于目标课程');
      return;
    }
    const enrolled = await this.prisma.client.courseStudent.count({
      where: {
        courseId: lessonCourseId,
        studentId: { in: target.studentIds.map(BigInt) },
        status: 'active',
      },
    });
    if (enrolled !== target.studentIds.length)
      throw new BadRequestException('目标学生不在该讲次所属课程在册');
  }

  private toDto(a: AssignmentRow): AssignmentDto {
    return {
      id: num(a.id),
      paperId: num(a.paperId),
      paperName: a.paper.name,
      lessonId: a.lessonId == null ? null : num(a.lessonId),
      kind: a.kind,
      target: a.target as AssignmentDto['target'],
      publishAt: iso(a.publishAt),
      dueAt: iso(a.dueAt),
      scoreCounted: a.scoreCounted,
      questionCount: a.paper._count.questions,
      totalScore: Number(a.paper.totalScore),
    };
  }
}
