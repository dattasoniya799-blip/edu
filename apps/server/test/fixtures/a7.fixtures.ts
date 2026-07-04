/**
 * A7 测试夹具(自建自清,不触碰 seed 数据,手机号 1396 开头):
 * - 机构A:admin / 教师 / 学生×2(s1 常规用例,s2 专用限流用例)+ 选课
 *   + 1 道公式填空题(参考答案含 LaTeX,rubric 3+4+3=10)+ 作业卷(10 分)+ homework assignment(整班)
 * - 机构B:学生(跨租户 404 用例,宪法 §7)
 */
import { hashPassword } from '../../src/auth/password.util';
import { raw } from './setup';

export const A7_PASSWORD = 'A7@Pass123';

/** 主观题 rubric:3+4+3 = 10 分(与 mock 预批规则配套:√{step} 标记) */
export const A7_RUBRIC = [
  { step: 1, desc: '设解析式并代入条件', score: 3 },
  { step: 2, desc: '解出待定系数', score: 4 },
  { step: 3, desc: '写出结论并检验', score: 3 },
];

export interface A7Fixture {
  orgId: bigint;
  adminPhone: string;
  teacherPhone: string;
  s1Id: bigint;
  s2Id: bigint;
  courseId: bigint;
  questionId: bigint;
  paperId: bigint;
  assignmentId: number;
  orgBId: bigint;
  studentBId: bigint;
}

export async function createA7Org(): Promise<A7Fixture> {
  const hash = await hashPassword(A7_PASSWORD);
  const org = await raw.org.create({
    data: {
      name: 'A7AI网关测试机构',
      settings: {
        ai: { qaGuideOnly: true, preGrading: true },
        studentHours: { start: '06:00', end: '22:30' },
        deviceBinding: true,
      },
    },
  });
  const orgId = org.id;
  const [admin, teacher, s1, s2] = await Promise.all([
    raw.user.create({ data: { orgId, role: 'admin', name: 'A7管理员', phone: '13960000001', passwordHash: hash } }),
    raw.user.create({ data: { orgId, role: 'teacher', name: 'A7教师', phone: '13960000002', passwordHash: hash } }),
    raw.user.create({ data: { orgId, role: 'student', name: 'A7学生一', phone: '13960000011', studentNo: 'A7-S001' } }),
    raw.user.create({ data: { orgId, role: 'student', name: 'A7学生二', phone: '13960000012', studentNo: 'A7-S002' } }),
  ]);

  const course = await raw.course.create({
    data: {
      orgId, name: 'A7 · 初二数学AI班', classType: 'group', subject: '数学', stage: '初中',
      teacherId: teacher.id, totalLessons: 3, status: 'ongoing',
    },
  });
  await raw.courseStudent.createMany({
    data: [s1.id, s2.id].map((sid) => ({ orgId, courseId: course.id, studentId: sid })),
  });

  // 公式填空题(参考答案含 LaTeX 控制符 → 走 AI 预批 + 教师复核管线,验证真实 BullMQ 预批链路)
  const question = await raw.question.create({
    data: {
      orgId, ownerId: teacher.id, type: 'blank', stage: '初中', subject: '数学',
      stemLatex: 'A7-Q1 已知一次函数过 $(0,3)$ 与 $(1,5)$,填出解析式(公式填空,写出完整过程)。',
      answer: { texts: ['y=2x+3\\,'] },
      rubric: A7_RUBRIC,
      analysisLatex: '设 $y=kx+b$,代入两点解出 $k=2,b=3$。',
      difficulty: 3, status: 'published',
    },
  });

  const paper = await raw.paper.create({
    data: { orgId, creatorId: teacher.id, name: 'A7 · AI预批作业', type: 'homework', totalScore: 10, status: 'published' },
  });
  await raw.paperQuestion.create({
    data: { orgId, paperId: paper.id, questionId: question.id, seq: 1, score: 10 },
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

  const orgB = await raw.org.create({
    data: {
      name: 'A7跨租户机构B',
      settings: { ai: { qaGuideOnly: true, preGrading: true }, studentHours: { start: '06:00', end: '22:30' }, deviceBinding: true },
    },
  });
  const studentB = await raw.user.create({
    data: { orgId: orgB.id, role: 'student', name: 'A7学生B', phone: '13960000021', studentNo: 'A7-B001' },
  });

  void admin;
  return {
    orgId,
    adminPhone: '13960000001',
    teacherPhone: '13960000002',
    s1Id: s1.id,
    s2Id: s2.id,
    courseId: course.id,
    questionId: question.id,
    paperId: paper.id,
    assignmentId: Number(assignment.id),
    orgBId: orgB.id,
    studentBId: studentB.id,
  };
}

export async function dropA7Org(orgId: bigint, orgBId: bigint): Promise<void> {
  for (const oid of [orgId, orgBId]) {
    await raw.aiCall.deleteMany({ where: { orgId: oid } });
    await raw.aiQuota.deleteMany({ where: { orgId: oid } });
    await raw.masterySnapshot.deleteMany({ where: { orgId: oid } });
    await raw.wrongBookEntry.deleteMany({ where: { orgId: oid } });
    await raw.gradingRecord.deleteMany({ where: { orgId: oid } });
    await raw.answer.deleteMany({ where: { orgId: oid } });
    await raw.attempt.deleteMany({ where: { orgId: oid } });
    await raw.assignment.deleteMany({ where: { orgId: oid } });
    await raw.paperQuestion.deleteMany({ where: { orgId: oid } });
    await raw.paper.deleteMany({ where: { orgId: oid } });
    await raw.question.deleteMany({ where: { orgId: oid } });
    await raw.courseStudent.deleteMany({ where: { orgId: oid } });
    await raw.course.deleteMany({ where: { orgId: oid } });
    await raw.device.deleteMany({ where: { orgId: oid } });
    await raw.loginTicket.deleteMany({ where: { orgId: oid } });
    await raw.auditLog.deleteMany({ where: { orgId: oid } });
    await raw.user.deleteMany({ where: { orgId: oid } });
    await raw.org.deleteMany({ where: { id: oid } });
  }
}
