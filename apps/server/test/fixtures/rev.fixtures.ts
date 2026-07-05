/**
 * REV-back 测试夹具(自建自清,手机号 13912 开头,专属 qiming_rev 库):
 * - 机构:admin / 教师 / 学生 s1(选课)/ 学生 s2(选课)
 * - 课程 + 一节 draft 讲次(供环节时长用例 #6)
 * - 题目:qA/qB 两道单选(客观,即时判分)+ qSol 一道主观解答(走复核管线)
 * - P_obj(qA+qB,各 10 分,共 20)→ 作业 A_hw(整班)/ 巩固 A_con(指定学生 s1)
 * - P_sub(qA+qSol,各 10 分,共 20)→ 作业 A_sub(整班,供 #7 复核回写)
 * 覆盖修复项:#1 重置吊销、#3 试卷分值上界、#4 view-url 归属、#5 已完成不可重作、
 *            #6 环节时长豁免、#7 review 回写。#2 异常映射在 spec 内对过滤器直测。
 */
import { raw } from './setup';

export const REV_PASSWORD = 'Rev@Pass123';

export interface RevFixture {
  orgId: bigint;
  adminId: bigint;
  adminPhone: string;
  teacherId: bigint;
  teacherPhone: string;
  s1Id: bigint;
  s2Id: bigint;
  courseId: bigint;
  lessonId: number;
  qAId: bigint;
  qBId: bigint;
  qSolId: bigint;
  pObjId: number;
  pSubId: number;
  hwAssignmentId: number;
  conAssignmentId: number;
  subAssignmentId: number;
}

