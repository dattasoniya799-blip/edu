/**
 * FIX1 测试夹具(自建自清,不触碰 seed 数据,手机号 1398 开头):
 * - 机构A:admin / 教师 / 学生×3(s1、s2 active;s3 quit)
 *   课程 C1(s1/s2;3 讲:L1 七天前已结课、L2 今日 UTC 0 点、L3 三天后 draft)
 *   课程 C2(仅 s2;L4 今日 UTC+1h —— 验证 s1 不可见、s2 取最早的 L2)
 *   L2 挂 scheduled 状态 class_session(today.sessionId)+ lecture 环节引用课件 R1;
 *   L4 的 lecture 环节引用课件 R2(s1 未选 C2 → view R2 = 404)
 *   作业:A_hw(homework,挂 L1,整班)/ A_old(wrong_redo,定向 s1,10 天前)/
 *        A_pend(consolidation,整班,无人作答)
 *   s1 在 A_hw 的 graded attempt(2 天前,durationSec=1234):
 *     q1 对(5)/ q3 错(0)/ q2 主观 5<10 → 该作业 wrongCount=2,score=10
 *   s1 在 A_old 的 submitted attempt(10 天前,durationSec=999,q4 对)→ 周窗口外
 *   s2 在 A_hw 的 submitted attempt(零作答)→ homeworkRate=2/(1×2)=1
 *   快照:s1{N1(curriculum):75/4, M1(ability):50/2};错题:s1 q3/q2 open + q4 cleared
 *
 * 手算账本(测试断言依据,均为 s1):
 *   today.tasks(id 倒序)= [A_pend{0/1,not_started}, A_old{1/1,submitted}, A_hw{3/3,graded}]
 *   courses = [C1]:currentLesson=1,studentCount=2,nextLessonAt=L3,attendance=null,homework=1
 *   lessons(C1)= 3 条 seq 升序;L1.myHomework={A_hw,score:10,wrongCount:2},L2/L3 为 null
 *   report.weekStats = {answeredCount:3, correctRate:0.5, studySec:1234, wrongOpenCount:2}
 * - 机构B:教师 + 学生 + 课程/明日讲次/课件 R_B(跨租户 404 用例,宪法 §7)
 */
import { hashPassword } from '../../src/auth/password.util';
import { raw } from './setup';

export const FIX1_PASSWORD = 'Fix1@Pass123';

const DAY = 86400_000;
const utcDayStart = (d = new Date()) =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

export interface Fix1Fixture {
  orgId: bigint;
  adminPhone: string;
  teacherPhone: string;
  s1Id: bigint;
  s2Id: bigint;
  s3Id: bigint;
  course1Id: bigint;
  course2Id: bigint;
  l1Id: bigint;
  l2Id: bigint;
  l3Id: bigint;
  l4Id: bigint;
  sessionId: bigint;
  hwAssignmentId: bigint;
  oldAssignmentId: bigint;
  pendAssignmentId: bigint;
  node1Id: bigint;
  nodeM1Id: bigint;
  r1Id: bigint;
  r2Id: bigint;
  r1OssKey: string;
  /** 时间账本(断言用) */
  l2Start: Date;
  l2End: Date;
  l3Start: Date;
  /** 机构B(跨租户) */
  orgBId: bigint;
  studentBId: bigint;
  courseBId: bigint;
  resourceBId: bigint;
}

const ORG_SETTINGS = {
  ai: { qaGuideOnly: true, preGrading: true },
  studentHours: { start: '06:00', end: '22:30' },
  deviceBinding: true,
};

