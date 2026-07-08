/**
 * fix-flow-server 夹具(走查回归 S1/S3/S4/S5/S6,自建自清,手机号 13960 段 139601 起,不与既有夹具撞):
 * 单机构 1 教师 + 2 学生 + 1 课程(3 讲):
 *  - L1:排定起止时间已过、status='ready'(未跑过直播课)—— S5 校验"已结束讲次"应计入;
 *  - L2:status='finished';L3:未来 + draft —— currentLesson 期望=2(L1 时间已过 + L2 finished);
 *  - L1 挂 lecture 环节引用 courseware 资源(canonical ossKey `resource/${orgId}/…`)—— S6 授权正例;
 *  - qSingle(答案 B)+ qSol(solution):
 *      paperMixed(homework,5+10)→ asgMixed(挂 L2,整班)——S3:学生只答客观、跳过 solution 交卷;
 *      paperObj(homework,仅 qSingle)→ asgObj(整班)——S1:并发开始作答幂等;
 *      paperPractice(type='practice',仅 qSingle)——S4:practice 卷布置为 homework 作业。
 */
import { hashPassword } from '../../src/auth/password.util';
import { raw } from './setup';

export const FIXG_PASSWORD = 'Fixg@Pass123';

export interface FixgFixture {
  orgId: bigint;
  teacherId: bigint;
  teacherPhone: string;
  s1Id: bigint;
  s2Id: bigint;
  courseId: bigint;
  l1Id: bigint;
  l2Id: bigint;
  l3Id: bigint;
  qSingleId: bigint;
  qSolId: bigint;
  paperMixedId: number;
  paperObjId: number;
  paperPracticeId: number;
  asgMixedId: number;
  asgObjId: number;
  resourceId: number;
  resourceOssKey: string;
}

const DAY = 86400_000;
const HOUR = 3600_000;

