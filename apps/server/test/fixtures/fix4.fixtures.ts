/**
 * FIX4-back 测试夹具(自建自清,手机号 13911 号段,不触碰 seed 数据):
 * 机构A:admin / teacher / 学生 s1(选 courseA)/ 学生 sB(仅选 courseB)。
 * - courseA 当天两讲:L_early(今日 06:00 UTC,draft,早)+ L_late(今日 12:00 UTC,ready,晚,
 *   挂 scheduled class_session)→ #5 today 应取 L_late;#1 时间线 L_early.sessionId=null、L_late 非 null。
 * - courseB 仅 sB 在册 → #4 把 courseA 的讲次发给 sB / courseB 一律 400,发给 s1 / courseA 200。
 * - 一张 published 试卷(单题)供 #4 建作业;一个 curriculum_knowledge 节点供 #6 重复标签建题。
 */
import { hashPassword } from '../../src/auth/password.util';
import { raw } from './setup';

export const FIX4_PASSWORD = 'Fix4@Pass123';

const utcDayStart = () => {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
};

export interface Fix4Fixture {
  orgId: bigint;
  adminPhone: string;
  teacherPhone: string;
  s1Id: bigint;
  sBId: bigint;
  courseAId: bigint;
  courseBId: bigint;
  lessonEarlyId: bigint;
  lessonLateId: bigint;
  sessionId: bigint;
  paperId: bigint;
  curriculumNodeId: bigint;
}

const ORG_SETTINGS = {
  ai: { qaGuideOnly: true, preGrading: true },
  studentHours: { start: '06:00', end: '22:30' },
  deviceBinding: true,
};

export async function createFix4Org(): Promise<Fix4Fixture> {
  const hash = await hashPassword(FIX4_PASSWORD);
  const dayStart = utcDayStart();

  const org = await raw.org.create({ data: { name: 'FIX4-back 测试机构', settings: ORG_SETTINGS } });
  const orgId = org.id;
  const admin = await raw.user.create({ data: { orgId, role: 'admin', name: 'FIX4管理员', phone: '13911000001', passwordHash: hash } });
  const teacher = await raw.user.create({ data: { orgId, role: 'teacher', name: 'FIX4教师', phone: '13911000002', passwordHash: hash } });
  const s1 = await raw.user.create({ data: { orgId, role: 'student', name: 'FIX4学生一', phone: '13911000011', studentNo: 'FIX4-S001' } });
  const sB = await raw.user.create({ data: { orgId, role: 'student', name: 'FIX4学生B', phone: '13911000012', studentNo: 'FIX4-S002' } });

  const courseA = await raw.course.create({
    data: { orgId, name: 'FIX4 · A 班', classType: 'group', subject: '数学', stage: '初中', teacherId: teacher.id, totalLessons: 2, status: 'ongoing' },
  });
  const courseB = await raw.course.create({
    data: { orgId, name: 'FIX4 · B 班', classType: 'group', subject: '数学', stage: '初中', teacherId: teacher.id, totalLessons: 1, status: 'ongoing' },
  });
  await raw.courseStudent.createMany({
    data: [
      { orgId, courseId: courseA.id, studentId: s1.id, status: 'active' },
      { orgId, courseId: courseB.id, studentId: sB.id, status: 'active' },
    ],
  });

  // courseA 当天两讲:早草稿 + 晚已发布(有会话)
  const earlyStart = new Date(dayStart.getTime() + 6 * 3600_000);
  const lateStart = new Date(dayStart.getTime() + 12 * 3600_000);
  const lessonEarly = await raw.lesson.create({
    data: { orgId, courseId: courseA.id, seq: 1, title: 'FIX4 第1讲 · 早草稿', status: 'draft', scheduledStart: earlyStart, scheduledEnd: new Date(earlyStart.getTime() + 2 * 3600_000) },
  });
  const lessonLate = await raw.lesson.create({
    data: { orgId, courseId: courseA.id, seq: 2, title: 'FIX4 第2讲 · 晚已发布', status: 'ready', scheduledStart: lateStart, scheduledEnd: new Date(lateStart.getTime() + 2 * 3600_000) },
  });
  const session = await raw.classSession.create({ data: { orgId, lessonId: lessonLate.id, status: 'scheduled' } });

  // #6 重复标签建题用:curriculum_knowledge 节点
  const graph = await raw.kpGraph.create({ data: { orgId, code: 'fix4_curriculum', graphType: 'curriculum_knowledge', subject: '数学' } });
  const node = await raw.kpNode.create({ data: { orgId, graphId: graph.id, code: 'FIX4-N1', name: 'FIX4·一次函数' } });

  // #4 建作业用:一张 published 单题卷
  const q = await raw.question.create({
    data: { orgId, ownerId: teacher.id, type: 'single', stage: '初中', subject: '数学', stemLatex: 'FIX4 单选题', answer: { choice: 'B' }, difficulty: 2, status: 'published' },
  });
  const paper = await raw.paper.create({
    data: { orgId, creatorId: teacher.id, name: 'FIX4 · 作业卷', type: 'homework', totalScore: 5, status: 'published' },
  });
  await raw.paperQuestion.create({ data: { orgId, paperId: paper.id, questionId: q.id, seq: 1, score: 5 } });

  return {
    orgId,
    adminPhone: admin.phone!,
    teacherPhone: teacher.phone!,
    s1Id: s1.id,
    sBId: sB.id,
    courseAId: courseA.id,
    courseBId: courseB.id,
    lessonEarlyId: lessonEarly.id,
    lessonLateId: lessonLate.id,
    sessionId: session.id,
    paperId: paper.id,
    curriculumNodeId: node.id,
  };
}

export async function dropFix4Org(orgId: bigint): Promise<void> {
  await raw.questionTag.deleteMany({ where: { orgId } });
  await raw.questionOption.deleteMany({ where: { orgId } });
  await raw.paperQuestion.deleteMany({ where: { orgId } });
  await raw.assignment.deleteMany({ where: { orgId } });
  await raw.paper.deleteMany({ where: { orgId } });
  await raw.question.deleteMany({ where: { orgId } });
  await raw.kpNode.deleteMany({ where: { orgId } });
  await raw.kpGraph.deleteMany({ where: { orgId } });
  await raw.sessionParticipant.deleteMany({ where: { orgId } });
  await raw.classSession.deleteMany({ where: { orgId } });
  await raw.lesson.deleteMany({ where: { orgId } });
  await raw.courseStudent.deleteMany({ where: { orgId } });
  await raw.course.deleteMany({ where: { orgId } });
  await raw.device.deleteMany({ where: { orgId } });
  await raw.loginTicket.deleteMany({ where: { orgId } });
  await raw.auditLog.deleteMany({ where: { orgId } });
  await raw.user.deleteMany({ where: { orgId } });
  await raw.org.deleteMany({ where: { id: orgId } });
}