export async function createFix1Org(): Promise<Fix1Fixture> {
  const hash = await hashPassword(FIX1_PASSWORD);
  const now = Date.now();
  const dayStart = utcDayStart();

  const org = await raw.org.create({ data: { name: 'FIX1学生杂项测试机构', settings: ORG_SETTINGS } });
  const orgId = org.id;
  // 顺序创建保证 id 升序确定(见 a8 夹具的 Promise.all 教训)
  const admin = await raw.user.create({ data: { orgId, role: 'admin', name: 'FIX1管理员', phone: '13980000001', passwordHash: hash } });
  const teacher = await raw.user.create({ data: { orgId, role: 'teacher', name: 'FIX1教师', phone: '13980000002', passwordHash: hash } });
  const s1 = await raw.user.create({ data: { orgId, role: 'student', name: 'FIX1学生一', phone: '13980000011', studentNo: 'FIX1-S001' } });
  const s2 = await raw.user.create({ data: { orgId, role: 'student', name: 'FIX1学生二', phone: '13980000012', studentNo: 'FIX1-S002' } });
  const s3 = await raw.user.create({ data: { orgId, role: 'student', name: 'FIX1学生三', phone: '13980000013', studentNo: 'FIX1-S003' } });

  // ---- 课程 / 选课 ----
  const c1 = await raw.course.create({
    data: { orgId, name: 'FIX1 · 初二数学冲刺班', classType: 'group', subject: '数学', stage: '初中', teacherId: teacher.id, totalLessons: 3, status: 'ongoing' },
  });
  const c2 = await raw.course.create({
    data: { orgId, name: 'FIX1 · 一对一辅导', classType: 'one_on_one', subject: '数学', stage: '初中', teacherId: teacher.id, totalLessons: 2, status: 'ongoing' },
  });
  await raw.courseStudent.createMany({
    data: [
      { orgId, courseId: c1.id, studentId: s1.id, status: 'active' },
      { orgId, courseId: c1.id, studentId: s2.id, status: 'active' },
      { orgId, courseId: c1.id, studentId: s3.id, status: 'quit' },
      { orgId, courseId: c2.id, studentId: s2.id, status: 'active' },
    ],
  });

  // ---- 讲次:L1 七天前 finished / L2 今日(UTC 0 点,必已开始)/ L3 三天后 draft / L4(C2)今日+1h ----
  const l2Start = dayStart;
  const l2End = new Date(dayStart.getTime() + 2 * 3600_000);
  const l3Start = new Date(now + 3 * DAY);
  const l1 = await raw.lesson.create({
    data: { orgId, courseId: c1.id, seq: 1, title: 'FIX1 第1讲 · 待定系数法', status: 'finished', scheduledStart: new Date(now - 7 * DAY), scheduledEnd: new Date(now - 7 * DAY + 2 * 3600_000) },
  });
  const l2 = await raw.lesson.create({
    data: { orgId, courseId: c1.id, seq: 2, title: 'FIX1 第2讲 · 图象平移', status: 'ready', scheduledStart: l2Start, scheduledEnd: l2End },
  });
  const l3 = await raw.lesson.create({
    data: { orgId, courseId: c1.id, seq: 3, title: 'FIX1 第3讲 · 单元复习', status: 'draft', scheduledStart: l3Start, scheduledEnd: new Date(l3Start.getTime() + 2 * 3600_000) },
  });
  const l4 = await raw.lesson.create({
    data: { orgId, courseId: c2.id, seq: 1, title: 'FIX1 一对一 · 今日讲', status: 'ready', scheduledStart: new Date(dayStart.getTime() + 3600_000), scheduledEnd: new Date(dayStart.getTime() + 2 * 3600_000) },
  });
  const session = await raw.classSession.create({ data: { orgId, lessonId: l2.id, status: 'scheduled' } });

  // ---- 课件:R1 挂 L2 lecture;R2 挂 L4 lecture(s1 未选 C2)----
  const r1OssKey = 'fix1-view/courseware/anim.html';
  const r1 = await raw.resource.create({
    data: { orgId, ownerId: teacher.id, type: 'interactive', name: 'FIX1 · 平移动画课件', ossKey: r1OssKey, size: 64 },
  });
  const r2 = await raw.resource.create({
    data: { orgId, ownerId: teacher.id, type: 'pdf', name: 'FIX1 · 一对一讲义', ossKey: 'fix1-view/courseware/c2-only.pdf', size: 8 },
  });
  await raw.lessonSegment.createMany({
    data: [
      { orgId, lessonId: l2.id, seq: 1, type: 'lecture', durationMin: 30, config: {}, resourceId: r1.id },
      { orgId, lessonId: l4.id, seq: 1, type: 'lecture', durationMin: 30, config: {}, resourceId: r2.id },
    ],
  });

  // ---- 题目 / 试卷 ----
  const mkQ = (label: string, type: 'single' | 'solution', answer: object) =>
    raw.question.create({
      data: { orgId, ownerId: teacher.id, type, stage: '初中', subject: '数学', stemLatex: `FIX1-${label} 一次函数题`, answer, difficulty: 2, status: 'published' },
    });
  const q1 = await mkQ('Q1', 'single', { choice: 'B' });
  const q2 = await mkQ('Q2', 'solution', { referenceLatex: 'y=2x+1' });
  const q3 = await mkQ('Q3', 'single', { choice: 'B' });
  const q4 = await mkQ('Q4', 'single', { choice: 'B' });
  const q5 = await mkQ('Q5', 'single', { choice: 'B' });

  const hwPaper = await raw.paper.create({
    data: { orgId, creatorId: teacher.id, name: 'FIX1 · 第1讲课后作业', type: 'homework', totalScore: 20, status: 'published' },
  });
  await raw.paperQuestion.createMany({
    data: [
      { orgId, paperId: hwPaper.id, questionId: q1.id, seq: 1, score: 5 },
      { orgId, paperId: hwPaper.id, questionId: q3.id, seq: 2, score: 5 },
      { orgId, paperId: hwPaper.id, questionId: q2.id, seq: 3, score: 10 },
    ],
  });
  const oldPaper = await raw.paper.create({
    data: { orgId, creatorId: teacher.id, name: 'FIX1 · 错题重练卷', type: 'practice', totalScore: 5, status: 'published' },
  });
  await raw.paperQuestion.create({ data: { orgId, paperId: oldPaper.id, questionId: q4.id, seq: 1, score: 5 } });
  const pendPaper = await raw.paper.create({
    data: { orgId, creatorId: teacher.id, name: 'FIX1 · 巩固练习卷', type: 'practice', totalScore: 5, status: 'published' },
  });
  await raw.paperQuestion.create({ data: { orgId, paperId: pendPaper.id, questionId: q5.id, seq: 1, score: 5 } });

  // ---- 作业(创建顺序即 id 升序:A_hw < A_old < A_pend)----
  const aHw = await raw.assignment.create({
    data: { orgId, paperId: hwPaper.id, lessonId: l1.id, teacherId: teacher.id, kind: 'homework', target: { courseId: Number(c1.id) }, publishAt: new Date(now - 6 * DAY), dueAt: new Date(now - 5 * DAY), scoreCounted: true },
  });
  const aOld = await raw.assignment.create({
    // wrong_redo=学生自发:teacherId 留 null(teacher 锚点规则:任何教师不可见)
    data: { orgId, paperId: oldPaper.id, kind: 'wrong_redo', target: { studentIds: [Number(s1.id)] }, publishAt: new Date(now - 10 * DAY), dueAt: null, scoreCounted: false },
  });
  const aPend = await raw.assignment.create({
    data: { orgId, paperId: pendPaper.id, teacherId: teacher.id, kind: 'consolidation', target: { courseId: Number(c1.id) }, publishAt: new Date(now - 1 * DAY), dueAt: new Date(now + 3 * DAY), scoreCounted: true },
  });

  // ---- s1 作答账本 ----
  const atHw = await raw.attempt.create({
    data: {
      orgId, assignmentId: aHw.id, studentId: s1.id, attemptNo: 1, status: 'graded',
      startedAt: new Date(now - 2 * DAY), submittedAt: new Date(now - 2 * DAY + 1800_000),
      durationSec: 1234, score: 10, objectiveScore: 5, subjectiveScore: 5,
    },
  });
  await raw.answer.createMany({
    data: [
      { orgId, attemptId: atHw.id, questionId: q1.id, response: { choice: 'B' }, isCorrect: true, score: 5, createdAt: new Date(now - 2 * DAY) },
      { orgId, attemptId: atHw.id, questionId: q3.id, response: { choice: 'A' }, isCorrect: false, score: 0, createdAt: new Date(now - 2 * DAY) },
      { orgId, attemptId: atHw.id, questionId: q2.id, response: { photoOssKey: 'fix1/answers/s1-q2.jpg' }, isCorrect: null, score: 5, createdAt: new Date(now - 2 * DAY) },
    ],
  });
  const atOld = await raw.attempt.create({
    data: {
      orgId, assignmentId: aOld.id, studentId: s1.id, attemptNo: 1, status: 'submitted',
      startedAt: new Date(now - 10 * DAY), submittedAt: new Date(now - 10 * DAY + 600_000), durationSec: 999,
    },
  });
  await raw.answer.create({
    data: { orgId, attemptId: atOld.id, questionId: q4.id, response: { choice: 'B' }, isCorrect: true, score: 5, createdAt: new Date(now - 10 * DAY) },
  });
  await raw.attempt.create({
    data: { orgId, assignmentId: aHw.id, studentId: s2.id, attemptNo: 1, status: 'submitted', startedAt: new Date(now - 2 * DAY), submittedAt: new Date(now - 2 * DAY + 900_000) },
  });

  // ---- 图谱 / 快照 / 错题 ----
  const g1 = await raw.kpGraph.create({ data: { orgId, code: 'fix1_curriculum', graphType: 'curriculum_knowledge', subject: '数学' } });
  const g2 = await raw.kpGraph.create({ data: { orgId, code: 'fix1_ability', graphType: 'problem_solving_ability', subject: '数学' } });
  const node1 = await raw.kpNode.create({ data: { orgId, graphId: g1.id, code: 'FIX1-N1', name: 'FIX1·一次函数概念' } });
  const nodeM1 = await raw.kpNode.create({ data: { orgId, graphId: g2.id, code: 'FIX1-M1', name: 'FIX1·运算能力' } });
  await raw.masterySnapshot.createMany({
    data: [
      { orgId, studentId: s1.id, nodeId: node1.id, mastery: 75, sampleCount: 4 },
      { orgId, studentId: s1.id, nodeId: nodeM1.id, mastery: 50, sampleCount: 2 },
    ],
  });
  const ansQ3 = await raw.answer.findFirstOrThrow({ where: { attemptId: atHw.id, questionId: q3.id } });
  const ansQ2 = await raw.answer.findFirstOrThrow({ where: { attemptId: atHw.id, questionId: q2.id } });
  const ansQ4 = await raw.answer.findFirstOrThrow({ where: { attemptId: atOld.id, questionId: q4.id } });
  await raw.wrongBookEntry.createMany({
    data: [
      { orgId, studentId: s1.id, questionId: q3.id, sourceAnswerId: ansQ3.id, status: 'open' },
      { orgId, studentId: s1.id, questionId: q2.id, sourceAnswerId: ansQ2.id, status: 'open' },
      { orgId, studentId: s1.id, questionId: q4.id, sourceAnswerId: ansQ4.id, status: 'cleared', correctRedoCount: 2 },
    ],
  });

  // ---- 机构B(跨租户)----
  const orgB = await raw.org.create({ data: { name: 'FIX1跨租户机构B', settings: ORG_SETTINGS } });
  const teacherB = await raw.user.create({ data: { orgId: orgB.id, role: 'teacher', name: 'FIX1教师B', phone: '13980000021', passwordHash: hash } });
  const studentB = await raw.user.create({ data: { orgId: orgB.id, role: 'student', name: 'FIX1学生B', phone: '13980000023', studentNo: 'FIX1-B001' } });
  const courseB = await raw.course.create({
    data: { orgId: orgB.id, name: 'FIX1B · 课程', classType: 'group', subject: '数学', stage: '初中', teacherId: teacherB.id, totalLessons: 1, status: 'ongoing' },
  });
  await raw.courseStudent.create({ data: { orgId: orgB.id, courseId: courseB.id, studentId: studentB.id, status: 'active' } });
  const lessonB = await raw.lesson.create({
    data: { orgId: orgB.id, courseId: courseB.id, seq: 1, title: 'FIX1B 第1讲', status: 'ready', scheduledStart: new Date(now + DAY), scheduledEnd: new Date(now + DAY + 2 * 3600_000) },
  });
  const resourceB = await raw.resource.create({
    data: { orgId: orgB.id, ownerId: teacherB.id, type: 'pdf', name: 'FIX1B 讲义', ossKey: 'fix1-view/b/handout.pdf', size: 8 },
  });
  await raw.lessonSegment.create({
    data: { orgId: orgB.id, lessonId: lessonB.id, seq: 1, type: 'lecture', durationMin: 30, config: {}, resourceId: resourceB.id },
  });

  return {
    orgId,
    adminPhone: admin.phone!,
    teacherPhone: teacher.phone!,
    s1Id: s1.id, s2Id: s2.id, s3Id: s3.id,
    course1Id: c1.id, course2Id: c2.id,
    l1Id: l1.id, l2Id: l2.id, l3Id: l3.id, l4Id: l4.id,
    sessionId: session.id,
    hwAssignmentId: aHw.id, oldAssignmentId: aOld.id, pendAssignmentId: aPend.id,
    node1Id: node1.id, nodeM1Id: nodeM1.id,
    r1Id: r1.id, r2Id: r2.id, r1OssKey,
    l2Start, l2End, l3Start,
    orgBId: orgB.id, studentBId: studentB.id, courseBId: courseB.id, resourceBId: resourceB.id,
  };
}

