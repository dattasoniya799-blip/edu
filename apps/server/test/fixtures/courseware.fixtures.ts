/**
 * AI 生成课件 e2e 夹具(自建自清,手机号 139599 段 / studentNo 前缀 CW-,专属 qiming_cw 库):
 * - 机构:教师 t1(任务发起人)/ 教师 t2(同机构他人,验归属 404)/ 学生 s1(验角色 403)
 * - 一门课 + 一讲 + 一张迷你图谱的 1 个知识点(验 lessonId/kpNodeId 锚点与知识点上下文)
 * seed 数据只读;afterAll 逆依赖全量清理(含本 org 生成的 Resource)。
 */
import { raw } from './setup';

export const CW_PASSWORD = 'Cw@Pass123';

export interface CwFixture {
  orgId: bigint;
  t1Id: bigint;
  t1Phone: string;
  t2Id: bigint;
  t2Phone: string;
  s1Id: bigint;
  courseId: bigint;
  lessonId: bigint;
  kpNodeId: bigint;
  kpNodeName: string;
}

export async function createCwOrg(): Promise<CwFixture> {
  const { hashPassword } = await import('../../src/auth/password.util');
  const hash = await hashPassword(CW_PASSWORD);
  const org = await raw.org.create({
    data: {
      name: 'CW · AI 生成课件测试机构',
      settings: {
        ai: { qaGuideOnly: true, preGrading: true },
        studentHours: { start: '00:00', end: '23:59' },
        deviceBinding: true,
      },
    },
  });
  const orgId = org.id;
  const [t1, t2, s1] = await Promise.all([
    raw.user.create({ data: { orgId, role: 'teacher', name: 'CW教师一', phone: '13959900002', passwordHash: hash } }),
    raw.user.create({ data: { orgId, role: 'teacher', name: 'CW教师二', phone: '13959900003', passwordHash: hash } }),
    raw.user.create({ data: { orgId, role: 'student', name: 'CW学生一', phone: '13959900011', studentNo: 'CW-S001' } }),
  ]);

  const course = await raw.course.create({
    data: {
      orgId, name: 'CW · 初二数学班', classType: 'group', subject: '数学',
      stage: '初中', teacherId: t1.id, totalLessons: 2, status: 'ongoing',
    },
  });
  await raw.courseStudent.create({ data: { orgId, courseId: course.id, studentId: s1.id, status: 'active' } });
  const lesson = await raw.lesson.create({
    data: {
      orgId, courseId: course.id, seq: 1, title: 'CW 第1讲 · 相似三角形的判定',
      status: 'ready',
      scheduledStart: new Date(Date.now() + 86400_000),
      scheduledEnd: new Date(Date.now() + 86400_000 + 2 * 3600_000),
    },
  });

  const graph = await raw.kpGraph.create({
    data: { orgId, code: 'cw_pep_mini', graphType: 'curriculum_knowledge', subject: '数学' },
  });
  const kpNodeName = '相似三角形的判定';
  const kpNode = await raw.kpNode.create({
    data: { orgId, graphId: graph.id, code: 'CW-KP-001', name: kpNodeName },
  });

  // E1 前置:/courseware/* 现挂 ai_courseware 功能门禁(默认 beta=仅白名单)——
  // 显式落 flag 行并把 t1/t2 加入白名单(t2 需过 gate 才能验"同机构他人 404"的归属语义)。
  await raw.featureFlag.create({ data: { orgId, key: 'ai_courseware', stage: 'beta' } });
  await raw.featureAccess.createMany({
    data: [t1.id, t2.id].map((uid) => ({ orgId, featureKey: 'ai_courseware', userId: uid })),
  });

  return {
    orgId,
    t1Id: t1.id, t1Phone: t1.phone!,
    t2Id: t2.id, t2Phone: t2.phone!,
    s1Id: s1.id,
    courseId: course.id, lessonId: lesson.id,
    kpNodeId: kpNode.id, kpNodeName,
  };
}

export async function dropCwOrg(orgId: bigint): Promise<void> {
  await raw.featureAccess.deleteMany({ where: { orgId } });
  await raw.featureFlag.deleteMany({ where: { orgId } });
  await raw.resource.deleteMany({ where: { orgId } });
  await raw.aiCall.deleteMany({ where: { orgId } });
  await raw.kpNode.deleteMany({ where: { orgId } });
  await raw.kpGraph.deleteMany({ where: { orgId } });
  await raw.lesson.deleteMany({ where: { orgId } });
  await raw.courseStudent.deleteMany({ where: { orgId } });
  await raw.course.deleteMany({ where: { orgId } });
  await raw.device.deleteMany({ where: { orgId } });
  await raw.loginTicket.deleteMany({ where: { orgId } });
  await raw.auditLog.deleteMany({ where: { orgId } });
  await raw.user.deleteMany({ where: { orgId } });
  await raw.org.deleteMany({ where: { id: orgId } });
}
