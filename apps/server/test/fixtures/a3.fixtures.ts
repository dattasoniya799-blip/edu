/**
 * A3 测试夹具(自建自清,不破坏 seed 数据):
 * - 专属机构 + admin/两教师/学生(手机号 1392 开头,密码统一)
 * - 机构内自建小型教材/能力图谱(题目标签校验需在同 org 下有 curriculum 节点)
 */
import { hashPassword } from '../../src/auth/password.util';
import { raw } from './setup';

export const A3_PASSWORD = 'A3@Pass123';

export interface A3Fixture {
  orgId: bigint;
  adminId: bigint;
  teacherAId: bigint;
  teacherBId: bigint;
  studentId: bigint;
  adminPhone: string;
  teacherAPhone: string;
  teacherBPhone: string;
  /** 教材图谱 */
  pepGraphId: bigint;
  /** 教材图谱节点(一次函数章) */
  pepNodeIds: bigint[];
  /** 能力图谱节点 */
  abilityNodeId: bigint;
}

export async function createA3Org(): Promise<A3Fixture> {
  const hash = await hashPassword(A3_PASSWORD);
  const org = await raw.org.create({
    data: {
      name: 'A3题库测试机构',
      settings: {
        ai: { qaGuideOnly: true, preGrading: true },
        studentHours: { start: '00:00', end: '23:59' },
        deviceBinding: true,
      },
    },
  });
  const orgId = org.id;
  const [admin, teacherA, teacherB, student] = await Promise.all([
    raw.user.create({ data: { orgId, role: 'admin', name: 'A3管理员', phone: '13920000001', passwordHash: hash } }),
    raw.user.create({ data: { orgId, role: 'teacher', name: 'A3教师甲', phone: '13920000002', passwordHash: hash } }),
    raw.user.create({ data: { orgId, role: 'teacher', name: 'A3教师乙', phone: '13920000003', passwordHash: hash } }),
    raw.user.create({ data: { orgId, role: 'student', name: 'A3学生', phone: '13920000004', studentNo: 'A3-S001' } }),
  ]);

  const pepGraph = await raw.kpGraph.create({
    data: { orgId, code: 'a3_pep_mini', graphType: 'curriculum_knowledge', subject: '数学' },
  });
  const pepNodes = await Promise.all(
    ['一次函数的概念', '一次函数的图象', '待定系数法'].map((name, i) =>
      raw.kpNode.create({
        data: {
          orgId,
          graphId: pepGraph.id,
          code: `A3-PEP-${i + 1}`,
          name,
          grade: '初二',
          chapter: '第十九章 一次函数',
          section: `19.${i + 1}`,
          difficulty: 2,
        },
      }),
    ),
  );
  const abilityGraph = await raw.kpGraph.create({
    data: { orgId, code: 'a3_ability_mini', graphType: 'problem_solving_ability', subject: '数学' },
  });
  const abilityNode = await raw.kpNode.create({
    data: { orgId, graphId: abilityGraph.id, code: 'A3-ABL-1', name: '运算求解', level: 2 },
  });

  return {
    orgId,
    adminId: admin.id,
    teacherAId: teacherA.id,
    teacherBId: teacherB.id,
    studentId: student.id,
    adminPhone: admin.phone!,
    teacherAPhone: teacherA.phone!,
    teacherBPhone: teacherB.phone!,
    pepGraphId: pepGraph.id,
    pepNodeIds: pepNodes.map((n) => n.id),
    abilityNodeId: abilityNode.id,
  };
}

export async function dropA3Org(orgId: bigint): Promise<void> {
  await raw.paperQuestion.deleteMany({ where: { orgId } });
  await raw.paper.deleteMany({ where: { orgId } });
  await raw.questionTag.deleteMany({ where: { orgId } });
  await raw.questionOption.deleteMany({ where: { orgId } });
  await raw.question.deleteMany({ where: { orgId } });
  await raw.kpEdge.deleteMany({ where: { orgId } });
  await raw.kpNode.deleteMany({ where: { orgId } });
  await raw.kpGraph.deleteMany({ where: { orgId } });
  await raw.device.deleteMany({ where: { orgId } });
  await raw.loginTicket.deleteMany({ where: { orgId } });
  await raw.auditLog.deleteMany({ where: { orgId } });
  await raw.user.deleteMany({ where: { orgId } });
  await raw.org.deleteMany({ where: { id: orgId } });
}