export async function dropFix1Org(orgId: bigint, orgBId: bigint): Promise<void> {
  for (const oid of [orgId, orgBId]) {
    await raw.masterySnapshot.deleteMany({ where: { orgId: oid } });
    await raw.wrongBookEntry.deleteMany({ where: { orgId: oid } });
    await raw.gradingRecord.deleteMany({ where: { orgId: oid } });
    await raw.answer.deleteMany({ where: { orgId: oid } });
    await raw.attempt.deleteMany({ where: { orgId: oid } });
    await raw.assignment.deleteMany({ where: { orgId: oid } });
    await raw.paperQuestion.deleteMany({ where: { orgId: oid } });
    await raw.paper.deleteMany({ where: { orgId: oid } });
    await raw.questionTag.deleteMany({ where: { orgId: oid } });
    await raw.questionOption.deleteMany({ where: { orgId: oid } });
    await raw.question.deleteMany({ where: { orgId: oid } });
    await raw.kpEdge.deleteMany({ where: { orgId: oid } });
    await raw.kpNode.deleteMany({ where: { orgId: oid } });
    await raw.kpGraph.deleteMany({ where: { orgId: oid } });
    await raw.sessionEvent.deleteMany({ where: { orgId: oid } });
    await raw.sessionParticipant.deleteMany({ where: { orgId: oid } });
    await raw.classSession.deleteMany({ where: { orgId: oid } });
    await raw.lessonSegment.deleteMany({ where: { orgId: oid } });
    await raw.lesson.deleteMany({ where: { orgId: oid } });
    await raw.resource.deleteMany({ where: { orgId: oid } });
    await raw.courseStudent.deleteMany({ where: { orgId: oid } });
    await raw.course.deleteMany({ where: { orgId: oid } });
    await raw.device.deleteMany({ where: { orgId: oid } });
    await raw.loginTicket.deleteMany({ where: { orgId: oid } });
    await raw.auditLog.deleteMany({ where: { orgId: oid } });
    await raw.user.deleteMany({ where: { orgId: oid } });
    await raw.org.deleteMany({ where: { id: oid } });
  }
}
