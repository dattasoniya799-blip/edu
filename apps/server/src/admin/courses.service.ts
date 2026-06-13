import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { CourseDto, PageResp } from '@qiming/contracts';
import { AuditService } from '../audit/audit.service';
import type { JwtUser } from '../auth/auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { CourseInputDto, CourseListQueryDto } from './admin.dto';
import { dec, iso, num, round2 } from './helpers';

export interface RosterItem {
  studentId: number;
  name: string;
  attendance: string;
  homeworkAvg: number | null;
  status: string;
}

type CourseRow = {
  id: bigint;
  name: string;
  classType: 'group' | 'one_on_one' | 'one_on_three';
  subject: string;
  stage: string;
  teacherId: bigint;
  totalLessons: number;
  status: 'draft' | 'ongoing' | 'finished' | 'archived';
};

@Injectable()
export class CoursesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ---------------- 列表 ----------------
  async list(q: CourseListQueryDto): Promise<PageResp<CourseDto>> {
    const where = {
      deletedAt: null,
      ...(q.classType ? { classType: q.classType } : {}),
      ...(q.keyword ? { name: { contains: q.keyword } } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.client.course.findMany({
        where,
        orderBy: { id: 'asc' },
        skip: (q.page - 1) * q.size,
        take: q.size,
      }),
      this.prisma.client.course.count({ where }),
    ]);
    return { items: await this.decorate(rows), total };
  }

  // ---------------- 创建(自动生成 totalLessons 个空讲次) ----------------
  async create(user: JwtUser, dto: CourseInputDto, ip?: string): Promise<CourseDto> {
    await this.assertTeacherExists(dto.teacherId);
    const studentIds = await this.assertStudentsExist(dto.studentIds ?? []);

    const orgId = BigInt(user.orgId);
    const created = await this.prisma.client.$transaction(async (tx) => {
      const course = await tx.course.create({
        data: {
          orgId,
          name: dto.name,
          classType: dto.classType,
          subject: dto.subject,
          stage: dto.stage,
          teacherId: BigInt(dto.teacherId),
          totalLessons: dto.totalLessons,
        },
      });
      await tx.lesson.createMany({
        data: Array.from({ length: dto.totalLessons }, (_, i) => ({
          orgId,
          courseId: course.id,
          seq: i + 1,
          title: `第${i + 1}讲`,
          status: 'draft' as const,
          prepChecklist: {},
        })),
      });
      if (studentIds.length) {
        await tx.courseStudent.createMany({
          data: studentIds.map((sid) => ({ orgId, courseId: course.id, studentId: sid })),
        });
      }
      return course;
    });
    await this.audit.log({
      actorId: user.uid, orgId: user.orgId, action: 'admin.course.create',
      targetType: 'course', targetId: num(created.id), ip,
    });
    const [item] = await this.decorate([created]);
    return item;
  }

  // ---------------- 编辑 ----------------
  async update(user: JwtUser, id: number, dto: CourseInputDto, ip?: string): Promise<null> {
    const course = await this.findCourseOr404(id);
    await this.assertTeacherExists(dto.teacherId);
    const orgId = BigInt(user.orgId);

    await this.prisma.client.$transaction(async (tx) => {
      // 讲次数变化:增 → 追加空讲次;减 → 仅当多余讲次为未排课的空草稿时允许删除
      if (dto.totalLessons > course.totalLessons) {
        await tx.lesson.createMany({
          data: Array.from(
            { length: dto.totalLessons - course.totalLessons },
            (_, i) => ({
              orgId,
              courseId: course.id,
              seq: course.totalLessons + i + 1,
              title: `第${course.totalLessons + i + 1}讲`,
              status: 'draft' as const,
              prepChecklist: {},
            }),
          ),
        });
      } else if (dto.totalLessons < course.totalLessons) {
        const extra = await tx.lesson.findMany({
          where: { courseId: course.id, seq: { gt: dto.totalLessons } },
          select: { id: true, status: true },
        });
        const extraIds = extra.map((l) => l.id);
        const [segCount, assignCount] = await Promise.all([
          tx.lessonSegment.count({ where: { lessonId: { in: extraIds } } }),
          tx.assignment.count({ where: { lessonId: { in: extraIds } } }),
        ]);
        if (extra.some((l) => l.status !== 'draft') || segCount > 0 || assignCount > 0) {
          throw new ConflictException('多余讲次已被编排或使用,无法缩减讲次数');
        }
        await tx.lesson.deleteMany({ where: { id: { in: extraIds } } });
      }
      await tx.course.update({
        where: { id: course.id },
        data: {
          name: dto.name,
          classType: dto.classType,
          subject: dto.subject,
          stage: dto.stage,
          teacherId: BigInt(dto.teacherId),
          totalLessons: dto.totalLessons,
        },
      });
    });
    if (dto.studentIds) await this.syncRoster(orgId, course.id, dto.studentIds);
    await this.audit.log({
      actorId: user.uid, orgId: user.orgId, action: 'admin.course.update',
      targetType: 'course', targetId: id, ip,
    });
    return null;
  }

  // ---------------- 名单(到课/作业概览) ----------------
  async roster(id: number): Promise<RosterItem[]> {
    const course = await this.findCourseOr404(id);
    // 名单 = 当前在册(active)学生;退班(quit)不计入,前端据此判定"可选学生"= 全体 − 在册 active
    const enrollments = await this.prisma.client.courseStudent.findMany({
      where: { courseId: course.id, status: 'active' },
      include: { student: { select: { id: true, name: true } } },
      orderBy: { studentId: 'asc' },
    });

    // 到课:已结束的课堂会话数 + 各学生实际加入次数
    const endedSessions = await this.prisma.client.classSession.findMany({
      where: { status: 'ended', lesson: { courseId: course.id } },
      select: { id: true },
    });
    const sessionIds = endedSessions.map((s) => s.id);
    const joined = sessionIds.length
      ? await this.prisma.client.sessionParticipant.groupBy({
          by: ['studentId'],
          where: { sessionId: { in: sessionIds }, joinAt: { not: null } },
          _count: { _all: true },
        })
      : [];
    const joinedMap = new Map(joined.map((j) => [String(j.studentId), j._count._all]));

    // 作业:本课程 homework 作业的得分率均值(0-100)
    const assignments = await this.prisma.client.assignment.findMany({
      where: { kind: 'homework', lessonId: { not: null }, lesson: { courseId: course.id } },
      include: { paper: { select: { totalScore: true } } },
    });
    const totalScoreMap = new Map(assignments.map((a) => [String(a.id), Number(a.paper.totalScore)]));
    const attempts = assignments.length
      ? await this.prisma.client.attempt.findMany({
          where: { assignmentId: { in: assignments.map((a) => a.id) }, status: 'graded', score: { not: null } },
          select: { assignmentId: true, studentId: true, score: true },
        })
      : [];
    const scoreAcc = new Map<string, { sum: number; n: number }>();
    for (const at of attempts) {
      const total = totalScoreMap.get(String(at.assignmentId)) ?? 0;
      if (total <= 0) continue;
      const key = String(at.studentId);
      const acc = scoreAcc.get(key) ?? { sum: 0, n: 0 };
      acc.sum += (Number(at.score) / total) * 100;
      acc.n += 1;
      scoreAcc.set(key, acc);
    }

    return enrollments.map((e) => {
      const acc = scoreAcc.get(String(e.studentId));
      return {
        studentId: num(e.studentId),
        name: e.student.name,
        attendance: `${joinedMap.get(String(e.studentId)) ?? 0}/${sessionIds.length}`,
        homeworkAvg: acc ? round2(acc.sum / acc.n) : null,
        status: e.status,
      };
    });
  }

  // ---------------- 入班(幂等,置/建 active) ----------------
  async addStudents(user: JwtUser, courseId: number, studentIds: number[], ip?: string): Promise<null> {
    const course = await this.findCourseOr404(courseId);
    const ids = await this.assertStudentsExist(studentIds); // 跨租户/不存在 → 404
    const orgId = BigInt(user.orgId);

    const existing = await this.prisma.client.courseStudent.findMany({
      where: { courseId: course.id, studentId: { in: ids } },
    });
    const existingMap = new Map(existing.map((e) => [String(e.studentId), e]));
    for (const sid of ids) {
      const cur = existingMap.get(String(sid));
      if (!cur) {
        await this.prisma.client.courseStudent.create({ data: { orgId, courseId: course.id, studentId: sid } });
      } else if (cur.status !== 'active') {
        await this.prisma.client.courseStudent.update({ where: { id: cur.id }, data: { status: 'active' } });
      }
    }
    await this.audit.log({
      actorId: user.uid, orgId: user.orgId, action: 'admin.course.add_students',
      targetType: 'course', targetId: courseId, detail: { studentIds }, ip,
    });
    return null;
  }

  // ---------------- 退班(置 quit) ----------------
  async removeStudent(user: JwtUser, courseId: number, studentId: number, ip?: string): Promise<null> {
    const course = await this.findCourseOr404(courseId);
    await this.prisma.client.courseStudent.updateMany({
      where: { courseId: course.id, studentId: BigInt(studentId) },
      data: { status: 'quit' },
    });
    await this.audit.log({
      actorId: user.uid, orgId: user.orgId, action: 'admin.course.remove_student',
      targetType: 'course', targetId: courseId, detail: { studentId }, ip,
    });
    return null;
  }

  // ---------------- 内部 ----------------
  private async findCourseOr404(id: number) {
    const c = await this.prisma.client.course.findFirst({
      where: { id: BigInt(id), deletedAt: null },
    });
    if (!c) throw new NotFoundException('课程不存在');
    return c;
  }

  private async assertTeacherExists(teacherId: number) {
    const t = await this.prisma.client.user.findFirst({
      where: { id: BigInt(teacherId), role: 'teacher', deletedAt: null },
    });
    if (!t) throw new NotFoundException('教师不存在');
  }

  private async assertStudentsExist(studentIds: number[]): Promise<bigint[]> {
    if (!studentIds.length) return [];
    const ids = [...new Set(studentIds)].map(BigInt);
    const found = await this.prisma.client.user.findMany({
      where: { id: { in: ids }, role: 'student', deletedAt: null },
      select: { id: true },
    });
    if (found.length !== ids.length) throw new NotFoundException('学生不存在');
    return ids;
  }

  /** 全量同步课程名单:缺的补 active,多的置 quit */
  private async syncRoster(orgId: bigint, courseId: bigint, studentIds: number[]) {
    const target = await this.assertStudentsExist(studentIds);
    const targetSet = new Set(target.map(String));
    const existing = await this.prisma.client.courseStudent.findMany({ where: { courseId } });
    const existingMap = new Map(existing.map((e) => [String(e.studentId), e]));
    for (const sid of target) {
      const cur = existingMap.get(String(sid));
      if (!cur) {
        await this.prisma.client.courseStudent.create({ data: { orgId, courseId, studentId: sid } });
      } else if (cur.status !== 'active') {
        await this.prisma.client.courseStudent.update({ where: { id: cur.id }, data: { status: 'active' } });
      }
    }
    for (const e of existing) {
      if (!targetSet.has(String(e.studentId)) && e.status === 'active') {
        await this.prisma.client.courseStudent.update({ where: { id: e.id }, data: { status: 'quit' } });
      }
    }
  }

  /**
   * 组装 CourseDto:
   * - currentLesson = 已完结讲次数;nextLessonAt = 未来最近一讲开始时间
   * - attendanceRate = 已结束会话的实际加入率(0-1);无会话数据 → null
   * - homeworkRate = homework 作业的交卷率(0-1);无作业 → null
   */
  private async decorate(rows: CourseRow[]): Promise<CourseDto[]> {
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const now = new Date();

    const [teachers, enrollCnt, lessons, assignments, sessions] = await Promise.all([
      this.prisma.client.user.findMany({
        where: { id: { in: rows.map((r) => r.teacherId) } },
        select: { id: true, name: true },
      }),
      this.prisma.client.courseStudent.groupBy({
        by: ['courseId'], where: { courseId: { in: ids }, status: 'active' }, _count: { _all: true },
      }),
      this.prisma.client.lesson.findMany({
        where: { courseId: { in: ids } },
        select: { courseId: true, status: true, scheduledStart: true },
      }),
      this.prisma.client.assignment.findMany({
        where: { kind: 'homework', lessonId: { not: null }, lesson: { courseId: { in: ids } } },
        include: { lesson: { select: { courseId: true } } },
      }),
      this.prisma.client.classSession.findMany({
        where: { status: 'ended', lesson: { courseId: { in: ids } } },
        include: { lesson: { select: { courseId: true } } },
      }),
    ]);
    const teacherName = new Map(teachers.map((t) => [String(t.id), t.name]));
    const students = new Map(enrollCnt.map((e) => [String(e.courseId), e._count._all]));

    const submitted = assignments.length
      ? await this.prisma.client.attempt.groupBy({
          by: ['assignmentId'],
          where: { assignmentId: { in: assignments.map((a) => a.id) }, status: { in: ['submitted', 'graded'] } },
          _count: { _all: true },
        })
      : [];
    const submittedMap = new Map(submitted.map((s) => [String(s.assignmentId), s._count._all]));

    const joined = sessions.length
      ? await this.prisma.client.sessionParticipant.groupBy({
          by: ['sessionId'],
          where: { sessionId: { in: sessions.map((s) => s.id) }, joinAt: { not: null } },
          _count: { _all: true },
        })
      : [];
    const joinedMap = new Map(joined.map((j) => [String(j.sessionId), j._count._all]));

    return rows.map((c) => {
      const key = String(c.id);
      const myLessons = lessons.filter((l) => String(l.courseId) === key);
      const upcoming = myLessons
        .map((l) => l.scheduledStart)
        .filter((d): d is Date => !!d && d > now)
        .sort((a, b) => a.getTime() - b.getTime());
      const studentCount = students.get(key) ?? 0;

      const myAssignments = assignments.filter((a) => String(a.lesson?.courseId) === key);
      let homeworkRate: number | null = null;
      if (myAssignments.length && studentCount > 0) {
        const done = myAssignments.reduce((s, a) => s + (submittedMap.get(String(a.id)) ?? 0), 0);
        homeworkRate = round2(done / (myAssignments.length * studentCount));
      }

      const mySessions = sessions.filter((s) => String(s.lesson.courseId) === key);
      let attendanceRate: number | null = null;
      if (mySessions.length && studentCount > 0) {
        const joins = mySessions.reduce((s, x) => s + (joinedMap.get(String(x.id)) ?? 0), 0);
        attendanceRate = round2(joins / (mySessions.length * studentCount));
      }

      return {
        id: num(c.id),
        name: c.name,
        classType: c.classType,
        subject: c.subject,
        stage: c.stage,
        teacherId: num(c.teacherId),
        teacherName: teacherName.get(String(c.teacherId)) ?? '',
        totalLessons: c.totalLessons,
        currentLesson: myLessons.filter((l) => l.status === 'finished').length,
        studentCount,
        status: c.status,
        nextLessonAt: upcoming.length ? iso(upcoming[0]) : null,
        attendanceRate: dec(attendanceRate),
        homeworkRate: dec(homeworkRate),
      };
    });
  }
}
