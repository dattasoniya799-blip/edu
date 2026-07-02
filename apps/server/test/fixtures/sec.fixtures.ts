/**
 * sec-back 安全修复夹具(自建自清,手机号 1390300 段,与既有夹具不撞):
 * 单机构 orgA,内含两名教师:
 *  - teacherA 拥有 courseA(s1、s2 选课)与 lessonA;
 *  - teacherB2 同机构、拥有 courseB2,但不授 courseA —— 用于「同机构他班」越权用例(#4)。
 * 物料:
 *  - paperA1(纯客观:1 道 single)→ assignmentA1(整班 courseA),供并发交卷只结算一次(#5);
 *  - paperA2(single + solution)→ assignmentA2(整班 courseA),供并发 finalize 只结算一次(#5)、
 *    跨教师批改越权(#4)、photoOssKey 归属(#6)。
 */
import { hashPassword } from '../../src/auth/password.util';
import { raw } from './setup';

export const SEC_PASSWORD = 'Sec@Pass123';

export interface SecFixture {
  orgId: bigint;
  teacherAId: bigint;
  teacherAPhone: string;
  teacherB2Id: bigint;
  teacherB2Phone: string;
  s1Id: bigint;
  s2Id: bigint;
  courseAId: bigint;
  courseB2Id: bigint;
  lessonAId: number;
  /** A1:纯客观 single(answer B) */
  qSingleA1Id: bigint;
  /** A2:single(answer B) + solution */
  qSingleA2Id: bigint;
  qSolA2Id: bigint;
  assignmentA1Id: number;
  assignmentA2Id: number;
}