export async function createFixgOrg(): Promise<FixgFixture> {
  const hash = await hashPassword(FIXG_PASSWORD);
  const org = await raw.org.create({
    data: {
      name: 'FIXG · 走查回归机构',
      settings: {
        ai: { qaGuideOnly: true, preGrading: true },
        studentHours: { start: '00:00', end: '23:59' },
        deviceBinding: true,
      },
    },
  });
  const orgId = org.id;
  const [teacher, s1, s2] = await Promise.all([
    raw.user.create({ data: { orgId, role: 'teacher', name: 'FIXG教师', phone: '13960100001', passwordHash: hash } }),
    raw.user.create({ data: { orgId, role: 'student', name: 'FIXG学生一', phone: '13960100011', studentNo: 'FIXG-S001' } }),
    raw.user.create({ data: { orgId, role: 'student', name: 'FIXG学生二', phone: '13960100012', studentNo: 'FIXG-S002' } }),
  ]);

  const course = await raw.course.create({
    data: {
      orgId, name: 'FIXG · 一次函数', classType: 'group', subject: '数学', stage: '初中',
      teacherId: teacher.id, totalLessons: 3, status: 'ongoing',
    },
  });
  await raw.courseStudent.createMany({
    data: [s1.id, s2.id].map((sid) => ({ orgId, courseId: course.id, studentId: sid })),
  });

  const now = Date.now();
  // L1:起止时间均已过,但 status='ready'(未开过直播课)—— S5 期望仍计为"已结束"
  const l1 = await raw.lesson.create({
    data: {
      orgId, courseId: course.id, seq: 1, title: 'FIXG 第1讲', status: 'ready',
      scheduledStart: new Date(now - 2 * DAY), scheduledEnd: new Date(now - 2 * DAY + 2 * HOUR),
    },
  });
  const l2 = await raw.lesson.create({
    data: {
      orgId, courseId: course.id, seq: 2, title: 'FIXG 第2讲', status: 'finished',
      scheduledStart: new Date(now - 1 * DAY), scheduledEnd: new Date(now - 1 * DAY + 2 * HOUR),
    },
  });
  const l3 = await raw.lesson.create({
    data: {
      orgId, courseId: course.id, seq: 3, title: 'FIXG 第3讲', status: 'draft',
      scheduledStart: new Date(now + 1 * DAY), scheduledEnd: new Date(now + 1 * DAY + 2 * HOUR),
    },
  });

  // ---- 资源(canonical ossKey;S6 授权正例)----
  const resourceOssKey = `resource/${orgId}/demo/fixg-courseware.html`;
  const resource = await raw.resource.create({
    data: { orgId, ownerId: teacher.id, type: 'interactive', name: 'FIXG · 讲解课件', ossKey: resourceOssKey, meta: {} },
  });
  // L1 lecture 环节引用该课件 → 使 active 选课学生获授权回看
  await raw.lessonSegment.create({
    data: { orgId, lessonId: l1.id, seq: 1, type: 'lecture', durationMin: 30, config: {}, resourceId: resource.id },
  });

  // ---- 题目 ----
  const qSingle = await raw.question.create({
    data: {
      orgId, ownerId: teacher.id, type: 'single', stage: '初中', subject: '数学',
      stemLatex: 'FIXG-Q1 选择正确选项。', answer: { choice: 'B' },
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
      orgId, ownerId: teacher.id, type: 'solution', stage: '初中', subject: '数学',
      stemLatex: 'FIXG-Q2 写出完整过程。', answer: { referenceLatex: '$x=2$' },
      rubric: [{ step: 1, desc: '列式', score: 5 }, { step: 2, desc: '求解', score: 5 }],
      analysisLatex: '列式求解。', difficulty: 2, status: 'published',
    },
  });

  // ---- 卷 ----
  const paperMixed = await raw.paper.create({
    data: { orgId, creatorId: teacher.id, name: 'FIXG · 混合卷', type: 'homework', totalScore: 15, status: 'published' },
  });
  await raw.paperQuestion.createMany({
    data: [
      { orgId, paperId: paperMixed.id, questionId: qSingle.id, seq: 1, score: 5 },
      { orgId, paperId: paperMixed.id, questionId: qSol.id, seq: 2, score: 10 },
    ],
  });
  const paperObj = await raw.paper.create({
    data: { orgId, creatorId: teacher.id, name: 'FIXG · 纯客观卷', type: 'homework', totalScore: 5, status: 'published' },
  });
  await raw.paperQuestion.create({
    data: { orgId, paperId: paperObj.id, questionId: qSingle.id, seq: 1, score: 5 },
  });
  // S4:practice 类型卷(用于验证可被布置为 homework 作业)
  const paperPractice = await raw.paper.create({
    data: { orgId, creatorId: teacher.id, name: 'FIXG · 随堂练卷', type: 'practice', totalScore: 5, status: 'published' },
  });
  await raw.paperQuestion.create({
    data: { orgId, paperId: paperPractice.id, questionId: qSingle.id, seq: 1, score: 5 },
  });

  // ---- 作业 ----
  const asgMixed = await raw.assignment.create({
    data: {
      orgId, paperId: paperMixed.id, lessonId: l2.id, teacherId: teacher.id, kind: 'homework',
      target: { courseId: Number(course.id) }, scoreCounted: true,
    },
  });
  const asgObj = await raw.assignment.create({
    data: {
      orgId, paperId: paperObj.id, lessonId: l2.id, teacherId: teacher.id, kind: 'homework',
      target: { courseId: Number(course.id) }, scoreCounted: true,
    },
  });

  return {
    orgId,
    teacherId: teacher.id, teacherPhone: teacher.phone!,
    s1Id: s1.id, s2Id: s2.id,
    courseId: course.id,
    l1Id: l1.id, l2Id: l2.id, l3Id: l3.id,
    qSingleId: qSingle.id, qSolId: qSol.id,
    paperMixedId: Number(paperMixed.id), paperObjId: Number(paperObj.id), paperPracticeId: Number(paperPractice.id),
    asgMixedId: Number(asgMixed.id), asgObjId: Number(asgObj.id),
    resourceId: Number(resource.id), resourceOssKey,
  };
}

export async function dropFixgOrg(orgId: bigint): Promise<void> {
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
  await raw.resource.deleteMany({ where: { orgId } });
  await raw.lesson.deleteMany({ where: { orgId } });
  await raw.courseStudent.deleteMany({ where: { orgId } });
  await raw.course.deleteMany({ where: { orgId } });
  await raw.auditLog.deleteMany({ where: { orgId } });
  await raw.user.deleteMany({ where: { orgId } });
  await raw.org.deleteMany({ where: { id: orgId } });
}
