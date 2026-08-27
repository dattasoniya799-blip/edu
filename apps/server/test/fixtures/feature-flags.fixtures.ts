/**
 * E1 · 内测区与功能分级 e2e 夹具(自建自清,手机号 139610 段 / studentNo 前缀 FF-):
 * - 机构:admin / 教师 t1(白名单候选)/ 教师 t2(白名单外)/ 学生 s1(预批白名单候选)/ 学生 s2(白名单外)
 * - 错题重做用:3 题(single 客观 / solution 主观 / blank 公式填空)+ 来源卷 + graded attempt:
 *   · s1 错题 3 条(客观 + 主观 + 公式)→ redo-all 组卷应只含客观题
 *   · s2 错题仅 solution 1 条 → redo / redo-all 全被过滤 → 4503
 * - 预批 gate 用:两题卷(公式填空 + solution)+ 整班 homework(s1/s2 各自开 attempt 作答)
 * 刻意不在夹具里落任何 feature_flags / feature_access 行 —— 阶段与白名单由各用例
 * 经 admin API 自行设置(顺带覆盖管理端点;replace 语义保证可复位)。
 */
import { hashPassword } from '../../src/auth/password.util';
import { raw } from './setup';

export const FF_PASSWORD = 'Ff@Pass123';

export interface FfFixture {
  orgId: bigint;
  adminPhone: string;
  t1Id: bigint;
  t1Phone: string;
  t2Id: bigint;
  t2Phone: string;
  s1Id: bigint;
  s2Id: bigint;
  courseId: bigint;
  qSingleId: bigint;
  qSolutionId: bigint;
  qFormulaId: bigint;
  /** s2 的 solution 错题条目(单题 redo → 4503 用) */
  s2SolutionEntryId: number;
  /** 预批 gate 用的作业(卷面 = 公式填空 + solution) */
  preAssignmentId: number;
}

