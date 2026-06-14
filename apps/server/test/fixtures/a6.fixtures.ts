/**
 * A6 测试夹具(自建自清,不触碰 seed 数据,手机号 1395 开头):
 * - 机构A:教师 + 20 名选课学生(roster 节流验收用)+ 1 名未选课学生(成员校验)
 *   + 讲次(5 环节:warmup/lecture/practice/summary/homework)
 *   + 随堂练习卷(q1 single 5分 + q2 blank 5分)挂 practice 环节,并已发布 in_class assignment
 *   + 课后作业卷(hwQ single 5分)挂 homework 环节(ended 结算时由 A4 接口自动发布)
 *   + ClassSession(scheduled,mode 按 schema 注释存 snake_case,验证服务端归一化为契约 camelCase)
 * - 机构B:教师(跨租户 join 拒绝,宪法 §7)
 */
import { hashPassword } from '../../src/auth/password.util';
import { raw } from './setup';

export const A6_PASSWORD = 'A6@Pass123';
export const A6_STUDENT_COUNT = 20;
/** mode.stuck_alert_min:心跳 idleSec 超过 2 分钟 → stuck */
export const A6_STUCK_ALERT_MIN = 2;

export interface A6Fixture {
  orgId: bigint;
  teacherId: bigint;
  teacherPhone: string;
  /** 20 名已选课学生(s1=studentIds[0]、s2=studentIds[1]) */
  studentIds: bigint[];
  outsiderId: bigint; // 同机构但未选课
  courseId: bigint;
  lessonId: bigint;
  practicePaperId: bigint;
  homeworkPaperId: bigint;
  inClassAssignmentId: bigint;
  /** [q1 single, q2 blank](随堂练习卷) */
  questionIds: bigint[];
  sessionId: number;
  orgBId: bigint;
  teacherBPhone: string;
}

