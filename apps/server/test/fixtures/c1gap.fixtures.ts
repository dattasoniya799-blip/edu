/**
 * C1GAP 测试夹具(自建自清,不触碰 seed 数据,手机号 13901 开头):
 * - 机构A:admin / 教师 / 学生×2(s1、s2 均选课)
 *   + 小图谱(N1)+ 5 题(single/multi/blank简单/solution/blank公式)挂 tags
 *   + 作业卷(30 分:5+5+5+10+5)+ homework assignment(整班)
 *   覆盖:#A questions 题面与防作弊;#B 批改名单(solution + 公式填空 = 2 道复核题)
 * - 机构B:教师 + 学生(跨租户 404 用例,宪法 §7)
 */
import { hashPassword } from '../../src/auth/password.util';
import { raw } from './setup';

export const C1_PASSWORD = 'C1gap@Pass123';

/** q4(solution)的 rubric:3+4+3 = 10 分 */
export const C1_RUBRIC = [
  { step: 1, desc: '设解析式并代入两点', score: 3 },
  { step: 2, desc: '解出待定系数', score: 4 },
  { step: 3, desc: '还原平移并写出结论', score: 3 },
];

export interface C1Fixture {
  orgId: bigint;
  teacherId: bigint;
  s1Id: bigint;
  s2Id: bigint;
  teacherPhone: string;
  courseId: bigint;
  node1Id: bigint;
  /** [q1 single, q2 multi, q3 blank简单, q4 solution, q5 blank公式] */
  questionIds: bigint[];
  paperId: bigint;
  assignmentId: number;
  /** 机构B(跨租户) */
  orgBId: bigint;
  teacherBPhone: string;
  studentBId: bigint;
}

export async function createC1Org(): Promise<C1Fixture> {
  const hash = await hashPassword(C1_PASSWORD);
  const settings = {
    ai: { qaGuideOnly: true, preGrading: true },
    studentHours: { start: '06:00', end: '22:30' },
    deviceBinding: true,
  };
  const org = await raw.org.create({ data: { name: 'C1GAP作答批改测试机构', settings } });
  const orgId = org.id;
  const [_admin, teacher, s1, s2] = await Promise.all([
    raw.user.create({ data: { orgId, role: 'admin', name: 'C1管理员', phone: '13901000001', passwordHash: hash } }),
    raw.user.create({ data: { orgId, role: 'teacher', name: 'C1教师', phone: '13901000002', passwordHash: hash } }),
    raw.user.create({ data: { orgId, role: 'student', name: 'C1学生一', phone: '13901000011', studentNo: 'C1-S001' } }),
    raw.user.create({ data: { orgId, role: 'student', name: 'C1学生二', phone: '13901000012', studentNo: 'C1-S002' } }),
  ]);

  const course = await raw.course.create({
    data: {
      orgId, name: 'C1 · 初二数学作答班', classType: 'group', subject: '数学',
      stage: '初中', teacherId: teacher.id, totalLessons: 3, status: 'ongoing',
    },
  });
  await raw.courseStudent.createMany({
    data: [s1.id, s2.id].map((sid) => ({ orgId, courseId: course.id, studentId: sid })),
  });

  const graph = await raw.kpGraph.create({
    data: { orgId, code: 'c1_test_graph', graphType: 'curriculum_knowledge', subject: '数学' },
  });
  const node1 = await raw.kpNode.create({
    data: { orgId, graphId: graph.id, code: 'C1-N1', name: 'C1·一次函数解析式' },
  });

  // ---- 5 题:single / multi / blank简单 / solution / blank公式 ----
  const q1 = await raw.question.create({
    data: {
      orgId, ownerId: teacher.id, type: 'single', stage: '初中', subject: '数学',
      stemLatex: 'C1-Q1 将 $y=2x+1$ 向下平移 2 个单位后的解析式为(  )',
      answer: { choice: 'B' }, analysisLatex: '平移口诀:上加下减。',
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
      stemLatex: 'C1-Q2 下列说法正确的是(多选)(  )',
      answer: { choices: ['A', 'C'] }, analysisLatex: 'A、C 正确;B 混淆了 k 与 b。',
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
      stemLatex: 'C1-Q3 经过 $(0,1)$ 且 $k=2$ 的一次函数解析式为 ________。',
      answer: { texts: ['y=2x+1'] }, analysisLatex: '代入 $k=2$、$b=1$。',
      difficulty: 1, status: 'published',
    },
  });
  const q4 = await raw.question.create({
    data: {
      orgId, ownerId: teacher.id, type: 'solution', stage: '初中', subject: '数学',
      stemLatex: 'C1-Q4 求原直线的解析式(写出完整过程)。',
      answer: { referenceLatex: '$y=2x+3$' }, rubric: C1_RUBRIC,
      analysisLatex: '设式代入,解出系数后注意还原方向。',
      difficulty: 3, status: 'published',
    },
  });
  // q5:公式填空(参考答案含 LaTeX \frac)→ 走 AI 预批 + 教师复核
  const q5 = await raw.question.create({
    data: {
      orgId, ownerId: teacher.id, type: 'blank', stage: '初中', subject: '数学',
      stemLatex: 'C1-Q5 计算 $\\int_0^1 x\\,dx = $ ________。',
      answer: { texts: ['\\frac{1}{2}'] }, analysisLatex: '原函数 $\\frac{x^2}{2}$ 代入上下限。',
      difficulty: 3, status: 'published',
    },
  });
  await raw.questionTag.createMany({
    data: [q1, q2, q3, q4, q5].map((q) => ({ orgId, questionId: q.id, nodeId: node1.id })),
  });

  const paper = await raw.paper.create({
    data: { orgId, creatorId: teacher.id, name: 'C1 · 第1讲课后作业', type: 'homework', totalScore: 30, status: 'published' },
  });
  await raw.paperQuestion.createMany({
    data: [q1, q2, q3, q4, q5].map((q, i) => ({
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
  const orgB = await raw.org.create({ data: { name: 'C1跨租户机构B', settings } });
  const [teacherB, studentB] = await Promise.all([
    raw.user.create({ data: { orgId: orgB.id, role: 'teacher', name: 'C1教师B', phone: '13901000021', passwordHash: hash } }),
    raw.user.create({ data: { orgId: orgB.id, role: 'student', name: 'C1学生B', phone: '13901000022', studentNo: 'C1-B001' } }),
  ]);

  return {
    orgId,
    teacherId: teacher.id,
    s1Id: s1.id,
    s2Id: s2.id,
    teacherPhone: teacher.phone!,
    courseId: course.id,
    node1Id: node1.id,
    questionIds: [q1.id, q2.id, q3.id, q4.id, q5.id],
    paperId: paper.id,
    assignmentId: Number(assignment.id),
    orgBId: orgB.id,
    teacherBPhone: teacherB.phone!,
    studentBId: studentB.id,
  };
}

export async function dropC1Org(orgId: bigint, orgBId: bigint): Promise<void> {
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
