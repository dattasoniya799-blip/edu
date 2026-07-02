/**
 * asg-teacher 夹具(Assignment teacher 锚点,经用户批准的 schema 变更;
 * 自建自清,手机号 13957 段,与既有夹具不撞):
 * 单机构内两名教师:
 *  - teacherA 拥有 courseA(s1、s2 在册)与 lessonA;
 *  - teacherB 同机构、拥有 courseB,不授 courseA —— 越权红线用例的"他师"。
 * 物料:
 *  - qSingle(single,答案 B)+ qSol(solution)→ paperDirected(5+10 分),
 *    供 spec 里 teacherA 经 POST /assignments 发布「定向 consolidation」(studentIds,无讲次);
 *  - legacyAssignment:raw 建、teacherId=null、挂 lessonA(homework 整班)——
 *    模拟迁移 0002 回填前口径的老作业(teacherId 为空 + course 锚点)。
 */
import { hashPassword } from '../../src/auth/password.util';
import { raw } from './setup';

export const ASG_PASSWORD = 'Asg@Pass123';

export interface AsgFixture {
  orgId: bigint;
  teacherAId: bigint;
  teacherAPhone: string;
  teacherBId: bigint;
  teacherBPhone: string;
  s1Id: bigint;
  s2Id: bigint;
  courseAId: bigint;
  courseBId: bigint;
  lessonAId: number;
  qSingleId: bigint;
  qSolId: bigint;
  paperDirectedId: number;
  legacyAssignmentId: number;
}

export async function createAsgOrg(): Promise<AsgFixture> {
  const hash = await hashPassword(ASG_PASSWORD);
  const org = await raw.org.create({
    data: {
      name: 'ASG · teacher 锚点测试机构',
      settings: {
        ai: { qaGuideOnly: true, preGrading: true },
        studentHours: { start: '06:00', end: '22:30' },
        deviceBinding: true,
      },
    },
  });
  const orgId = org.id;
  const [, teacherA, teacherB, s1, s2] = await Promise.all([
    raw.user.create({ data: { orgId, role: 'admin', name: 'ASG管理员', phone: '13957000003', passwordHash: hash } }),
    raw.user.create({ data: { orgId, role: 'teacher', name: 'ASG教师A', phone: '13957000001', passwordHash: hash } }),
    raw.user.create({ data: { orgId, role: 'teacher', name: 'ASG教师B', phone: '13957000002', passwordHash: hash } }),
    raw.user.create({ data: { orgId, role: 'student', name: 'ASG学生一', phone: '13957000011', studentNo: 'ASG-S001' } }),
    raw.user.create({ data: { orgId, role: 'student', name: 'ASG学生二', phone: '13957000012', studentNo: 'ASG-S002' } }),
  ]);

  const courseA = await raw.course.create({
    data: {
      orgId, name: 'ASG · A班', classType: 'group', subject: '数学', stage: '初中',
      teacherId: teacherA.id, totalLessons: 3, status: 'ongoing',
    },
  });
  const courseB = await raw.course.create({
    data: {
      orgId, name: 'ASG · B班', classType: 'group', subject: '数学', stage: '初中',
      teacherId: teacherB.id, totalLessons: 3, status: 'ongoing',
    },
  });
  await raw.courseStudent.createMany({
    data: [s1.id, s2.id].map((sid) => ({ orgId, courseId: courseA.id, studentId: sid })),
  });
  const lessonA = await raw.lesson.create({
    data: { orgId, courseId: courseA.id, seq: 1, title: 'ASG 第1讲', status: 'draft' },
  });

  // ---- 题目:single(答案 B)+ solution ----
  const qSingle = await raw.question.create({
    data: {
      orgId, ownerId: teacherA.id, type: 'single', stage: '初中', subject: '数学',
      stemLatex: 'ASG-Q1 选择正确选项。', answer: { choice: 'B' },
      analysisLatex: '见解析。', difficulty: 1, status: 'published',
    },
  });
  await raw.questionOption.createMany({
    data: ['A', 'B', 'C', 'D'].map((l, i) => ({
      orgId, questionId: qSingle.id, label: l, contentLatex: `选项${l}`, isCorrect: i === 1,
    })),
  });
  const qSol = await raw.question.create({
    data: {
      orgId, ownerId: teacherA.id, type: 'solution', stage: '初中', subject: '数学',
      stemLatex: 'ASG-Q2 写出完整过程。', answer: { referenceLatex: '$x=2$' },
      rubric: [{ step: 1, desc: '列式', score: 5 }, { step: 2, desc: '求解', score: 5 }],
      analysisLatex: '列式求解。', difficulty: 2, status: 'published',
    },
  });

  // ---- 卷:定向 consolidation 用(single 5 + solution 10)----
  const paperDirected = await raw.paper.create({
    data: { orgId, creatorId: teacherA.id, name: 'ASG · 定向巩固卷', type: 'homework', totalScore: 15, status: 'published' },
  });
  await raw.paperQuestion.createMany({
    data: [
      { orgId, paperId: paperDirected.id, questionId: qSingle.id, seq: 1, score: 5 },
      { orgId, paperId: paperDirected.id, questionId: qSol.id, seq: 2, score: 10 },
    ],
  });

  // ---- 回填前口径的"老作业":teacherId=null + lesson 锚点(courseA)----
  const legacyPaper = await raw.paper.create({
    data: { orgId, creatorId: teacherA.id, name: 'ASG · 老作业卷', type: 'homework', totalScore: 5, status: 'published' },
  });
  await raw.paperQuestion.create({
    data: { orgId, paperId: legacyPaper.id, questionId: qSingle.id, seq: 1, score: 5 },
  });
  const legacyAssignment = await raw.assignment.create({
    data: {
      orgId, paperId: legacyPaper.id, lessonId: lessonA.id, kind: 'homework',
      target: { courseId: Number(courseA.id) },
      gradingPolicy: { objective: 'instant' }, scoreCounted: true,
      // teacherId 留 null:模拟迁移回填前老作业(读侧兼容口径:course 锚点判归属)
    },
  });

  return {
    orgId,
    teacherAId: teacherA.id, teacherAPhone: teacherA.phone!,
    teacherBId: teacherB.id, teacherBPhone: teacherB.phone!,
    s1Id: s1.id, s2Id: s2.id,
    courseAId: courseA.id, courseBId: courseB.id,
    lessonAId: Number(lessonA.id),
    qSingleId: qSingle.id, qSolId: qSol.id,
    paperDirectedId: Number(paperDirected.id),
    legacyAssignmentId: Number(legacyAssignment.id),
  };
}

export async function dropAsgOrg(orgId: bigint): Promise<void> {
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
  await raw.lessonSegment.deleteMany({ where: { orgId } });
  await raw.classSession.deleteMany({ where: { orgId } });
  await raw.lesson.deleteMany({ where: { orgId } });
  await raw.courseStudent.deleteMany({ where: { orgId } });
  await raw.course.deleteMany({ where: { orgId } });
  await raw.auditLog.deleteMany({ where: { orgId } });
  await raw.user.deleteMany({ where: { orgId } });
  await raw.org.deleteMany({ where: { id: orgId } });
}
