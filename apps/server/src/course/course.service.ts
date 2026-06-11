import { Injectable } from '@nestjs/common';
import type { CourseDto } from '@qiming/contracts';
import { dec, iso, num, round2 } from '../admin/helpers';
import type { JwtUser } from '../auth/auth.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * GET /teacher/courses 聚合(任务卡 A4):
 * - nextLessonAt = 未来最近一讲 scheduled_start;currentLesson = 已完结讲次数
 * - attendanceRate / homeworkRate 口径与 A2 admin 完全一致(0-1,无数据 → null)
 * - 备课进度由各讲次 prep_checklist 表达(契约 Course 无独立字段,经 /courses/:id/lessons 下发)
 */
@Injectable()
export class CourseService {
  constructor(private readonly prisma: PrismaService) {}

  async myCourses(user: JwtUser): Promise<CourseDto[]> {
    const rows = await this.prisma.client.course.findMany({
      where: { teacherId: BigInt(user.uid), deletedAt: null },
      orderBy: { id: 'asc' },
    });
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const now = new Date();

    const [teachers, enrollCnt, lessons, assignments, sessions] = await Promise.all([
      this.prisma.client.user.findMany({
        where: { id: { in: rows.map((r) => r.teacherId) } },
        select: { id: true, name: true },
      }),
      this.prisma.client.courseStudent.groupBy({
        by: ['courseId'],
        where: { courseId: { in: ids }, status: 'active' },
        _count: { _all: true },
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
          where: {
            assignmentId: { in: assignments.map((a) => a.id) },
            status: { in: ['submitted', 'graded'] },
          },
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