export async function createFfOrg(): Promise<FfFixture> {
  const hash = await hashPassword(FF_PASSWORD);
  const org = await raw.org.create({
    data: {
      name: 'FF · 内测功能分级测试机构',
      settings: {
        ai: { qaGuideOnly: true, preGrading: true },
        studentHours: { start: '00:00', end: '23:59' },
        deviceBinding: true,
      },
    },
  });
  const orgId = org.id;
  // 顺序建号(不并发):保证 id 递增 admin < t1 < t2 < s1 < s2,
  // 白名单接口按 userId 升序下发,用例可对名单顺序做确定性断言
  const admin = await raw.user.create({ data: { orgId, role: 'admin', name: 'FF管理员', phone: '13961000001', passwordHash: hash } });
  const t1 = await raw.user.create({ data: { orgId, role: 'teacher', name: 'FF教师一', phone: '13961000002', passwordHash: hash } });
  const t2 = await raw.user.create({ data: { orgId, role: 'teacher', name: 'FF教师二', phone: '13961000003', passwordHash: hash } });
  const s1 = await raw.user.create({ data: { orgId, role: 'student', name: 'FF学生一', phone: '13961000011', studentNo: 'FF-S001' } });
  const s2 = await raw.user.create({ data: { orgId, role: 'student', name: 'FF学生二', phone: '13961000012', studentNo: 'FF-S002' } });

  const course = await raw.course.create({
    data: {
      orgId, name: 'FF · 初二数学班', classType: 'group', subject: '数学',
      stage: '初中', teacherId: t1.id, totalLessons: 2, status: 'ongoing',
    },
  });
  await raw.courseStudent.createMany({
    data: [s1.id, s2.id].map((sid) => ({ orgId, courseId: course.id, studentId: sid })),
  });

  // ---- 3 题:客观 / 主观 / 公式填空 ----
  const qSingle = await raw.question.create({
    data: {
      orgId, ownerId: t1.id, type: 'single', stage: '初中', subject: '数学',
      stemLatex: 'FF-Q1 $1+1=$(  )', answer: { choice: 'B' },
      analysisLatex: '直接计算。', difficulty: 1, status: 'published',
    },
  });
  await raw.questionOption.createMany({
    data: [
      { orgId, questionId: qSingle.id, label: 'A', contentLatex: '$1$', isCorrect: false },
      { orgId, questionId: qSingle.id, label: 'B', contentLatex: '$2$', isCorrect: true },
    ],
  });
  const qSolution = await raw.question.create({
    data: {
      orgId, ownerId: t1.id, type: 'solution', stage: '初中', subject: '数学',
      stemLatex: 'FF-Q2 解方程 $2x+3=7$(写完整过程)。', answer: { referenceLatex: 'x=2' },
      rubric: [{ step: 1, desc: '移项求解', score: 10 }],
      analysisLatex: '移项得 $2x=4$。', difficulty: 2, status: 'published',
    },
  });
  const qFormula = await raw.question.create({
    data: {
      orgId, ownerId: t1.id, type: 'blank', stage: '初中', subject: '数学',
      stemLatex: 'FF-Q3 化简 $\\frac{2}{4}=$ ____(公式填空)。', answer: { texts: ['\\frac{1}{2}'] },
      analysisLatex: '约分。', difficulty: 2, status: 'published',
    },
  });

  // ---- 错题来源卷(3 题)+ graded attempt + 错题条目 ----
  const srcPaper = await raw.paper.create({
    data: { orgId, creatorId: t1.id, name: 'FF · 错题来源卷', type: 'homework', totalScore: 20, status: 'published' },
  });
  await raw.paperQuestion.createMany({
    data: [
      { orgId, paperId: srcPaper.id, questionId: qSingle.id, seq: 1, score: 5 },
      { orgId, paperId: srcPaper.id, questionId: qSolution.id, seq: 2, score: 10 },
      { orgId, paperId: srcPaper.id, questionId: qFormula.id, seq: 3, score: 5 },
    ],
  });
  const srcAssignment = await raw.assignment.create({
    data: {
      orgId, paperId: srcPaper.id, teacherId: t1.id, kind: 'homework',
      target: { courseId: Number(course.id) }, scoreCounted: true,
    },
  });

  // s1:三题全错 → 错题 3 条(客观 + 主观 + 公式)
  const at1 = await raw.attempt.create({
    data: {
      orgId, assignmentId: srcAssignment.id, studentId: s1.id, attemptNo: 1,
      status: 'graded', submittedAt: new Date(), score: 2, objectiveScore: 0, subjectiveScore: 2,
    },
  });
  const [a1Single, a1Solution, a1Formula] = await Promise.all([
    raw.answer.create({ data: { orgId, attemptId: at1.id, questionId: qSingle.id, response: { choice: 'A' }, isCorrect: false, score: 0 } }),
    raw.answer.create({ data: { orgId, attemptId: at1.id, questionId: qSolution.id, response: { text: 'x=1' }, isCorrect: null, score: 2 } }),
    raw.answer.create({ data: { orgId, attemptId: at1.id, questionId: qFormula.id, response: { texts: ['1'] }, isCorrect: false, score: 0 } }),
  ]);
  await raw.wrongBookEntry.createMany({
    data: [
      { orgId, studentId: s1.id, questionId: qSingle.id, sourceAnswerId: a1Single.id, wrongCount: 1, status: 'open' },
      { orgId, studentId: s1.id, questionId: qSolution.id, sourceAnswerId: a1Solution.id, wrongCount: 1, status: 'open' },
      { orgId, studentId: s1.id, questionId: qFormula.id, sourceAnswerId: a1Formula.id, wrongCount: 1, status: 'open' },
    ],
  });

  // s2:仅 solution 错 → 错题 1 条(重做全被过滤 → 4503)
  const at2 = await raw.attempt.create({
    data: {
      orgId, assignmentId: srcAssignment.id, studentId: s2.id, attemptNo: 1,
      status: 'graded', submittedAt: new Date(), score: 3, objectiveScore: 0, subjectiveScore: 3,
    },
  });
  const a2Solution = await raw.answer.create({
    data: { orgId, attemptId: at2.id, questionId: qSolution.id, response: { text: 'x=3' }, isCorrect: null, score: 3 },
  });
  const s2Entry = await raw.wrongBookEntry.create({
    data: { orgId, studentId: s2.id, questionId: qSolution.id, sourceAnswerId: a2Solution.id, wrongCount: 1, status: 'open' },
  });

  // ---- 预批 gate 用:两题卷(公式填空 + solution)+ 整班 homework ----
  const prePaper = await raw.paper.create({
    data: { orgId, creatorId: t1.id, name: 'FF · 预批门禁卷', type: 'homework', totalScore: 15, status: 'published' },
  });
  await raw.paperQuestion.createMany({
    data: [
      { orgId, paperId: prePaper.id, questionId: qFormula.id, seq: 1, score: 5 },
      { orgId, paperId: prePaper.id, questionId: qSolution.id, seq: 2, score: 10 },
    ],
  });
  const preAssignment = await raw.assignment.create({
    data: {
      orgId, paperId: prePaper.id, teacherId: t1.id, kind: 'homework',
      target: { courseId: Number(course.id) }, scoreCounted: true,
    },
  });

  void admin;
  return {
    orgId,
    adminPhone: '13961000001',
    t1Id: t1.id, t1Phone: '13961000002',
    t2Id: t2.id, t2Phone: '13961000003',
    s1Id: s1.id, s2Id: s2.id,
    courseId: course.id,
    qSingleId: qSingle.id, qSolutionId: qSolution.id, qFormulaId: qFormula.id,
    s2SolutionEntryId: Number(s2Entry.id),
    preAssignmentId: Number(preAssignment.id),
  };
}

export async function dropFfOrg(orgId: bigint): Promise<void> {
  await raw.featureAccess.deleteMany({ where: { orgId } });
  await raw.featureFlag.deleteMany({ where: { orgId } });
  await raw.aiCall.deleteMany({ where: { orgId } });
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
