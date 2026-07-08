import { Injectable, NotFoundException } from '@nestjs/common';
import type { AssignmentKind, CourseDto, LessonDto, MasteryItemDto } from '@qiming/contracts';
import { daysAgoUtc, dec, iso, num, round2, utcDayStart } from '../admin/helpers';
import { latestOpenSessions } from '../common/session-lookup';
import { AnalyticsService } from '../analytics/analytics.service';
import { AssignmentService } from '../assignment/assignment.service';
import type { JwtUser } from '../auth/auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { ResourceViewService, VIEW_TTL_SEC } from './resource-view.service';

/**
 * FIX1 · 学生端只读杂项(openapi /student/{today,courses,courses/:id/lessons,report,resources/:id/view}):
 * 契约中存在但 A4/A5 任务卡分工缝隙无人认领的 5 个端点,响应逐字段以 openapi 为唯一规格。
 * 复用纪律:
 * - 作业可见性(target 解析)一律走 A4 AssignmentService.listForStudent(已 export,唯一口径);
 * - mastery / wrongOpenCount 聚合复用 A8 AnalyticsService.studentReport(已 export,口径=README A5/A8);
 * - 课程聚合口径与 A4 CourseService.myCourses 逐字段一致(README A2/A4:currentLesson=已 finished
 *   讲次数、nextLessonAt=未来最近讲次、attendanceRate/homeworkRate 0-1 无数据 null);
 *   CourseModule 未 export 该服务(纪律:不改他人模块),在此按同口径对"我选的课"实现。
 * 口径约定(契约未明说处,README FIX1 节同步):
 * - today.todayLesson:本 UTC 日窗口内 scheduledStart 最早、起止时间齐全的讲次(无 → null);
 *   canEnterAt = startAt - 10min(对齐 A6 状态机"scheduled→live 限 ≥提前 10min");
 *   sessionId = 该讲次最新未结束(status≠ended)的 class_session,无 → null。
 * - today.tasks:全部对我可见的作业(listForStudent 'all',与 B5 mock 口径一致);
 *   progress 取最新 attempt(attemptNo 最大):无 → {0,total,'not_started'},
 *   有 → {已答题数,total,attempt.status('in_progress'|'submitted'|'graded')};
 *   FIXB · B3:kind=in_class 仅在已交(submitted/graded)时保留,未参与的随堂练不进今日任务。
 * - lessons.myHomework:该讲次最新一条对我可见的 homework 作业;score=我最新 attempt 的总分
 *   (graded 前为 null);wrongCount 按 A5 错题口径 —— 客观题 isCorrect=false,
 *   主观题已出分且未拿满分(answers.score < paper_questions.score;B5 mock 同口径);无 attempt → 0。
 * - report.weekStats:近 7 日(UTC 日对齐,同 A2 weekStudySec 窗口)——
 *   answeredCount=窗口内提交的 answers 数;correctRate=其中客观题(isCorrect 非空)正确占比
 *   (0-1,round2,无样本 null);studySec=窗口内 attempts.duration_sec 求和(A2 口径)。
 * - resources/:id/view:课件必须被"我 active 选课课程"的某讲次环节引用,否则 404
 *   (学生只能回看自己课程的课件;跨租户经租户注入天然 404,宪法 §7)。
 */

export interface TodayLessonView {
  lessonId: number;
  courseName: string;
  title: string;
  startAt: string;
  endAt: string;
  canEnterAt: string;
  sessionId: number | null;
}

export interface TodayTaskView {
  assignmentId: number;
  kind: AssignmentKind;
  title: string;
  questionCount: number;
  dueAt: string | null;
  progress: { answered: number; total: number; status: string };
}

export interface StudentTodayData {
  todayLesson: TodayLessonView | null;
  tasks: TodayTaskView[];
}

export interface LessonTimelineItem {
  lesson: LessonDto;
  // FIX4 · #1:该讲未结束 class_session(口径同 /student/today),无则 null;契约已含该字段
  sessionId: number | null;
  // [2026-07-06 批准] attemptId:本人对该讲次作业的最新 attempt id(用于时间线成绩单直达);从未作答时为 null
  myHomework: { assignmentId: number; attemptId: number | null; score: number | null; wrongCount: number } | null;
}

