import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * 掌握度重算(任务卡 A5,口径与 prisma/seed.ts business 阶段对齐):
 * - 维度:学生 × 题目 tags(question_tags → kp_nodes,三维图谱通用)
 * - 样本:该生已完成 attempt(submitted/graded)中 is_correct 非空的作答 = 客观题
 *   (主观题 is_correct 恒为 NULL,不入样本);含 redo/correction 等不计分作业
 *   (score_counted 只影响成绩,不影响掌握度)
 * - mastery = round(100 × 正确数 / 样本数),sampleCount = 样本数
 * - 全量重算该生所有节点后 upsert mastery_snapshots(幂等,可重复执行)
 */
@Injectable()
export class MasteryService {
  constructor(private readonly prisma: PrismaService) {}

  /** 重算单个学生的全部掌握度快照(在租户上下文内执行) */
  async recalcStudent(studentId: number): Promise<void> {
    const sid = BigInt(studentId);
    const answers = await this.prisma.client.answer.findMany({
      where: {
        isCorrect: { not: null },
        attempt: { studentId: sid, status: { in: ['submitted', 'graded'] } },
      },
      select: { questionId: true, isCorrect: true },
    });
    if (!answers.length) return;

    const qIds = [...new Set(answers.map((a) => a.questionId))];
    const tags = await this.prisma.client.questionTag.findMany({
      where: { questionId: { in: qIds } },
      select: { questionId: true, nodeId: true },
    });
    const nodesOf = new Map<string, bigint[]>();
    for (const t of tags) {
      const k = String(t.questionId);
      if (!nodesOf.has(k)) nodesOf.set(k, []);
      nodesOf.get(k)!.push(t.nodeId);
    }

    const acc = new Map<string, { nodeId: bigint; correct: number; total: number }>();
    for (const a of answers) {
      for (const nodeId of nodesOf.get(String(a.questionId)) ?? []) {
        const k = String(nodeId);
        const cur = acc.get(k) ?? { nodeId, correct: 0, total: 0 };
        cur.total += 1;
        if (a.isCorrect) cur.correct += 1;
        acc.set(k, cur);
      }
    }

    for (const { nodeId, correct, total } of acc.values()) {
      const mastery = Math.round((100 * correct) / total);
      await this.prisma.client.masterySnapshot.upsert({
        where: { studentId_nodeId: { studentId: sid, nodeId } },
        update: { mastery, sampleCount: total },
        create: { studentId: sid, nodeId, mastery, sampleCount: total } as never,
      });
    }
  }
}