export async function createA6Org(): Promise<A6Fixture> {
  const hash = await hashPassword(A6_PASSWORD);
  const org = await raw.org.create({
    data: {
      name: 'A6课堂实时测试机构',
      settings: {
        ai: { qaGuideOnly: true, preGrading: true },
        studentHours: { start: '06:00', end: '22:30' },
        deviceBinding: true,
      },
    },
  });
  const orgId = org.id;
  const teacher = await raw.user.create({
    data: { orgId, role: 'teacher', name: 'A6教师', phone: '13950000001', passwordHash: hash },
  });

  const students = [] as { id: bigint }[];
  for (let i = 0; i < A6_STUDENT_COUNT; i++) {
    students.push(
      await raw.user.create({
        data: {
          orgId,
          role: 'student',
          name: `A6学生${String(i + 1).padStart(2, '0')}`,
          phone: `13950000${String(101 + i)}`,
          studentNo: `A6-S${String(i + 1).padStart(3, '0')}`,
        },
      }),
    );
  }
  const outsider = await raw.user.create({
    data: { orgId, role: 'student', name: 'A6未选课学生', phone: '13950000131', studentNo: 'A6-OUT1' },
  });

  const course = await raw.course.create({
    data: {
      orgId,
      name: 'A6 · 初二数学课堂实时班',
      classType: 'group',
      subject: '数学',
      stage: '初中',
      teacherId: teacher.id,
      totalLessons: 1,
      status: 'ongoing',
    },
  });
  await raw.courseStudent.createMany({
    data: students.map((s) => ({ orgId, courseId: course.id, studentId: s.id })),
  });

  // ---- 随堂练习卷(客观题,A5 即时判分通道)----
  const q1 = await raw.question.create({
    data: {
      orgId, ownerId: teacher.id, type: 'single', stage: '初中', subject: '数学',
      stemLatex: 'A6-Q1 将 $y=2x+1$ 向上平移 3 个单位后的解析式为(  )',
      answer: { choice: 'A' },
      analysisLatex: '上加下减:$y=2x+4$。',
      difficulty: 2, status: 'published',
    },
  });
  await raw.questionOption.createMany({
    data: ['A', 'B', 'C', 'D'].map((label, i) => ({
      orgId, questionId: q1.id, label, contentLatex: `$选项${label}$`, isCorrect: i === 0,
    })),
  });
  const q2 = await raw.question.create({
    data: {
      orgId, ownerId: teacher.id, type: 'blank', stage: '初中', subject: '数学',
      stemLatex: 'A6-Q2 经过 $(0,1)$ 且 $k=2$ 的一次函数解析式为 ________。',
      answer: { texts: ['y=2x+1'] },
      analysisLatex: '代入 $k=2$、$b=1$。',
      difficulty: 1, status: 'published',
    },
  });
  const practicePaper = await raw.paper.create({
    data: { orgId, creatorId: teacher.id, name: 'A6 · 随堂练习', type: 'practice', totalScore: 10, status: 'published' },
  });
  await raw.paperQuestion.createMany({
    data: [q1, q2].map((q, i) => ({ orgId, paperId: practicePaper.id, questionId: q.id, seq: i + 1, score: 5 })),
  });

  // ---- 课后作业卷(ended 结算自动发布的标的)----
  const hwQ = await raw.question.create({
    data: {
      orgId, ownerId: teacher.id, type: 'single', stage: '初中', subject: '数学',
      stemLatex: 'A6-HW1 一次函数 $y=-x+2$ 的图象不经过第(  )象限',
      answer: { choice: 'C' },
      analysisLatex: '$k<0,b>0$,不过第三象限。',
      difficulty: 2, status: 'published',
    },
  });
  await raw.questionOption.createMany({
    data: ['A', 'B', 'C', 'D'].map((label, i) => ({
      orgId, questionId: hwQ.id, label, contentLatex: `$选项${label}$`, isCorrect: i === 2,
    })),
  });
  const homeworkPaper = await raw.paper.create({
    data: { orgId, creatorId: teacher.id, name: 'A6 · 第1讲课后作业', type: 'homework', totalScore: 5, status: 'published' },
  });
  await raw.paperQuestion.create({
    data: { orgId, paperId: homeworkPaper.id, questionId: hwQ.id, seq: 1, score: 5 },
  });

  // ---- 讲次 + 5 环节 ----
  const now = Date.now();
  const lesson = await raw.lesson.create({
    data: {
      orgId,
      courseId: course.id,
      seq: 1,
      title: 'A6 · 一次函数图象与平移',
      scheduledStart: new Date(now - 5 * 60_000),
      scheduledEnd: new Date(now + 40 * 60_000),
      status: 'ready',
      prepChecklist: { warmup: true, lecture: true, practice: true, summary: true, homework: true },
    },
  });
  await raw.lessonSegment.createMany({
    data: [
      { orgId, lessonId: lesson.id, seq: 1, type: 'warmup', durationMin: 5, config: { source: 'wrong_book', count: 2 } },
      { orgId, lessonId: lesson.id, seq: 2, type: 'lecture', durationMin: 15, config: { checkpoints: [], pages: [
        { title: 'A6 课件页1', body: '一次函数 $y=kx+b$ 的图象是一条直线。', narration: '先认识一次函数的图象。' },
        { title: 'A6 课件页2', body: '平移规律:**上加下减**(改 $b$)。', narration: '记住口诀:上加下减。',
          quiz: { stem: '把 $y=2x+1$ 向上平移 3 个单位,得?', options: [{ label: 'A', contentLatex: '$y=2x+4$' }, { label: 'B', contentLatex: '$y=2x-2$' }], correct: 'A', hint: '上移 → b 加。' } },
      ] } },
      { orgId, lessonId: lesson.id, seq: 3, type: 'practice', durationMin: 15, config: { ai_guide: true, stuck_alert_min: A6_STUCK_ALERT_MIN }, paperId: practicePaper.id },
      { orgId, lessonId: lesson.id, seq: 4, type: 'summary', durationMin: 5, config: {} },
      { orgId, lessonId: lesson.id, seq: 5, type: 'homework', durationMin: 5, config: {}, paperId: homeworkPaper.id },
    ],
  });

  // ---- 随堂 in_class 作业(class:answer 复用 A5 判分的载体,课前已发布)----
  const inClass = await raw.assignment.create({
    data: {
      orgId,
      paperId: practicePaper.id,
      lessonId: lesson.id,
      kind: 'in_class',
      target: { courseId: Number(course.id) },
      gradingPolicy: { objective: 'instant' },
      scoreCounted: true,
    },
  });

  // ---- ClassSession(mode 按 schema 注释 snake_case 存储)----
  const session = await raw.classSession.create({
    data: {
      orgId,
      lessonId: lesson.id,
      status: 'scheduled',
      mode: { guide_only: true, stuck_alert_min: A6_STUCK_ALERT_MIN, lockdown: false, sync_segments: false },
    },
  });

  // ---- 机构B(跨租户)----
  const orgB = await raw.org.create({
    data: {
      name: 'A6跨租户机构B',
      settings: {
        ai: { qaGuideOnly: true, preGrading: true },
        studentHours: { start: '06:00', end: '22:30' },
        deviceBinding: true,
      },
    },
  });
  const teacherB = await raw.user.create({
    data: { orgId: orgB.id, role: 'teacher', name: 'A6教师B', phone: '13950000141', passwordHash: hash },
  });

  return {
    orgId,
    teacherId: teacher.id,
    teacherPhone: teacher.phone!,
    studentIds: students.map((s) => s.id),
    outsiderId: outsider.id,
    courseId: course.id,
    lessonId: lesson.id,
    practicePaperId: practicePaper.id,
    homeworkPaperId: homeworkPaper.id,
    inClassAssignmentId: inClass.id,
    questionIds: [q1.id, q2.id],
    sessionId: Number(session.id),
    orgBId: orgB.id,
    teacherBPhone: teacherB.phone!,
  };
}

