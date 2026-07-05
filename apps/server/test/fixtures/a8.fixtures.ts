/**
 * A8 测试夹具(自建自清,不触碰 seed 数据,手机号 1397 开头):
 * - 机构A:admin / 教师 / 学生×5 + 课程 C1(s1、s2、s5 active;s3 quit;s4 未选课)
 *   + 空课程 C2(零学生,验收「空数据课程返回空数组」)
 *   + 双图谱:curriculum(N1、N2)与 ability(M1,用于验证「只取 curriculum 维度」)
 *   + 直插 mastery_snapshots / attempts(活跃窗口)/ wrong_book_entries(数字全部可手算)
 * - 机构B:教师 + 管理员 + 学生(跨租户 404 用例,宪法 §7)
 *
 * 手算账本(测试断言依据):
 *   C1 active 学生 = s1、s2、s5
 *   快照:s1{N1:80/5, N2:45/4, M1:30/2} s2{N1:40/2} s5{N1:90/6}
 *        s3(quit){N1:10/1} s4(未选课){N2:99/3} → 一律不入 C1 聚合
 *   热力:N1 avg=round((80+40+90)/3)=70 count=3;N2 avg=45 count=1;M1 不出现
 *   活跃:s1 作答于 1 天前、s5 于 2 天前(活跃);s2 最近作答 10 天前(未活跃)
 *   关注:s1(N2<60)、s2(N1<60 且 7 日未活跃);s5 不入列
 *   s1 报告:mastery 3 条(含 M1)/ wrongOpenCount=2(2 open + 1 cleared)/ attempts30d=1(40 天前的不计)
 */
import { hashPassword } from '../../src/auth/password.util';
import { raw } from './setup';

export const A8_PASSWORD = 'A8@Pass123';

export interface A8Fixture {
  orgId: bigint;
  adminPhone: string;
  teacherPhone: string;
  teacherId: bigint;
  s1Id: bigint;
  s2Id: bigint;
  s3Id: bigint;
  s4Id: bigint;
  s5Id: bigint;
  courseId: bigint; // C1
  emptyCourseId: bigint; // C2
  node1Id: bigint; // curriculum N1
  node2Id: bigint; // curriculum N2
  nodeM1Id: bigint; // ability M1
  /** 机构B(跨租户) */
  orgBId: bigint;
  teacherBPhone: string;
  adminBPhone: string;
  studentBId: bigint;
}

const DAY = 86400_000;