export async function createRevOrg(): Promise<RevFixture> {
  const { hashPassword } = await import('../../src/auth/password.util');
  const hash = await hashPassword(REV_PASSWORD);
  const org = await raw.org.create({
    data: {
      name: 'REV-back 真问题修复测试机构',
      settings: {
        ai: { qaGuideOnly: true, preGrading: true },
        studentHours: { start: '00:00', end: '23:59' },
        deviceBinding: true,
      },
    },
  });
  const orgId = org.id;
  const [admin, teacher, s1, s2] = await Promise.all([
    raw.user.create({ data: { orgId, role: 'admin', name: 'REV管理员', phone: '13912000001', passwordHash: hash } }),
    raw.user.create({ data: { orgId, role: 'teacher', name: 'REV教师', phone: '13912000002', passwordHash: hash } }),
    raw.user.create({ data: { orgId, role: 'student', name: 'REV学生一', phone: '13912000011', studentNo: 'REV-S001' } }),
    raw.user.create({ data: { orgId, role: 'student', name: 'REV学生二', phone: '13912000012', studentNo: 'REV-S002' } }),
  ]);

  const course = await raw.course.create({
    data: {
      orgId, name: 'REV · 初二数学班', classType: 'group', subject: '数学',
      stage: '初中', teacherId: teacher.id, totalLessons: 3, status: 'ongoing',
    },
  });
  await raw.courseStudent.createMany({
    data: [s1, s2].map((s) => ({ orgId, courseId: course.id, studentId: s.id })),
  });

  const lesson = await raw.lesson.create({
    data: { orgId, courseId: course.id, seq: 1, title: 'REV 第1讲 · 待编排', status: 'draft' },
  });

  // ---- 题目:两道单选 + 一道解答 ----
  const mkSingle = (label: string, choice: string) =>
    raw.question.create({
      data: {
        orgId, ownerId: teacher.id, type: 'single', stage: '初中', subject: '数学',
        stemLatex: `REV-${label} 选择正确选项。`,
        answer: { choice },
        analysisLatex: '见解析。',
        difficulty: 1, status: 'published',
        options: {
          create: [
            { orgId, label: 'A', contentLatex: '选项A', isCorrect: choice === 'A' },
            { orgId, label: 'B', contentLatex: '选项B', isCorrect: choice === 'B' },
          ],
        },
      },
    });
  const qA = await mkSingle('Q1', 'A');
  const qB = await mkSingle('Q2', 'B');
  const qSol = await raw.question.create({
    data: {
      orgId, ownerId: teacher.id, type: 'solution', stage: '初中', subject: '数学',
      stemLatex: 'REV-Q3 证明 $a^2+b^2\\ge 2ab$(解答题,人工复核)。',
      answer: { referenceLatex: '由 $(a-b)^2\\ge 0$ 展开即得。' },
      rubric: [{ step: 1, desc: '配方', score: 5 }, { step: 2, desc: '结论', score: 5 }],
      analysisLatex: '完全平方非负。',
      difficulty: 2, status: 'published',
    },
  });

  // ---- 客观卷 P_obj → homework A_hw(整班) + consolidation A_con(指定 s1)----
  const pObj = await raw.paper.create({
    data: { orgId, creatorId: teacher.id, name: 'REV · 客观作业', type: 'homework', totalScore: 20, status: 'published' },
  });
  await raw.paperQuestion.createMany({
    data: [qA, qB].map((q, i) => ({ orgId, paperId: pObj.id, questionId: q.id, seq: i + 1, score: 10 })),
  });
  const hwAssignment = await raw.assignment.create({
    data: {
      orgId, paperId: pObj.id, teacherId: teacher.id, kind: 'homework', target: { courseId: Number(course.id) },
      dueAt: new Date(Date.now() + 7 * 86400_000),
      gradingPolicy: { objective: 'instant' }, scoreCounted: true,
    },
  });
  const conAssignment = await raw.assignment.create({
    data: {
      orgId, paperId: pObj.id, teacherId: teacher.id, kind: 'consolidation', target: { studentIds: [Number(s1.id)] },
      dueAt: new Date(Date.now() + 7 * 86400_000),
      gradingPolicy: { objective: 'instant' }, scoreCounted: false,
    },
  });

  // ---- 主观卷 P_sub(单选 + 解答)→ homework A_sub(整班,供 #7)----
  const pSub = await raw.paper.create({
    data: { orgId, creatorId: teacher.id, name: 'REV · 主观作业', type: 'homework', totalScore: 20, status: 'published' },
  });
  await raw.paperQuestion.createMany({
    data: [
      { orgId, paperId: pSub.id, questionId: qA.id, seq: 1, score: 10 },
      { orgId, paperId: pSub.id, questionId: qSol.id, seq: 2, score: 10 },
    ],
  });
  const subAssignment = await raw.assignment.create({
    data: {
      orgId, paperId: pSub.id, teacherId: teacher.id, kind: 'homework', target: { courseId: Number(course.id) },
      dueAt: new Date(Date.now() + 7 * 86400_000),
      gradingPolicy: { objective: 'instant', subjective: 'ai_pre_review' }, scoreCounted: true,
    },
  });

  return {
    orgId,
    adminId: admin.id, adminPhone: admin.phone!,
    teacherId: teacher.id, teacherPhone: teacher.phone!,
    s1Id: s1.id, s2Id: s2.id,
    courseId: course.id,
    lessonId: Number(lesson.id),
    qAId: qA.id, qBId: qB.id, qSolId: qSol.id,
    pObjId: Number(pObj.id), pSubId: Number(pSub.id),
    hwAssignmentId: Number(hwAssignment.id),
    conAssignmentId: Number(conAssignment.id),
    subAssignmentId: Number(subAssignment.id),
  };
}

export async function dropRevOrg(orgId: bigint): Promise<void> {
  await raw.masterySnapshot.deleteMany({ where: { orgId } });
  await raw.wrongBookEntry.deleteMany({ where: { orgId } });
  await raw.gradingRecord.deleteMany({ where: { orgId } });
  await raw.answer.deleteMany({ where: { orgId } });
  await raw.attempt.deleteMany({ where: { orgId } });
  await raw.assignment.deleteMany({ where: { orgId } });
  await raw.lessonSegment.deleteMany({ where: { orgId } });
  await raw.paperQuestion.deleteMany({ where: { orgId } });
  await raw.paper.deleteMany({ where: { orgId } });
  await raw.questionTag.deleteMany({ where: { orgId } });
  await raw.questionOption.deleteMany({ where: { orgId } });
  await raw.question.deleteMany({ where: { orgId } });
  await raw.lesson.deleteMany({ where: { orgId } });
  await raw.courseStudent.deleteMany({ where: { orgId } });
  await raw.course.deleteMany({ where: { orgId } });
  await raw.device.deleteMany({ where: { orgId } });
  await raw.loginTicket.deleteMany({ where: { orgId } });
  await raw.auditLog.deleteMany({ where: { orgId } });
  await raw.user.deleteMany({ where: { orgId } });
  await raw.org.deleteMany({ where: { id: orgId } });
}