export async function createSecOrg(): Promise<SecFixture> {
  const hash = await hashPassword(SEC_PASSWORD);
  const org = await raw.org.create({
    data: {
      name: 'sec-back 安全修复测试机构',
      settings: {
        ai: { qaGuideOnly: true, preGrading: true },
        studentHours: { start: '06:00', end: '22:30' },
        deviceBinding: true,
      },
    },
  });
  const orgId = org.id;
  const [, teacherA, teacherB2, s1, s2] = await Promise.all([
    raw.user.create({ data: { orgId, role: 'admin', name: 'SEC管理员', phone: '13903000003', passwordHash: hash } }),
    raw.user.create({ data: { orgId, role: 'teacher', name: 'SEC教师A', phone: '13903000001', passwordHash: hash } }),
    raw.user.create({ data: { orgId, role: 'teacher', name: 'SEC教师B2', phone: '13903000002', passwordHash: hash } }),
    raw.user.create({ data: { orgId, role: 'student', name: 'SEC学生一', phone: '13903000011', studentNo: 'SEC-S001' } }),
    raw.user.create({ data: { orgId, role: 'student', name: 'SEC学生二', phone: '13903000012', studentNo: 'SEC-S002' } }),
  ]);

  const courseA = await raw.course.create({
    data: {
      orgId, name: 'SEC · A班', classType: 'group', subject: '数学', stage: '初中',
      teacherId: teacherA.id, totalLessons: 3, status: 'ongoing',
    },
  });
  const courseB2 = await raw.course.create({
    data: {
      orgId, name: 'SEC · B2班', classType: 'group', subject: '数学', stage: '初中',
      teacherId: teacherB2.id, totalLessons: 3, status: 'ongoing',
    },
  });
  await raw.courseStudent.createMany({
    data: [s1.id, s2.id].map((sid) => ({ orgId, courseId: courseA.id, studentId: sid })),
  });
  const lessonA = await raw.lesson.create({
    data: { orgId, courseId: courseA.id, seq: 1, title: 'SEC 第1讲', status: 'draft' },
  });

  // ---- 题目 ----
  const mkSingle = async (label: string) => {
    const q = await raw.question.create({
      data: {
        orgId, ownerId: teacherA.id, type: 'single', stage: '初中', subject: '数学',
        stemLatex: `SEC-${label} 选择正确选项。`, answer: { choice: 'B' },
        analysisLatex: '见解析。', difficulty: 1, status: 'published',
      },
    });
    await raw.questionOption.createMany({
      data: ['A', 'B', 'C', 'D'].map((l, i) => ({
        orgId, questionId: q.id, label: l, contentLatex: `选项${l}`, isCorrect: i === 1,
      })),
    });
    return q;
  };
  const qSingleA1 = await mkSingle('Q1');
  const qSingleA2 = await mkSingle('Q2');
  const qSolA2 = await raw.question.create({
    data: {
      orgId, ownerId: teacherA.id, type: 'solution', stage: '初中', subject: '数学',
      stemLatex: 'SEC-Q3 写出完整过程。', answer: { referenceLatex: '$x=1$' },
      rubric: [{ step: 1, desc: '列式', score: 5 }, { step: 2, desc: '求解', score: 5 }],
      analysisLatex: '列式求解。', difficulty: 2, status: 'published',
    },
  });

  // ---- 卷 + 作业 ----
  const paperA1 = await raw.paper.create({
    data: { orgId, creatorId: teacherA.id, name: 'SEC · 纯客观卷', type: 'homework', totalScore: 10, status: 'published' },
  });
  await raw.paperQuestion.create({
    data: { orgId, paperId: paperA1.id, questionId: qSingleA1.id, seq: 1, score: 10 },
  });
  const assignmentA1 = await raw.assignment.create({
    data: {
      orgId, paperId: paperA1.id, teacherId: teacherA.id, kind: 'homework', target: { courseId: Number(courseA.id) },
      dueAt: new Date(Date.now() + 7 * 86400_000),
      gradingPolicy: { objective: 'instant' }, scoreCounted: true,
    },
  });

  const paperA2 = await raw.paper.create({
    data: { orgId, creatorId: teacherA.id, name: 'SEC · 主客观卷', type: 'homework', totalScore: 20, status: 'published' },
  });
  await raw.paperQuestion.createMany({
    data: [
      { orgId, paperId: paperA2.id, questionId: qSingleA2.id, seq: 1, score: 10 },
      { orgId, paperId: paperA2.id, questionId: qSolA2.id, seq: 2, score: 10 },
    ],
  });
  const assignmentA2 = await raw.assignment.create({
    data: {
      orgId, paperId: paperA2.id, teacherId: teacherA.id, kind: 'homework', target: { courseId: Number(courseA.id) },
      dueAt: new Date(Date.now() + 7 * 86400_000),
      gradingPolicy: { objective: 'instant', subjective: 'ai_pre_review' }, scoreCounted: true,
    },
  });

  return {
    orgId,
    teacherAId: teacherA.id, teacherAPhone: teacherA.phone!,
    teacherB2Id: teacherB2.id, teacherB2Phone: teacherB2.phone!,
    s1Id: s1.id, s2Id: s2.id,
    courseAId: courseA.id, courseB2Id: courseB2.id,
    lessonAId: Number(lessonA.id),
    qSingleA1Id: qSingleA1.id,
    qSingleA2Id: qSingleA2.id, qSolA2Id: qSolA2.id,
    assignmentA1Id: Number(assignmentA1.id),
    assignmentA2Id: Number(assignmentA2.id),
  };
}

export async function dropSecOrg(orgId: bigint): Promise<void> {
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
  await raw.classSession.deleteMany({ where: { orgId } }); // publish 建的课堂会话
  await raw.lesson.deleteMany({ where: { orgId } });
  await raw.courseStudent.deleteMany({ where: { orgId } });
  await raw.course.deleteMany({ where: { orgId } });
  await raw.auditLog.deleteMany({ where: { orgId } });
  await raw.user.deleteMany({ where: { orgId } });
  await raw.org.deleteMany({ where: { id: orgId } });
}
