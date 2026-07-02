/**
 * C3-back 测试夹具(自建自清,13910 号段,不破坏 seed 基线):
 * - 专属机构 + admin / 两教师(甲有课、乙无课)/ 两学生(均选课)
 * - 一张教材图谱 + 两知识点(A 有 content、B 无 content / 未维护内容包)
 * - 讲解课件资源 + 随堂练卷 + 课后作业卷(供内容包 / publish / 作业总览)
 * - 讲次:今日窗口待发布讲次(#B)、长期 draft 讲次(#B 无会话)、挂作业讲次(#C)
 * - 作业:进行中(部分出分)与已完成(全部出分)各一,供总览进度/状态对账
 */
import { hashPassword } from '../../src/auth/password.util';
import { raw } from './setup';

export const C3_PASSWORD = 'C3@Pass123';

export interface C3Fixture {
  orgId: bigint;
  adminId: bigint;
  teacherAId: bigint;
  teacherBId: bigint;
  s1Id: bigint;
  s2Id: bigint;
  adminPhone: string;
  teacherAPhone: string;
  teacherBPhone: string;
  courseId: bigint;
  graphId: number;
  kpNodeAId: number;
  kpNodeAName: string;
  kpNodeAContent: string;
  kpNodeBId: number;
  kpNodeBName: string;
  resourceId: number;
  practicePaperId: number;
  hwPaperId: number;
  lessonTodayId: bigint;
  lessonDraftId: bigint;
  lessonHwId: bigint;
  assignmentOngoingId: number;
  assignmentFinishedId: number;
}

