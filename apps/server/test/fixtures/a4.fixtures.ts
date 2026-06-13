/**
 * A4 测试夹具(自建自清,不破坏 seed 基线):
 * - 专属机构(手机号 1393 开头)+ admin / 两教师 / 三学生(s1、s2 选课,s3 未选课)
 * - 一门课程(teacherA 主讲,3 讲,lesson1/2 排在未来)
 * - 4 道 published 题目(single×2 / blank / solution),供组卷
 */
import { hashPassword } from '../../src/auth/password.util';
import { raw } from './setup';

export const A4_PASSWORD = 'A4@Pass123';

export interface A4Fixture {
  orgId: bigint;
  adminId: bigint;
  teacherAId: bigint;
  teacherBId: bigint;
  s1Id: bigint;
  s2Id: bigint;
  s3Id: bigint;
  adminPhone: string;
  teacherAPhone: string;
  teacherBPhone: string;
  courseId: bigint;
  lessonIds: bigint[]; // seq 1..3
  lesson1StartIso: string;
  questionIds: number[]; // [single, blank, solution, single]
  kpNodeId: number; // 环节知识点标签(IMPL2)
  kpNodeName: string;
  kpNode2Id: number; // 第二个知识点节点(C2 单元 unitSeq 一致性校验用)
}

export async function createA4Org(): Promise<A4Fixture> {
  const hash = await hashPassword(A4_PASSWORD);
  const org = await raw.org.create({
    data: {
      name: 'A4课程域测试机构',
      settings: {
        ai: { qaGuideOnly: true, preGrading: true },
        studentHours: { start: '06:00', end: '22:30' },
        deviceBinding: true,
      },
    },
  });
  const orgId = org.id;
  const [admin, teacherA, teacherB, s1, s2, s3] = await Promise.all([
    raw.user.create({ data: { orgId, role: 'admin', name: 'A4管理员', phone: '13930000001', passwordHash: hash } }),
    raw.user.create({ data: { orgId, role: 'teacher', name: 'A4教师甲', phone: '13930000002', passwordHash: hash } }),
    raw.user.create({ data: { orgId, role: 'teacher', name: 'A4教师乙', phone: '13930000003', passwordHash: hash } }),
    raw.user.create({ data: { orgId, role: 'student', name: 'A4学生一', phone: '13930000011', studentNo: 'A4-S001' } }),
    raw.user.create({ data: { orgId, role: 'student', name: 'A4学生二', phone: '13930000012', studentNo: 'A4-S002' } }),
    raw.user.create({ data: { orgId, role: 'student', name: 'A4学生三', phone: '13930000013', studentNo: 'A4-S003' } }),
  ]);

  const course = await raw.course.create({
    data: {
      orgId,
      name: 'A4 · 初二数学冲刺班',
      classType: 'group',
      subject: '数学',
      stage: '初中',
      teacherId: teacherA.id,
      totalLessons: 3,
      status: 'ongoing',
    },
  });
  await raw.courseStudent.createMany({
    data: [s1.id, s2.id].map((sid) => ({ orgId, courseId: course.id, studentId: sid })),
  });

  // 环节知识点标签:本 org 一张教材图谱 + 1 个节点
  const kpGraph = await raw.kpGraph.create({
    data: { orgId, code: 'a4_pep_mini', graphType: 'curriculum_knowledge', subject: '数学' },
  });
  const kpNodeName = '一次函数的图象';
  const kpNode = await raw.kpNode.create({
    data: { orgId, graphId: kpGraph.id, code: 'A4-KP-001', name: kpNodeName },
  });
  const kpNode2 = await raw.kpNode.create({
    data: { orgId, graphId: kpGraph.id, code: 'A4-KP-002', name: '一次函数的性质' },
  });

  const lesson1Start = new Date(Date.now() + 3 * 86400_000);
  const lessonIds: bigint[] = [];
  for (let i = 0; i < 3; i++) {
    const start = new Date(lesson1Start.getTime() + i * 7 * 86400_000);
    const l = await raw.lesson.create({
      data: {
        orgId,
        courseId: course.id,
        seq: i + 1,
        title: `第${i + 1}讲`,
        scheduledStart: start,
        scheduledEnd: new Date(start.getTime() + 2 * 3600_000),
        status: 'draft',
        prepChecklist: {},
      },
    });
    lessonIds.push(l.id);
  }

  // 4 道 published 题(组卷用;q3 为 solution,供主观题进度统计)
  const qDefs = [
    { type: 'single' as const, stem: 'A4-Q1 $y=2x+1$ 平移问题(  )', answer: { choice: 'B' } },
    { type: 'blank' as const, stem: 'A4-Q2 解析式为 ________。', answer: { texts: ['y=2x-1'] } },
    {
      type: 'solution' as const,
      stem: 'A4-Q3 求一次函数解析式(写出过程)。',
      answer: { referenceLatex: '$k=2,b=1$' },
      rubric: [
        { step: 1, desc: '代入两点', score: 5 },
        { step: 2, desc: '解出 k,b', score: 5 },
      ],
    },
    { type: 'single' as const, stem: 'A4-Q4 下列说法正确的是(  )', answer: { choice: 'A' } },
  ];
  const questionIds: number[] = [];
  for (const d of qDefs) {
    const q = await raw.question.create({
      data: {
        orgId,
        ownerId: teacherA.id,
        type: d.type,
        stage: '初中',
        subject: '数学',
        stemLatex: d.stem,
        answer: d.answer,
        rubric: (d as { rubric?: object[] }).rubric ?? [],
        difficulty: 2,
        status: 'published',
      },
    });
    if (d.type === 'single') {
      await raw.questionOption.createMany({
        data: ['A', 'B', 'C', 'D'].map((label, i) => ({
          orgId,
          questionId: q.id,
          label,
          contentLatex: `$选项${label}$`,
          isCorrect: i === (d.answer as { choice: string }).choice.charCodeAt(0) - 65,
        })),
      });
    }
    questionIds.push(Number(q.id));
  }

  return {
    orgId,
    adminId: admin.id,
    teacherAId: teacherA.id,
    teacherBId: teacherB.id,
    s1Id: s1.id,
    s2Id: s2.id,
    s3Id: s3.id,
    adminPhone: admin.phone!,
    teacherAPhone: teacherA.phone!,
    teacherBPhone: teacherB.phone!,
    courseId: course.id,
    lessonIds,
    lesson1StartIso: lesson1Start.toISOString(),
    questionIds,
    kpNodeId: Number(kpNode.id),
    kpNodeName,
    kpNode2Id: Number(kpNode2.id),
  };
}

export async function dropA4Org(orgId: bigint): Promise<void> {
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
