import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { AssignmentDto } from '@qiming/contracts';
import { iso, num } from '../admin/helpers';
import type { JwtUser } from '../auth/auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { AssignmentInputDto } from './assignment.dto';

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

    if (dto.lessonId != null) {
      const lesson = await this.prisma.client.lesson.findFirst({
        where: { id: BigInt(dto.lessonId) },
        select: { id: true },
      });
      if (!lesson) throw new NotFoundException('讲次不存在');
    }

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