export async function createC3Org(): Promise<C3Fixture> {
  const hash = await hashPassword(C3_PASSWORD);
  const org = await raw.org.create({
    data: {
      name: 'C3内容域测试机构',
      settings: {
        ai: { qaGuideOnly: true, preGrading: true },
        studentHours: { start: '06:00', end: '22:30' },
        deviceBinding: true,
      },
    },
  });
  const orgId = org.id;
  const [admin, teacherA, teacherB, s1, s2] = await Promise.all([
    raw.user.create({ data: { orgId, role: 'admin', name: 'C3管理员', phone: '13910000001', passwordHash: hash } }),
    raw.user.create({ data: { orgId, role: 'teacher', name: 'C3教师甲', phone: '13910000002', passwordHash: hash } }),
    raw.user.create({ data: { orgId, role: 'teacher', name: 'C3教师乙', phone: '13910000003', passwordHash: hash } }),
    raw.user.create({ data: { orgId, role: 'student', name: 'C3学生一', phone: '13910000011', studentNo: 'C3-S001' } }),
    raw.user.create({ data: { orgId, role: 'student', name: 'C3学生二', phone: '13910000012', studentNo: 'C3-S002' } }),
  ]);

  const course = await raw.course.create({
    data: {
      orgId, name: 'C3 · 初二数学内容班', classType: 'group', subject: '数学', stage: '初中',
      teacherId: teacherA.id, totalLessons: 6, status: 'ongoing',
    },
  });
  await raw.courseStudent.createMany({
    data: [s1.id, s2.id].map((sid) => ({ orgId, courseId: course.id, studentId: sid })),
  });

  // 教材图谱 + 两节点(A 有 content,B 无)
  const graph = await raw.kpGraph.create({
    data: { orgId, code: 'c3_pep_mini', graphType: 'curriculum_knowledge', subject: '数学' },
  });
  const kpNodeAName = '一次函数的概念';
  const kpNodeAContent = '一次函数 y=kx+b(k≠0)的教材正文示例。';
  const kpNodeA = await raw.kpNode.create({
    data: { orgId, graphId: graph.id, code: 'C3-KP-001', name: kpNodeAName, content: kpNodeAContent },
  });
  const kpNodeBName = '一次函数的图象';
  const kpNodeB = await raw.kpNode.create({
    data: { orgId, graphId: graph.id, code: 'C3-KP-002', name: kpNodeBName },
  });

  // 讲解课件资源(初始无 kpNode 归档)
  const resource = await raw.resource.create({
    data: { orgId, ownerId: teacherA.id, type: 'ppt', name: 'C3 · 一次函数讲解课件', ossKey: 'demo/c3/lecture.ppt', meta: {} },
  });

  // 两道 published 题 + 两份 published 卷(随堂练 / 课后作业)
  const mkSingle = async (stem: string) => {
    const q = await raw.question.create({
      data: {
        orgId, ownerId: teacherA.id, type: 'single', stage: '初中', subject: '数学',
        stemLatex: stem, answer: { choice: 'B' }, rubric: [], difficulty: 2, status: 'published',
      },
    });
    await raw.questionOption.createMany({
      data: ['A', 'B', 'C', 'D'].map((label, i) => ({
        orgId, questionId: q.id, label, contentLatex: `$选项${label}$`, isCorrect: i === 1,
      })),
    });
    return q.id;
  };
  const q1 = await mkSingle('C3-Q1 一次函数(  )');
  const q2 = await mkSingle('C3-Q2 一次函数(  )');

  const mkPaper = async (name: string, type: 'practice' | 'homework') => {
    const p = await raw.paper.create({
      data: { orgId, creatorId: teacherA.id, name, type, totalScore: 10, status: 'published' },
    });
    await raw.paperQuestion.createMany({
      data: [q1, q2].map((qid, i) => ({ orgId, paperId: p.id, questionId: qid, seq: i + 1, score: 5 })),
    });
    return p;
  };
  const practicePaper = await mkPaper('C3 · 随堂练卷', 'practice');
  const hwPaper = await mkPaper('C3 · 课后作业卷', 'homework');

  // ---- 讲次 ----
  const now = new Date();
  const todayNoon = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 12, 0));
  // #B:今日窗口待发布讲次(draft;编排好 practice 挂 published 卷,可通过 publish 校验)
  const lessonToday = await raw.lesson.create({
    data: {
      orgId, courseId: course.id, seq: 1, title: 'C3 · 今日讲次',
      scheduledStart: todayNoon, scheduledEnd: new Date(todayNoon.getTime() + 2 * 3600_000),
      status: 'draft', prepChecklist: {},
    },
  });
  await raw.lessonSegment.createMany({
    data: [
      { orgId, lessonId: lessonToday.id, seq: 1, type: 'lecture', durationMin: 20, config: {}, resourceId: resource.id },
      { orgId, lessonId: lessonToday.id, seq: 2, type: 'practice', durationMin: 20, config: { ai_guide: true, stuck_alert_min: 4 }, paperId: practicePaper.id },
    ] as never,
  });
  // #B:长期 draft 讲次(远期,不进今日窗口;永不发布 → 无会话)
  const lessonDraft = await raw.lesson.create({
    data: {
      orgId, courseId: course.id, seq: 2, title: 'C3 · 未发布讲次',
      scheduledStart: new Date(todayNoon.getTime() + 30 * 86400_000),
      scheduledEnd: new Date(todayNoon.getTime() + 30 * 86400_000 + 2 * 3600_000),
      status: 'draft', prepChecklist: {},
    },
  });
  // #C:挂作业讲次(上周,不进今日窗口)
  const lessonHw = await raw.lesson.create({
    data: {
      orgId, courseId: course.id, seq: 3, title: 'C3 · 作业讲次',
      scheduledStart: new Date(todayNoon.getTime() - 7 * 86400_000),
      scheduledEnd: new Date(todayNoon.getTime() - 7 * 86400_000 + 2 * 3600_000),
      status: 'finished', prepChecklist: {},
    },
  });

  // ---- #C 作业 + 作答 ----
  // 进行中:s1 已出分(graded)、s2 已交未出分(submitted)→ submitted=2 graded=1 ongoing
  const aOngoing = await raw.assignment.create({
    data: { orgId, paperId: hwPaper.id, lessonId: lessonHw.id, teacherId: teacherA.id, kind: 'homework', target: { courseId: Number(course.id) }, dueAt: new Date(todayNoon.getTime() - 86400_000) },
  });
  await raw.attempt.create({ data: { orgId, assignmentId: aOngoing.id, studentId: s1.id, status: 'graded', submittedAt: new Date(), score: 10 } });
  await raw.attempt.create({ data: { orgId, assignmentId: aOngoing.id, studentId: s2.id, status: 'submitted', submittedAt: new Date() } });

  // 已完成:s1、s2 均 graded → submitted=2 graded=2 finished
  const aFinished = await raw.assignment.create({
    data: { orgId, paperId: hwPaper.id, lessonId: lessonHw.id, teacherId: teacherA.id, kind: 'homework', target: { courseId: Number(course.id) }, dueAt: new Date(todayNoon.getTime() - 86400_000) },
  });
  await raw.attempt.create({ data: { orgId, assignmentId: aFinished.id, studentId: s1.id, status: 'graded', submittedAt: new Date(), score: 10 } });
  await raw.attempt.create({ data: { orgId, assignmentId: aFinished.id, studentId: s2.id, status: 'graded', submittedAt: new Date(), score: 8 } });

  return {
    orgId,
    adminId: admin.id,
    teacherAId: teacherA.id,
    teacherBId: teacherB.id,
    s1Id: s1.id,
    s2Id: s2.id,
    adminPhone: admin.phone!,
    teacherAPhone: teacherA.phone!,
    teacherBPhone: teacherB.phone!,
    courseId: course.id,
    graphId: Number(graph.id),
    kpNodeAId: Number(kpNodeA.id),
    kpNodeAName,
    kpNodeAContent,
    kpNodeBId: Number(kpNodeB.id),
    kpNodeBName,
    resourceId: Number(resource.id),
    practicePaperId: Number(practicePaper.id),
    hwPaperId: Number(hwPaper.id),
    lessonTodayId: lessonToday.id,
    lessonDraftId: lessonDraft.id,
    lessonHwId: lessonHw.id,
    assignmentOngoingId: Number(aOngoing.id),
    assignmentFinishedId: Number(aFinished.id),
  };
}

