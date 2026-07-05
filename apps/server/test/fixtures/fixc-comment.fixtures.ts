/**
 * FIXC-comment 测试夹具(自建自清,手机号 139594 开头,专属 qiming_fixc 库):
 * [2026-07-05 批准·契约] 学生 attempt 视图 answers[].teacherComment 验收
 * - 机构:教师 / 学生 s1、s2(选课)
 * - 题目:qA 单选(客观,即时判分)+ qSol 解答(走教师复核管线)
 * - P_sub(qA+qSol,各 10 分)→ 作业 A_sub(整班)
 * 验收:review 写 comment → finalize 前学生不见 teacherComment;finalize 后可见;
 *       空点评(review 不带 comment)finalize 后不下发字段。
 */
import { raw } from './setup';

export const FIXC_PASSWORD = 'Fixc@Pass123';

export interface FixcFixture {
  orgId: bigint;
  teacherId: bigint;
  teacherPhone: string;
  s1Id: bigint;
  s2Id: bigint;
  courseId: bigint;
  qAId: bigint;
  qSolId: bigint;
  pSubId: number;
  subAssignmentId: number;
}

export async function createFixcOrg(): Promise<FixcFixture> {
  const { hashPassword } = await import('../../src/auth/password.util');
  const hash = await hashPassword(FIXC_PASSWORD);
  const org = await raw.org.create({
    data: {
      name: 'FIXC · 教师点评下发测试机构',
      settings: {
        ai: { qaGuideOnly: true, preGrading: true },
        studentHours: { start: '06:00', end: '22:30' },
        deviceBinding: true,
      },
    },
  });
  const orgId = org.id;
  const [teacher, s1, s2] = await Promise.all([
    raw.user.create({ data: { orgId, role: 'teacher', name: 'FIXC教师', phone: '13959400002', passwordHash: hash } }),
    raw.user.create({ data: { orgId, role: 'student', name: 'FIXC学生一', phone: '13959400011', studentNo: 'FIXC-S001' } }),
    raw.user.create({ data: { orgId, role: 'student', name: 'FIXC学生二', phone: '13959400012', studentNo: 'FIXC-S002' } }),
  ]);

  const course = await raw.course.create({
    data: {
      orgId, name: 'FIXC · 初二数学班', classType: 'group', subject: '数学',
      stage: '初中', teacherId: teacher.id, totalLessons: 3, status: 'ongoing',
    },
  });
  await raw.courseStudent.createMany({
    data: [s1, s2].map((s) => ({ orgId, courseId: course.id, studentId: s.id })),
  });

  const qA = await raw.question.create({
    data: {
      orgId, ownerId: teacher.id, type: 'single', stage: '初中', subject: '数学',
      stemLatex: 'FIXC-Q1 选择正确选项。',
      answer: { choice: 'A' },
      analysisLatex: '见解析。',
      difficulty: 1, status: 'published',
      options: {
        create: [
          { orgId, label: 'A', contentLatex: '选项A', isCorrect: true },
          { orgId, label: 'B', contentLatex: '选项B', isCorrect: false },
        ],
      },
    },
  });
  const qSol = await raw.question.create({
    data: {
      orgId, ownerId: teacher.id, type: 'solution', stage: '初中', subject: '数学',
      stemLatex: 'FIXC-Q2 证明 $a^2+b^2\\ge 2ab$(解答题,人工复核)。',
      answer: { referenceLatex: '由 $(a-b)^2\\ge 0$ 展开即得。' },
      rubric: [{ step: 1, desc: '配方', score: 5 }, { step: 2, desc: '结论', score: 5 }],
      analysisLatex: '完全平方非负。',
      difficulty: 2, status: 'published',
    },
  });

  const pSub = await raw.paper.create({
    data: { orgId, creatorId: teacher.id, name: 'FIXC · 主观作业', type: 'homework', totalScore: 20, status: 'published' },
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
    teacherId: teacher.id, teacherPhone: teacher.phone!,
    s1Id: s1.id, s2Id: s2.id,
    courseId: course.id,
    qAId: qA.id, qSolId: qSol.id,
    pSubId: Number(pSub.id),
    subAssignmentId: Number(subAssignment.id),
  };
}

export async function dropFixcOrg(orgId: bigint): Promise<void> {
  await raw.masterySnapshot.deleteMany({ where: { orgId } });
  await raw.wrongBookEntry.deleteMany({ where: { orgId } });
  await raw.gradingRecord.deleteMany({ where: { orgId } });
  await raw.answer.deleteMany({ where: { orgId } });
  await raw.attempt.deleteMany({ where: { orgId } });
  await raw.assignment.deleteMany({ where: { orgId } });
  await raw.paperQuestion.deleteMany({ where: { orgId } });
  await raw.paper.deleteMany({ where: { orgId } });
  await raw.questionOption.deleteMany({ where: { orgId } });
  await raw.question.deleteMany({ where: { orgId } });
  await raw.courseStudent.deleteMany({ where: { orgId } });
  await raw.course.deleteMany({ where: { orgId } });
  await raw.device.deleteMany({ where: { orgId } });
  await raw.loginTicket.deleteMany({ where: { orgId } });
  await raw.auditLog.deleteMany({ where: { orgId } });
  await raw.user.deleteMany({ where: { orgId } });
  await raw.org.deleteMany({ where: { id: orgId } });
}
