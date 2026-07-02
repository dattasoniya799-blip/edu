/**
 * A5 测试夹具(自建自清,不触碰 seed 数据,手机号 1394 开头):
 * - 机构A:admin / 教师 / 学生×3(s1、s2 选课,s3 未选课)
 *   + 小型知识图谱(N1、N2)+ 4 题(single/multi/blank/solution,挂 tags)
 *   + 作业卷(25 分:5+5+5+10)+ homework assignment(整班)
 * - 机构B:教师 + 学生(跨租户 404 用例,宪法 §7)
 */
import { hashPassword } from '../../src/auth/password.util';
import { raw } from './setup';

export const A5_PASSWORD = 'A5@Pass123';

export interface A5Fixture {
  orgId: bigint;
  teacherId: bigint;
  s1Id: bigint;
  s2Id: bigint;
  s3Id: bigint;
  teacherPhone: string;
  courseId: bigint;
  node1Id: bigint;
  node2Id: bigint;
  /** [single, multi, blank, solution] */
  questionIds: bigint[];
  paperId: bigint;
  assignmentId: number;
  /** 机构B(跨租户) */
  orgBId: bigint;
  teacherBPhone: string;
  studentBId: bigint;
}

/** q4(solution)的 rubric:3+4+3 = 10 分 */
export const A5_RUBRIC = [
  { step: 1, desc: '设解析式并代入两点', score: 3 },
  { step: 2, desc: '解出待定系数', score: 4 },
  { step: 3, desc: '还原平移并写出结论', score: 3 },
];

