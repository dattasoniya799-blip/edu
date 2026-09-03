/**
 * 2026-09-02 全面走查修复(task/walk-server)专用夹具:独立机构 + 13904 号段 + WALK-S 学号段,afterAll 全量清理。
 * - 管理员 / 教师 / 2 名在册学生;课程 1 门(含 1 讲,讲次有 lesson 锚点供订正作业挂载)
 * - 小图谱 1 节点「WALK·一次函数」→ 单选题标注(错题本错因回退用)
 * - 课后作业 1 份:single(B) 5 分 + blank("2") 5 分 + solution 10 分(含需复核题 → 客观题交卷即入账的场景)
 */
import { hashPassword } from '../../src/auth/password.util';
import { raw } from './setup';

export const WALK_PASSWORD = 'Walk@Pass123';

export interface WalkFixture {
  orgId: bigint;
  adminPhone: string;
  teacherId: bigint;
  teacherPhone: string;
  s1Id: bigint;
  s1No: string;
  s2Id: bigint;
  s2No: string;
  courseId: bigint;
  lessonId: bigint;
  kpNodeName: string;
  qSingleId: bigint;
  qBlankId: bigint;
  qSolId: bigint;
  paperId: bigint;
  assignmentId: number;
}

export async function createWalkOrg(): Promise<WalkFixture> {
  // 上一轮被中断(kill)时 afterAll 没跑到,会留下同名机构;同号手机会让登录落到旧机构 → 全套 404。先清干净。
  for (const stale of await raw.org.findMany({ where: { name: 'WALK 走查机构' }, select: { id: true } })) await dropWalkOrg(stale.id);
  const hash = await hashPassword(WALK_PASSWORD);
  const org = await raw.org.create({
    data: {
      name: 'WALK 走查机构', status: 'active',
      settings: { ai: { qaGuideOnly: true, preGrading: true, classCompanion: false, diagnosis: false }, studentHours: { start: '00:00', end: '23:59' } },
    },
  });
  const orgId = org.id;
  const [, teacher, s1, s2] = await Promise.all([
    raw.user.create({ data: { orgId, role: 'admin', name: 'WALK管理员', phone: '13904000003', passwordHash: hash } }),
    raw.user.create({ data: { orgId, role: 'teacher', name: 'WALK教师', phone: '13904000001', passwordHash: hash, teacherNo: 'WALK-T001' } }),
    raw.user.create({ data: { orgId, role: 'student', name: 'WALK学生一', phone: '13904000011', studentNo: 'WALK-S001', passwordHash: hash } }),
    raw.user.create({ data: { orgId, role: 'student', name: 'WALK学生二', phone: '13904000012', studentNo: 'WALK-S002', passwordHash: hash } }),
  ]);
  const course = await raw.course.create({
    data: { orgId, name: 'WALK 数学班', classType: 'group', subject: '数学', stage: '初中', teacherId: teacher.id, totalLessons: 1, status: 'ongoing' },
  });
  await raw.courseStudent.createMany({ data: [s1.id, s2.id].map((sid) => ({ orgId, courseId: course.id, studentId: sid })) });
  const lesson = await raw.lesson.create({ data: { orgId, courseId: course.id, seq: 1, title: 'WALK 第1讲', status: 'finished' } });

  const graph = await raw.kpGraph.create({ data: { orgId, code: 'walk_graph', graphType: 'curriculum_knowledge', subject: '数学' } });
  const node = await raw.kpNode.create({ data: { orgId, graphId: graph.id, code: 'WALK-N1', name: 'WALK·一次函数' } });

  const qSingle = await raw.question.create({
    data: {
      orgId, ownerId: teacher.id, type: 'single', stage: '初中', subject: '数学',
      stemLatex: 'WALK-Q1 选正确项。', answer: { choice: 'B' }, analysisLatex: '见解析。', difficulty: 1, status: 'published',
    },
  });
  await raw.questionOption.createMany({
    data: ['A', 'B', 'C', 'D'].map((l, i) => ({ orgId, questionId: qSingle.id, label: l, contentLatex: `选项${l}`, isCorrect: i === 1 })),
  });
  await raw.questionTag.create({ data: { orgId, questionId: qSingle.id, nodeId: node.id } });
  const qBlank = await raw.question.create({
    data: {
      orgId, ownerId: teacher.id, type: 'blank', stage: '初中', subject: '数学',
      stemLatex: 'WALK-Q2 填空:____。', answer: { texts: ['2'] }, analysisLatex: '答案 2。', difficulty: 1, status: 'published',
    },
  });
  const qSol = await raw.question.create({
    data: {
      orgId, ownerId: teacher.id, type: 'solution', stage: '初中', subject: '数学',
      stemLatex: 'WALK-Q3 写出过程。', answer: { referenceLatex: '$x=1$' },
      rubric: [{ step: 1, desc: '列式', score: 5 }, { step: 2, desc: '求解', score: 5 }],
      analysisLatex: '列式求解。', difficulty: 2, status: 'published',
    },
  });
  const paper = await raw.paper.create({
    data: { orgId, creatorId: teacher.id, name: 'WALK 课后作业', type: 'homework', totalScore: 20, status: 'published' },
  });
  await raw.paperQuestion.createMany({
    data: [
      { orgId, paperId: paper.id, questionId: qSingle.id, seq: 1, score: 5 },
      { orgId, paperId: paper.id, questionId: qBlank.id, seq: 2, score: 5 },
      { orgId, paperId: paper.id, questionId: qSol.id, seq: 3, score: 10 },
    ],
  });
  const assignment = await raw.assignment.create({
    data: {
      orgId, paperId: paper.id, lessonId: lesson.id, teacherId: teacher.id, kind: 'homework',
      target: { courseId: Number(course.id) }, publishAt: new Date(), scoreCounted: true,
    },
  });
  return {
    orgId, adminPhone: '13904000003', teacherId: teacher.id, teacherPhone: '13904000001',
    s1Id: s1.id, s1No: 'WALK-S001', s2Id: s2.id, s2No: 'WALK-S002',
    courseId: course.id, lessonId: lesson.id, kpNodeName: node.name,
    qSingleId: qSingle.id, qBlankId: qBlank.id, qSolId: qSol.id, paperId: paper.id, assignmentId: Number(assignment.id),
  };
}

export async function dropWalkOrg(orgId: bigint): Promise<void> {
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
  await raw.kpNode.deleteMany({ where: { orgId } });
  await raw.kpGraph.deleteMany({ where: { orgId } });
  await raw.lessonSegment.deleteMany({ where: { orgId } });
  await raw.sessionEvent.deleteMany({ where: { orgId } });
  await raw.sessionParticipant.deleteMany({ where: { orgId } });
  await raw.classSession.deleteMany({ where: { orgId } });
  await raw.lesson.deleteMany({ where: { orgId } });
  await raw.courseStudent.deleteMany({ where: { orgId } });
  await raw.course.deleteMany({ where: { orgId } });
  await raw.resource.deleteMany({ where: { orgId } });
  await raw.auditLog.deleteMany({ where: { orgId } });
  await raw.user.deleteMany({ where: { orgId } });
  await raw.org.deleteMany({ where: { id: orgId } });
}
