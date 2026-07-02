/**
 * IMPL-back 测试夹具(自建自清,手机号 1399 开头,专属 qiming_impl 库):
 * - 机构:admin / 教师 / 学生 s1(选课)
 * - 小型教材图谱(curriculum_knowledge)+ 节点 N1(录题打标 / 掌握度对账用)
 * - 三道填空题:
 *   · qNum    简单填空(参考答案纯数字)→ 即时判分
 *   · qFormula 公式填空(参考答案含 LaTeX `\frac`)→ AI 预批 + 教师复核
 *   · qMixed  混合填空(一空数字一空 `\sqrt`)→ 整题走复核
 * - 作业卷 P(15 分:5+5+5)+ homework assignment(整班 courseId)
 * Task 1(figures anchor)的题目在用例内经 POST /questions 现场创建。
 */
import { raw } from './setup';

export const IMPL_PASSWORD = 'Impl@Pass123';

export interface ImplFixture {
  orgId: bigint;
  teacherId: bigint;
  teacherPhone: string;
  s1Id: bigint;
  courseId: bigint;
  node1Id: bigint;
  /** [qNum, qFormula, qMixed] */
  questionIds: bigint[];
  paperId: bigint;
  assignmentId: number;
}

export async function createImplOrg(): Promise<ImplFixture> {
  const { hashPassword } = await import('../../src/auth/password.util');
  const hash = await hashPassword(IMPL_PASSWORD);
  const org = await raw.org.create({
    data: {
      name: 'IMPL-back 填空判分测试机构',
      settings: {
        ai: { qaGuideOnly: true, preGrading: true },
        studentHours: { start: '06:00', end: '22:30' },
        deviceBinding: true,
      },
    },
  });
  const orgId = org.id;
  const [_admin, teacher, s1] = await Promise.all([
    raw.user.create({ data: { orgId, role: 'admin', name: 'IMPL管理员', phone: '13990000001', passwordHash: hash } }),
    raw.user.create({ data: { orgId, role: 'teacher', name: 'IMPL教师', phone: '13990000002', passwordHash: hash } }),
    raw.user.create({ data: { orgId, role: 'student', name: 'IMPL学生一', phone: '13990000011', studentNo: 'IMPL-S001' } }),
  ]);

  const course = await raw.course.create({
    data: {
      orgId, name: 'IMPL · 初二数学班', classType: 'group', subject: '数学',
      stage: '初中', teacherId: teacher.id, totalLessons: 3, status: 'ongoing',
    },
  });
  await raw.courseStudent.create({ data: { orgId, courseId: course.id, studentId: s1.id } });

  const graph = await raw.kpGraph.create({
    data: { orgId, code: 'impl_test_graph', graphType: 'curriculum_knowledge', subject: '数学' },
  });
  const node1 = await raw.kpNode.create({
    data: { orgId, graphId: graph.id, code: 'IMPL-N1', name: 'IMPL·一次函数与根式' },
  });

  // ---- 三道填空题 ----
  const qNum = await raw.question.create({
    data: {
      orgId, ownerId: teacher.id, type: 'blank', stage: '初中', subject: '数学',
      stemLatex: 'IMPL-Q1 $3\\times4=$ ____(简单填空,纯数字)。',
      answer: { texts: ['12'] },
      analysisLatex: '直接计算。',
      difficulty: 1, status: 'published',
    },
  });
  const qFormula = await raw.question.create({
    data: {
      orgId, ownerId: teacher.id, type: 'blank', stage: '初中', subject: '数学',
      stemLatex: 'IMPL-Q2 化简 $\\frac{2}{4}=$ ____(公式填空)。',
      answer: { texts: ['\\frac{1}{2}'] },
      analysisLatex: '约分。',
      difficulty: 2, status: 'published',
    },
  });
  const qMixed = await raw.question.create({
    data: {
      orgId, ownerId: teacher.id, type: 'blank', stage: '初中', subject: '数学',
      stemLatex: 'IMPL-Q3 $\\sqrt{4}=$ ____,$\\sqrt{2}=$ ____(混合:一空数字一空公式)。',
      answer: { texts: ['2', '\\sqrt{2}'] },
      analysisLatex: '前者可化简,后者保留根式。',
      difficulty: 2, status: 'published',
    },
  });
  await raw.questionTag.createMany({
    data: [qNum, qFormula, qMixed].map((q) => ({ orgId, questionId: q.id, nodeId: node1.id })),
  });

  // ---- 作业卷 + homework assignment(整班)----
  const paper = await raw.paper.create({
    data: { orgId, creatorId: teacher.id, name: 'IMPL · 填空作业', type: 'homework', totalScore: 15, status: 'published' },
  });
  await raw.paperQuestion.createMany({
    data: [qNum, qFormula, qMixed].map((q, i) => ({
      orgId, paperId: paper.id, questionId: q.id, seq: i + 1, score: 5,
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

  return {
    orgId,
    teacherId: teacher.id,
    teacherPhone: teacher.phone!,
    s1Id: s1.id,
    courseId: course.id,
    node1Id: node1.id,
    questionIds: [qNum.id, qFormula.id, qMixed.id],
    paperId: paper.id,
    assignmentId: Number(assignment.id),
  };
}

export async function dropImplOrg(orgId: bigint): Promise<void> {
  await raw.masterySnapshot.deleteMany({ where: { orgId } });
  await raw.wrongBookEntry.deleteMany({ where: { orgId } });
  await raw.gradingRecord.deleteMany({ where: { orgId } });
  await raw.answer.deleteMany({ where: { orgId } });
  await raw.attempt.deleteMany({ where: { orgId } });
  await raw.assignment.deleteMany({ where: { orgId } });
  await raw.paperQuestion.deleteMany({ where: { orgId } });
  await raw.paper.deleteMany({ where: { orgId } });
  await raw.questionTag.deleteMany({ where: { orgId } });
  await raw.questionOption.deleteMany({ where: { orgId } });
  await raw.question.deleteMany({ where: { orgId } });
  await raw.kpEdge.deleteMany({ where: { orgId } });
  await raw.kpNode.deleteMany({ where: { orgId } });
  await raw.kpGraph.deleteMany({ where: { orgId } });
  await raw.courseStudent.deleteMany({ where: { orgId } });
  await raw.course.deleteMany({ where: { orgId } });
  await raw.device.deleteMany({ where: { orgId } });
  await raw.loginTicket.deleteMany({ where: { orgId } });
  await raw.auditLog.deleteMany({ where: { orgId } });
  await raw.user.deleteMany({ where: { orgId } });
  await raw.org.deleteMany({ where: { id: orgId } });
}