export interface StudentReportData {
  mastery: MasteryItemDto[];
  weekStats: {
    answeredCount: number;
    correctRate: number | null;
    studySec: number;
    wrongOpenCount: number;
  };
}

const DAY_MS = 86400_000;
/** 开课前可进入课堂的提前量(分钟,对齐 A6 scheduled→live 的 10 分钟口径) */
const ENTER_AHEAD_MIN = 10;
const WEEK_DAYS = 7;

@Injectable()
export class StudentMiscService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly assignments: AssignmentService,
    private readonly analytics: AnalyticsService,
    private readonly resourceView: ResourceViewService,
  ) {}

  // ---------------- GET /student/today ----------------
  async today(user: JwtUser): Promise<StudentTodayData> {
    const sid = BigInt(user.uid);
    const [todayLesson, tasks] = await Promise.all([
      this.findTodayLesson(sid),
      this.buildTasks(user, sid),
    ]);
    return { todayLesson, tasks };
  }

  private async findTodayLesson(sid: bigint): Promise<TodayLessonView | null> {
    const dayStart = utcDayStart();
    const dayEnd = new Date(dayStart.getTime() + DAY_MS);
    const lessons = await this.prisma.client.lesson.findMany({
      where: {
        scheduledStart: { gte: dayStart, lt: dayEnd },
        scheduledEnd: { not: null },
        course: { deletedAt: null, students: { some: { studentId: sid, status: 'active' } } },
      },
      orderBy: { scheduledStart: 'asc' },
      include: { course: { select: { name: true } } },
    });
    if (!lessons.length) return null;

    // FIX4 · #5:当天讲次按开课时间升序后,优先"已发布"(status≠draft 或已建未结束会话)的一条,
    // 避免上午的草稿讲次挡住下午已发布的讲次;全为草稿时回退到最早一条(保持原行为)。
    const sessionByLesson = await latestOpenSessions(this.prisma.client, lessons.map((l) => l.id));
    const isPublished = (l: (typeof lessons)[number]) =>
      l.status !== 'draft' || sessionByLesson.has(String(l.id));
    const lesson = lessons.find(isPublished) ?? lessons[0];

    const session = sessionByLesson.get(String(lesson.id)) ?? null;
    return {
      lessonId: num(lesson.id),
      courseName: lesson.course.name,
      title: lesson.title,
      startAt: iso(lesson.scheduledStart!),
      endAt: iso(lesson.scheduledEnd!),
      canEnterAt: iso(new Date(lesson.scheduledStart!.getTime() - ENTER_AHEAD_MIN * 60_000)),
      sessionId: session,
    };
  }

  private async buildTasks(user: JwtUser, sid: bigint): Promise<TodayTaskView[]> {
    // 可见性唯一口径:A4 AssignmentService.listForStudent(禁止重写 target 解析)
    const visible = await this.assignments.listForStudent(user, 'all');
    if (!visible.length) return [];
    const attempts = await this.prisma.client.attempt.findMany({
      where: { studentId: sid, assignmentId: { in: visible.map((a) => BigInt(a.id)) } },
      orderBy: { attemptNo: 'asc' }, // 后写覆盖 → Map 中留下 attemptNo 最大的一条
      include: { _count: { select: { answers: true } } },
    });
    const latest = new Map(attempts.map((at) => [String(at.assignmentId), at]));
    return visible
      .filter((a) => {
        // FIXB · B3(与 listForStudent pending 同口径):随堂练(in_class)不进今日任务待办 ——
        // 未参与/未交的懒建整班随堂练不再挂在任务列表;已交/已出分的保留(作为已完成项展示)。
        if (a.kind !== 'in_class') return true;
        const at = latest.get(String(a.id));
        return at != null && (at.status === 'submitted' || at.status === 'graded');
      })
      .map((a) => {
        const at = latest.get(String(a.id));
        return {
          assignmentId: a.id,
          kind: a.kind,
          title: a.paperName,
          questionCount: a.questionCount,
          dueAt: a.dueAt,
          progress: at
            ? { answered: at._count.answers, total: a.questionCount, status: at.status }
            : { answered: 0, total: a.questionCount, status: 'not_started' },
        };
      });
  }

  // ---------------- GET /student/courses ----------------
  /** 我的课程(active 选课);聚合口径=A4 CourseService.myCourses(README A2/A4),逐字段一致 */
  async myCourses(user: JwtUser): Promise<CourseDto[]> {
    const sid = BigInt(user.uid);
    const rows = await this.prisma.client.course.findMany({
      where: { deletedAt: null, students: { some: { studentId: sid, status: 'active' } } },
      orderBy: { id: 'asc' },
    });
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const now = new Date();
    const todayStart = utcDayStart(); // S5:同 CourseService 口径,整天已过的讲次计为"已结束"

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
        select: { courseId: true, status: true, scheduledStart: true, scheduledEnd: true },
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
        // S5(m6):与 CourseService.myCourses 同口径 —— currentLesson=已结束讲次数
        // (已 finished 或 scheduledEnd 早于今日 0 点),修复"排了课但没开直播就永不推进"的第0讲卡住。
        currentLesson: myLessons.filter(
          (l) => l.status === 'finished' || (l.scheduledEnd != null && l.scheduledEnd < todayStart),
        ).length,
        studentCount,
        status: c.status,
        nextLessonAt: upcoming.length ? iso(upcoming[0]) : null,
        attendanceRate: dec(attendanceRate),
        homeworkRate: dec(homeworkRate),
      };
    });
  }

  // ---------------- GET /student/courses/:id/lessons ----------------
  async lessonTimeline(user: JwtUser, courseId: number): Promise<LessonTimelineItem[]> {
    const sid = BigInt(user.uid);
    // 未选课(含 quit)/已删/跨租户 → 一律 404(宪法 §7)
    const course = await this.prisma.client.course.findFirst({
      where: {
        id: BigInt(courseId),
        deletedAt: null,
        students: { some: { studentId: sid, status: 'active' } },
      },
      select: { id: true },
    });
    if (!course) throw new NotFoundException('课程不存在');

    const lessons = await this.prisma.client.lesson.findMany({
      where: { courseId: course.id },
      orderBy: { seq: 'asc' },
    });
    if (!lessons.length) return [];

    // FIX4 · #1:每讲未结束 class_session(口径同 /student/today),无则 null
    const sessionByLesson = await latestOpenSessions(this.prisma.client, lessons.map((l) => l.id));

    // 该课程各讲次的 homework 作业,可见性仍走 A4 唯一口径;每讲取最新一条(id 最大)
    const visible = await this.assignments.listForStudent(user, 'all');
    const lessonIds = new Set(lessons.map((l) => num(l.id)));
    const hwByLesson = new Map<number, (typeof visible)[number]>();
    for (const a of visible) {
      if (a.kind !== 'homework' || a.lessonId == null || !lessonIds.has(a.lessonId)) continue;
      const cur = hwByLesson.get(a.lessonId);
      if (!cur || a.id > cur.id) hwByLesson.set(a.lessonId, a);
    }

    const hwList = [...hwByLesson.values()];
    const attempts = hwList.length
      ? await this.prisma.client.attempt.findMany({
          where: { studentId: sid, assignmentId: { in: hwList.map((a) => BigInt(a.id)) } },
          orderBy: { attemptNo: 'asc' }, // 后写覆盖 → 留最新 attempt
          select: { id: true, assignmentId: true, score: true },
        })
      : [];
    const latestAttempt = new Map(attempts.map((at) => [String(at.assignmentId), at]));

    // 错题数口径(A5/B5):客观题 isCorrect=false;主观题已出分且 score < 卷面满分
    const attemptIds = [...latestAttempt.values()].map((at) => at.id);
    const [answers, paperQuestions] = await Promise.all([
      attemptIds.length
        ? this.prisma.client.answer.findMany({
            where: { attemptId: { in: attemptIds } },
            select: { attemptId: true, questionId: true, isCorrect: true, score: true },
          })
        : Promise.resolve([]),
      hwList.length
        ? this.prisma.client.paperQuestion.findMany({
            where: { paperId: { in: hwList.map((a) => BigInt(a.paperId)) } },
            select: { paperId: true, questionId: true, score: true },
          })
        : Promise.resolve([]),
    ]);
    const fullScore = new Map(
      paperQuestions.map((pq) => [`${pq.paperId}:${pq.questionId}`, Number(pq.score)]),
    );
    const wrongByAttempt = new Map<string, number>();
    const paperOfAttempt = new Map(
      [...latestAttempt.entries()].map(([aid, at]) => [
        String(at.id),
        hwList.find((a) => String(a.id) === aid)!.paperId,
      ]),
    );
    for (const ans of answers) {
      const paperId = paperOfAttempt.get(String(ans.attemptId));
      const full = fullScore.get(`${paperId}:${ans.questionId}`) ?? 0;
      const wrong =
        ans.isCorrect === false ||
        (ans.isCorrect == null && ans.score != null && Number(ans.score) < full);
      if (wrong)
        wrongByAttempt.set(String(ans.attemptId), (wrongByAttempt.get(String(ans.attemptId)) ?? 0) + 1);
    }

    return lessons.map((l) => {
      const hw = hwByLesson.get(num(l.id));
      const at = hw ? latestAttempt.get(String(hw.id)) : undefined;
      return {
        lesson: {
          id: num(l.id),
          courseId: num(l.courseId),
          seq: l.seq,
          title: l.title,
          scheduledStart: iso(l.scheduledStart),
          scheduledEnd: iso(l.scheduledEnd),
          status: l.status,
          prepChecklist: (l.prepChecklist ?? {}) as Record<string, boolean>,
          openingConfig: (l.openingConfig ?? null) as Record<string, unknown> | null,
          sessionId: sessionByLesson.get(String(l.id)) ?? null,
        },
        sessionId: sessionByLesson.get(String(l.id)) ?? null,
        myHomework: hw
          ? {
              assignmentId: hw.id,
              attemptId: at ? num(at.id) : null,
              score: at ? dec(at.score) : null,
              wrongCount: at ? (wrongByAttempt.get(String(at.id)) ?? 0) : 0,
            }
          : null,
      };
    });
  }

  // ---------------- GET /student/report ----------------
  async report(user: JwtUser): Promise<StudentReportData> {
    const sid = BigInt(user.uid);
    // mastery / wrongOpenCount 复用 A8 聚合出口(口径=README A5 掌握度 + A2 学生档案)
    const base = await this.analytics.studentReport(user.uid);
    const since = daysAgoUtc(WEEK_DAYS);
    const [duration, answers] = await Promise.all([
      this.prisma.client.attempt.aggregate({
        where: { studentId: sid, startedAt: { gte: since } },
        _sum: { durationSec: true },
      }),
      this.prisma.client.answer.findMany({
        where: { attempt: { studentId: sid }, createdAt: { gte: since } },
        select: { isCorrect: true },
      }),
    ]);
    const judged = answers.filter((a) => a.isCorrect != null);
    return {
      mastery: base.mastery,
      weekStats: {
        answeredCount: answers.length,
        correctRate: judged.length
          ? round2(judged.filter((a) => a.isCorrect).length / judged.length)
          : null,
        studySec: duration._sum.durationSec ?? 0,
        wrongOpenCount: base.wrongOpenCount,
      },
    };
  }

  // ---------------- GET /student/resources/:id/view ----------------
  async resourceViewUrl(user: JwtUser, id: number): Promise<{ url: string; expiresAt: string }> {
    const sid = BigInt(user.uid);
    const resource = await this.prisma.client.resource.findFirst({
      where: {
        id: BigInt(id),
        deletedAt: null,
        // 仅可回看"我 active 选课课程"的讲次环节引用的课件;其余(含跨租户)一律 404
        segments: {
          some: {
            lesson: {
              course: { deletedAt: null, students: { some: { studentId: sid, status: 'active' } } },
            },
          },
        },
      },
      select: { ossKey: true },
    });
    if (!resource) throw new NotFoundException('课件不存在');
    const signed = await this.resourceView.presignGet(resource.ossKey, VIEW_TTL_SEC);
    return { url: signed.url, expiresAt: signed.expiresAt.toISOString() };
  }
}