export async function createA5Org(): Promise<A5Fixture> {
  const hash = await hashPassword(A5_PASSWORD);
  const org = await raw.org.create({
    data: {
      name: 'A5作答批改测试机构',
      settings: {
        ai: { qaGuideOnly: true, preGrading: true },
        studentHours: { start: '06:00', end: '22:30' },
        deviceBinding: true,
      },
    },
  });
  const orgId = org.id;
  const [_admin, teacher, s1, s2, s3] = await Promise.all([
    raw.user.create({ data: { orgId, role: 'admin', name: 'A5管理员', phone: '13940000001', passwordHash: hash } }),
    raw.user.create({ data: { orgId, role: 'teacher', name: 'A5教师', phone: '13940000002', passwordHash: hash } }),
    raw.user.create({ data: { orgId, role: 'student', name: 'A5学生一', phone: '13940000011', studentNo: 'A5-S001' } }),
    raw.user.create({ data: { orgId, role: 'student', name: 'A5学生二', phone: '13940000012', studentNo: 'A5-S002' } }),
    raw.user.create({ data: { orgId, role: 'student', name: 'A5学生三', phone: '13940000013', studentNo: 'A5-S003' } }),
  ]);

  const course = await raw.course.create({
    data: {
      orgId,
      name: 'A5 · 初二数学作答班',
      classType: 'group',
      subject: '数学',
      stage: '初中',
      teacherId: teacher.id,
      totalLessons: 3,
      status: 'ongoing',
    },
  });
  await raw.courseStudent.createMany({
    data: [s1.id, s2.id].map((sid) => ({ orgId, courseId: course.id, studentId: sid })),
  });

  // ---- 小型图谱:N1、N2(掌握度手算用)----
  const graph = await raw.kpGraph.create({
    data: { orgId, code: 'a5_test_graph', graphType: 'curriculum_knowledge', subject: '数学' },
  });
  const node1 = await raw.kpNode.create({
    data: { orgId, graphId: graph.id, code: 'A5-N1', name: 'A5·一次函数解析式' },
  });
  const node2 = await raw.kpNode.create({
    data: { orgId, graphId: graph.id, code: 'A5-N2', name: 'A5·图象平移' },
  });

  // ---- 4 题:single / multi / blank / solution ----
  const q1 = await raw.question.create({
    data: {
      orgId, ownerId: teacher.id, type: 'single', stage: '初中', subject: '数学',
      stemLatex: 'A5-Q1 将 $y=2x+1$ 向下平移 2 个单位后的解析式为(  )',
      answer: { choice: 'B' },
      analysisLatex: '平移口诀:上加下减。',
      difficulty: 2, status: 'published',
    },
  });
  await raw.questionOption.createMany({
    data: ['A', 'B', 'C', 'D'].map((label, i) => ({
      orgId, questionId: q1.id, label, contentLatex: `$选项${label}$`, isCorrect: i === 1,
    })),
  });
  const q2 = await raw.question.create({
    data: {
      orgId, ownerId: teacher.id, type: 'multi', stage: '初中', subject: '数学',
      stemLatex: 'A5-Q2 下列说法正确的是(多选)(  )',
      answer: { choices: ['A', 'C'] },
      analysisLatex: 'A、C 正确;B 混淆了 k 与 b。',
      difficulty: 2, status: 'published',
    },
  });
  await raw.questionOption.createMany({
    data: ['A', 'B', 'C', 'D'].map((label, i) => ({
      orgId, questionId: q2.id, label, contentLatex: `$选项${label}$`, isCorrect: i === 0 || i === 2,
    })),
  });
  const q3 = await raw.question.create({
    data: {
      orgId, ownerId: teacher.id, type: 'blank', stage: '初中', subject: '数学',
      stemLatex: 'A5-Q3 经过 $(0,1)$ 且 $k=2$ 的一次函数解析式为 ________。',
      answer: { texts: ['y=2x+1'] },
      analysisLatex: '代入 $k=2$、$b=1$。',
      difficulty: 1, status: 'published',
    },
  });
  const q4 = await raw.question.create({
    data: {
      orgId, ownerId: teacher.id, type: 'solution', stage: '初中', subject: '数学',
      stemLatex: 'A5-Q4 求原直线的解析式(写出完整过程)。',
      answer: { referenceLatex: '$y=2x+3$' },
      rubric: A5_RUBRIC,
      analysisLatex: '设式代入,解出系数后注意还原方向。',
      difficulty: 3, status: 'published',
    },
  });
  // tags:q1→N1;q2→N1+N2;q3→N2;q4→N1(主观题不入客观正确率样本)
  await raw.questionTag.createMany({
    data: [
      { orgId, questionId: q1.id, nodeId: node1.id },
      { orgId, questionId: q2.id, nodeId: node1.id },
      { orgId, questionId: q2.id, nodeId: node2.id },
      { orgId, questionId: q3.id, nodeId: node2.id },
      { orgId, questionId: q4.id, nodeId: node1.id },
    ],
  });

  // ---- 作业卷 + homework assignment(整班)----
  const paper = await raw.paper.create({
    data: { orgId, creatorId: teacher.id, name: 'A5 · 第1讲课后作业', type: 'homework', totalScore: 25, status: 'published' },
  });
  await raw.paperQuestion.createMany({
    data: [q1, q2, q3, q4].map((q, i) => ({
      orgId, paperId: paper.id, questionId: q.id, seq: i + 1, score: i === 3 ? 10 : 5,
    })),
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

  // ---- 机构B(跨租户)----
  const orgB = await raw.org.create({
    data: {
      name: 'A5跨租户机构B',
      settings: {
        ai: { qaGuideOnly: true, preGrading: true },
        studentHours: { start: '06:00', end: '22:30' },
        deviceBinding: true,
      },
    },
  });
  const [teacherB, studentB] = await Promise.all([
    raw.user.create({ data: { orgId: orgB.id, role: 'teacher', name: 'A5教师B', phone: '13940000021', passwordHash: hash } }),
    raw.user.create({ data: { orgId: orgB.id, role: 'student', name: 'A5学生B', phone: '13940000022', studentNo: 'A5-B001' } }),
  ]);

  return {
    orgId,
    teacherId: teacher.id,
    s1Id: s1.id,
    s2Id: s2.id,
    s3Id: s3.id,
    teacherPhone: teacher.phone!,
    courseId: course.id,
    node1Id: node1.id,
    node2Id: node2.id,
    questionIds: [q1.id, q2.id, q3.id, q4.id],
    paperId: paper.id,
    assignmentId: Number(assignment.id),
    orgBId: orgB.id,
    teacherBPhone: teacherB.phone!,
    studentBId: studentB.id,
  };
}

export async function dropA5Org(orgId: bigint, orgBId: bigint): Promise<void> {
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
    await raw.courseStudent.deleteMany({ where: { orgId: oid } });
    await raw.course.deleteMany({ where: { orgId: oid } });
    await raw.device.deleteMany({ where: { orgId: oid } });
    await raw.loginTicket.deleteMany({ where: { orgId: oid } });
    await raw.auditLog.deleteMany({ where: { orgId: oid } });
    await raw.user.deleteMany({ where: { orgId: oid } });
    await raw.org.deleteMany({ where: { id: oid } });
  }
}