export async function dropA6Org(orgId: bigint, orgBId: bigint): Promise<void> {
  for (const oid of [orgId, orgBId]) {
    await raw.sessionEvent.deleteMany({ where: { orgId: oid } });
    await raw.sessionParticipant.deleteMany({ where: { orgId: oid } });
    await raw.classSession.deleteMany({ where: { orgId: oid } });
    await raw.masterySnapshot.deleteMany({ where: { orgId: oid } });
    await raw.wrongBookEntry.deleteMany({ where: { orgId: oid } });
    await raw.gradingRecord.deleteMany({ where: { orgId: oid } });
    await raw.answer.deleteMany({ where: { orgId: oid } });
    await raw.attempt.deleteMany({ where: { orgId: oid } });
    await raw.assignment.deleteMany({ where: { orgId: oid } });
    await raw.lessonSegment.deleteMany({ where: { orgId: oid } });
    await raw.lesson.deleteMany({ where: { orgId: oid } });
    await raw.paperQuestion.deleteMany({ where: { orgId: oid } });
    await raw.paper.deleteMany({ where: { orgId: oid } });
    await raw.questionOption.deleteMany({ where: { orgId: oid } });
    await raw.questionTag.deleteMany({ where: { orgId: oid } });
    await raw.question.deleteMany({ where: { orgId: oid } });
    await raw.courseStudent.deleteMany({ where: { orgId: oid } });
    await raw.course.deleteMany({ where: { orgId: oid } });
    await raw.device.deleteMany({ where: { orgId: oid } });
    await raw.loginTicket.deleteMany({ where: { orgId: oid } });
    await raw.auditLog.deleteMany({ where: { orgId: oid } });
    await raw.user.deleteMany({ where: { orgId: oid } });
    await raw.org.deleteMany({ where: { id: oid } });
  }
}