export async function createA8Org(): Promise<A8Fixture> {
  const hash = await hashPassword(A8_PASSWORD);
  const org = await raw.org.create({
    data: {
      name: 'A8学情测试机构',
      settings: {
        ai: { qaGuideOnly: true, preGrading: true },
        studentHours: { start: '00:00', end: '23:59' },
        deviceBinding: true,
      },
    },
  });
  const orgId = org.id;
  // [FIX1 报备的最小修复] 原 Promise.all 并发建用户导致 id 分配顺序不确定:
  // 关注列表契约按 studentId 升序,s2.id < s1.id 时 a8 套件断言随机翻车(全量跑必现过)。
  // 改为顺序创建保证 s1.id < s2.id < …,手算账本语义零变化。
  const admin = await raw.user.create({ data: { orgId, role: 'admin', name: 'A8管理员', phone: '13970000001', passwordHash: hash } });
  const teacher = await raw.user.create({ data: { orgId, role: 'teacher', name: 'A8教师', phone: '13970000002', passwordHash: hash } });
  const s1 = await raw.user.create({ data: { orgId, role: 'student', name: 'A8学生一', phone: '13970000011', studentNo: 'A8-S001' } });
  const s2 = await raw.user.create({ data: { orgId, role: 'student', name: 'A8学生二', phone: '13970000012', studentNo: 'A8-S002' } });
  const s3 = await raw.user.create({ data: { orgId, role: 'student', name: 'A8学生三', phone: '13970000013', studentNo: 'A8-S003' } });
  const s4 = await raw.user.create({ data: { orgId, role: 'student', name: 'A8学生四', phone: '13970000014', studentNo: 'A8-S004' } });
  const s5 = await raw.user.create({ data: { orgId, role: 'student', name: 'A8学生五', phone: '13970000015', studentNo: 'A8-S005' } });

  // ---- 课程:C1(s1/s2/s5 active,s3 quit)+ C2 空课程 ----
  const course = await raw.course.create({
    data: {
      orgId, name: 'A8 · 初二数学学情班', classType: 'group', subject: '数学', stage: '初中',
      teacherId: teacher.id, totalLessons: 4, status: 'ongoing',
    },
  });
  const emptyCourse = await raw.course.create({
    data: {
      orgId, name: 'A8 · 空数据课程', classType: 'one_on_one', subject: '数学', stage: '初中',
      teacherId: teacher.id, totalLessons: 2, status: 'ongoing',
    },
  });
  await raw.courseStudent.createMany({
    data: [
      { orgId, courseId: course.id, studentId: s1.id, status: 'active' },
      { orgId, courseId: course.id, studentId: s2.id, status: 'active' },
      { orgId, courseId: course.id, studentId: s3.id, status: 'quit' },
      { orgId, courseId: course.id, studentId: s5.id, status: 'active' },
    ],
  });

  // ---- 双图谱:curriculum(N1/N2)+ ability(M1,验证维度过滤)----
  const g1 = await raw.kpGraph.create({
    data: { orgId, code: 'a8_curriculum', graphType: 'curriculum_knowledge', subject: '数学' },
  });
  const g2 = await raw.kpGraph.create({
    data: { orgId, code: 'a8_ability', graphType: 'problem_solving_ability', subject: '数学' },
  });
  const node1 = await raw.kpNode.create({ data: { orgId, graphId: g1.id, code: 'A8-N1', name: 'A8·一次函数概念' } });
  const node2 = await raw.kpNode.create({ data: { orgId, graphId: g1.id, code: 'A8-N2', name: 'A8·图象平移' } });
  const nodeM1 = await raw.kpNode.create({ data: { orgId, graphId: g2.id, code: 'A8-M1', name: 'A8·运算能力' } });

  // ---- 掌握度快照(直插,数字即手算账本)----
  await raw.masterySnapshot.createMany({
    data: [
      { orgId, studentId: s1.id, nodeId: node1.id, mastery: 80, sampleCount: 5 },
      { orgId, studentId: s1.id, nodeId: node2.id, mastery: 45, sampleCount: 4 },
      { orgId, studentId: s1.id, nodeId: nodeM1.id, mastery: 30, sampleCount: 2 },
      { orgId, studentId: s2.id, nodeId: node1.id, mastery: 40, sampleCount: 2 },
      { orgId, studentId: s3.id, nodeId: node1.id, mastery: 10, sampleCount: 1 },
      { orgId, studentId: s4.id, nodeId: node2.id, mastery: 99, sampleCount: 3 },
      { orgId, studentId: s5.id, nodeId: node1.id, mastery: 90, sampleCount: 6 },
    ],
  });

  // ---- 作答活动(活跃窗口 + attempts30d 手算)----
  const paper = await raw.paper.create({
    data: { orgId, creatorId: teacher.id, name: 'A8 · 活跃度作业卷', type: 'homework', totalScore: 10, status: 'published' },
  });
  const assignment = await raw.assignment.create({
    data: {
      orgId, paperId: paper.id, teacherId: teacher.id, kind: 'homework',
      target: { courseId: Number(course.id) }, scoreCounted: true,
    },
  });
  const now = Date.now();
  const attempt = (sid: bigint, attemptNo: number, startAgoDays: number, submitted: boolean) =>
    raw.attempt.create({
      data: {
        orgId, assignmentId: assignment.id, studentId: sid, attemptNo,
        status: submitted ? 'submitted' : 'in_progress',
        startedAt: new Date(now - startAgoDays * DAY),
        submittedAt: submitted ? new Date(now - startAgoDays * DAY + 1800_000) : null,
      },
    });
  const a1 = await attempt(s1.id, 1, 1, true); // s1:1 天前(活跃;attempts30d 计 1)
  await attempt(s1.id, 2, 40, false); //          s1:40 天前(30 天窗口外,不计)
  await attempt(s2.id, 1, 10, true); //           s2:10 天前(7 日未活跃)
  await attempt(s5.id, 1, 2, true); //            s5:2 天前(活跃)

  // ---- 错题账本:s1 = 2 open + 1 cleared → wrongOpenCount=2 ----
  const mkQuestion = (label: string) =>
    raw.question.create({
      data: {
        orgId, ownerId: teacher.id, type: 'single', stage: '初中', subject: '数学',
        stemLatex: `A8-${label} 一次函数选择题(  )`, answer: { choice: 'B' },
        difficulty: 2, status: 'published',
      },
    });
  const [q1, q2, q3] = await Promise.all([mkQuestion('Q1'), mkQuestion('Q2'), mkQuestion('Q3')]);
  const mkAnswer = (qid: bigint) =>
    raw.answer.create({
      data: { orgId, attemptId: a1.id, questionId: qid, response: { choice: 'A' }, isCorrect: false, score: 0 },
    });
  const [ans1, ans2, ans3] = [await mkAnswer(q1.id), await mkAnswer(q2.id), await mkAnswer(q3.id)];
  await raw.wrongBookEntry.createMany({
    data: [
      { orgId, studentId: s1.id, questionId: q1.id, sourceAnswerId: ans1.id, status: 'open' },
      { orgId, studentId: s1.id, questionId: q2.id, sourceAnswerId: ans2.id, status: 'open' },
      { orgId, studentId: s1.id, questionId: q3.id, sourceAnswerId: ans3.id, status: 'cleared', correctRedoCount: 2 },
    ],
  });

  // ---- 机构B(跨租户)----
  const orgB = await raw.org.create({
    data: {
      name: 'A8跨租户机构B',
      settings: {
        ai: { qaGuideOnly: true, preGrading: true },
        studentHours: { start: '00:00', end: '23:59' },
        deviceBinding: true,
      },
    },
  });
  const [teacherB, adminB, studentB] = await Promise.all([
    raw.user.create({ data: { orgId: orgB.id, role: 'teacher', name: 'A8教师B', phone: '13970000021', passwordHash: hash } }),
    raw.user.create({ data: { orgId: orgB.id, role: 'admin', name: 'A8管理员B', phone: '13970000022', passwordHash: hash } }),
    raw.user.create({ data: { orgId: orgB.id, role: 'student', name: 'A8学生B', phone: '13970000023', studentNo: 'A8-B001' } }),
  ]);

  return {
    orgId,
    adminPhone: admin.phone!,
    teacherPhone: teacher.phone!,
    teacherId: teacher.id,
    s1Id: s1.id, s2Id: s2.id, s3Id: s3.id, s4Id: s4.id, s5Id: s5.id,
    courseId: course.id,
    emptyCourseId: emptyCourse.id,
    node1Id: node1.id, node2Id: node2.id, nodeM1Id: nodeM1.id,
    orgBId: orgB.id,
    teacherBPhone: teacherB.phone!,
    adminBPhone: adminB.phone!,
    studentBId: studentB.id,
  };
}

export async function dropA8Org(orgId: bigint, orgBId: bigint): Promise<void> {
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