export async function dropC3Org(orgId: bigint): Promise<void> {
  await raw.kpContentPack.deleteMany({ where: { orgId } });
  await raw.sessionEvent.deleteMany({ where: { orgId } });
  await raw.sessionParticipant.deleteMany({ where: { orgId } });
  await raw.classSession.deleteMany({ where: { orgId } });
  await raw.gradingRecord.deleteMany({ where: { orgId } });
  await raw.answer.deleteMany({ where: { orgId } });
  await raw.attempt.deleteMany({ where: { orgId } });
  await raw.assignment.deleteMany({ where: { orgId } });
  await raw.lessonSegment.deleteMany({ where: { orgId } });
  await raw.paperQuestion.deleteMany({ where: { orgId } });
  await raw.paper.deleteMany({ where: { orgId } });
  await raw.lesson.deleteMany({ where: { orgId } });
  await raw.courseStudent.deleteMany({ where: { orgId } });
  await raw.course.deleteMany({ where: { orgId } });
  await raw.resource.deleteMany({ where: { orgId } });
  await raw.questionOption.deleteMany({ where: { orgId } });
  await raw.questionTag.deleteMany({ where: { orgId } });
  await raw.question.deleteMany({ where: { orgId } });
  await raw.kpNode.deleteMany({ where: { orgId } });
  await raw.kpGraph.deleteMany({ where: { orgId } });
  await raw.device.deleteMany({ where: { orgId } });
  await raw.loginTicket.deleteMany({ where: { orgId } });
  await raw.auditLog.deleteMany({ where: { orgId } });
  await raw.user.deleteMany({ where: { orgId } });
  await raw.org.deleteMany({ where: { id: orgId } });
}
