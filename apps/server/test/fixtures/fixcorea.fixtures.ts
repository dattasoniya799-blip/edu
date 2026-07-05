/**
 * fix-core A 验收夹具(自建自清,手机号 139592 号段,不触碰 seed 数据):
 * - 机构:admin / 教师 / 学生 + 选课
 * - A1:单选题(答案 A)+ homework 计分卷 + homework assignment —— 判错锁题 + 首判计分
 * - A2/A5:两道纯净 blank 题(qA / qB,答案/题干不含审查命中词)作为答疑题目上下文
 * 所有登录门禁相关设置默认全天放开(studentHours 00:00-23:59),
 * 需要收窄时由 A3 用例经 /admin/settings 动态改写。
 */
import { hashPassword } from '../../src/auth/password.util';
import { raw } from './setup';

export const FIXA_PASSWORD = 'FixA@Pass123';
export const FIXA_STUDENT_PASSWORD = 'FixAStu@123';

/** 139592 号段:P(1)=13959200001 */
export const FIXA_P = (n: number) => `139592${String(n).padStart(5, '0')}`;

export interface FixAFixture {
  orgId: bigint;
  adminPhone: string;
  teacherPhone: string;
  studentId: bigint;
  studentNo: string;
  courseId: bigint;
  /** A1 单选题(答案 A) */
  singleQuestionId: bigint;
  paperId: bigint;
  assignmentId: number;
  /** A2/A5 答疑题目上下文 */
  qAId: bigint;
  qBId: bigint;
}

export async function createFixAOrg(): Promise<FixAFixture> {
  const hash = await hashPassword(FIXA_PASSWORD);
  const studentHash = await hashPassword(FIXA_STUDENT_PASSWORD);
  const org = await raw.org.create({
    data: {
      name: 'fix-core-A 验收机构',
      settings: {
        ai: { qaGuideOnly: true, preGrading: true },
        studentHours: { start: '00:00', end: '23:59' },
        deviceBinding: false,
      },
    },
  });
  const orgId = org.id;
  const [admin, teacher, student] = await Promise.all([
    raw.user.create({ data: { orgId, role: 'admin', name: 'FixA管理员', phone: FIXA_P(1), passwordHash: hash } }),
    raw.user.create({ data: { orgId, role: 'teacher', name: 'FixA教师', phone: FIXA_P(2), passwordHash: hash } }),
    raw.user.create({
      data: {
        orgId, role: 'student', name: 'FixA学生', phone: FIXA_P(11),
        studentNo: 'FIXA-S001', status: 'active', passwordHash: studentHash,
      },
    }),
  ]);

  const course = await raw.course.create({
    data: {
      orgId, name: 'FixA · 初二数学班', classType: 'group', subject: '数学', stage: '初中',
      teacherId: teacher.id, totalLessons: 3, status: 'ongoing',
    },
  });
  await raw.courseStudent.create({ data: { orgId, courseId: course.id, studentId: student.id } });

  // A1:单选题,正确答案 A
  const single = await raw.question.create({
    data: {
      orgId, ownerId: teacher.id, type: 'single', stage: '初中', subject: '数学',
      stemLatex: 'FixA-Q1 下列哪项等于 $1+1$?',
      answer: { choice: 'A' },
      analysisLatex: '$1+1=2$,结论为 A。',
      difficulty: 1, status: 'published',
    },
  });

  // A2/A5:纯 blank 题上下文(答案/题干均不含审查命中词)
  const qA = await raw.question.create({
    data: {
      orgId, ownerId: teacher.id, type: 'blank', stage: '初中', subject: '数学',
      stemLatex: 'FixA-QA 一次函数过原点且斜率为二,写出解析式(过程题)。',
      answer: { texts: ['y=2x'] },
      analysisLatex: '设 $y=kx$,由斜率得 $k=2$。',
      difficulty: 2, status: 'published',
    },
  });
  const qB = await raw.question.create({
    data: {
      orgId, ownerId: teacher.id, type: 'blank', stage: '初中', subject: '数学',
      stemLatex: 'FixA-QB 求边长为三的正方形面积(过程题)。',
      answer: { texts: ['nine'] },
      analysisLatex: '面积等于边长平方。',
      difficulty: 2, status: 'published',
    },
  });

  // A1:纯客观(单题)作业卷 → 交卷自动出分
  const paper = await raw.paper.create({
    data: { orgId, creatorId: teacher.id, name: 'FixA · 客观题作业', type: 'homework', totalScore: 10, status: 'published' },
  });
  await raw.paperQuestion.create({
    data: { orgId, paperId: paper.id, questionId: single.id, seq: 1, score: 10 },
  });
  const assignment = await raw.assignment.create({
    data: {
      orgId, paperId: paper.id, teacherId: teacher.id, kind: 'homework',
      target: { courseId: Number(course.id) },
      dueAt: new Date(Date.now() + 7 * 86400_000),
      gradingPolicy: { objective: 'instant', subjective: 'ai_pre_review' },
      scoreCounted: true,
    },
  });

  void admin;
  return {
    orgId,
    adminPhone: FIXA_P(1),
    teacherPhone: FIXA_P(2),
    studentId: student.id,
    studentNo: 'FIXA-S001',
    courseId: course.id,
    singleQuestionId: single.id,
    paperId: paper.id,
    assignmentId: Number(assignment.id),
    qAId: qA.id,
    qBId: qB.id,
  };
}

export async function dropFixAOrg(orgId: bigint): Promise<void> {
  await raw.aiCall.deleteMany({ where: { orgId } });
  await raw.aiQuota.deleteMany({ where: { orgId } });
  await raw.masterySnapshot.deleteMany({ where: { orgId } });
  await raw.wrongBookEntry.deleteMany({ where: { orgId } });
  await raw.gradingRecord.deleteMany({ where: { orgId } });
  await raw.answer.deleteMany({ where: { orgId } });
  await raw.attempt.deleteMany({ where: { orgId } });
  await raw.assignment.deleteMany({ where: { orgId } });
  await raw.paperQuestion.deleteMany({ where: { orgId } });
  await raw.paper.deleteMany({ where: { orgId } });
  await raw.question.deleteMany({ where: { orgId } });
  await raw.courseStudent.deleteMany({ where: { orgId } });
  await raw.course.deleteMany({ where: { orgId } });
  await raw.device.deleteMany({ where: { orgId } });
  await raw.loginTicket.deleteMany({ where: { orgId } });
  await raw.auditLog.deleteMany({ where: { orgId } });
  await raw.user.deleteMany({ where: { orgId } });
  await raw.org.deleteMany({ where: { id: orgId } });
}
