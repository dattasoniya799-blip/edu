import { Injectable, NotFoundException } from '@nestjs/common';
import type { KpGraphDto, KpNodeDto } from '@qiming/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { KpNodesQueryDto } from './kp.dto';

/** 知识图谱只读查询(任务卡 A3)。所有访问走租户注入 client,他 org 图谱天然不可见。 */
@Injectable()
export class KpService {
  constructor(private readonly prisma: PrismaService) {}

  /** GET /kp/graphs:本机构三类图谱 + 节点数 */
  async graphs(): Promise<KpGraphDto[]> {
    const rows = await this.prisma.client.kpGraph.findMany({
      orderBy: { id: 'asc' },
      include: { _count: { select: { nodes: true } } },
    });
    return rows.map((g) => ({
      id: Number(g.id),
      code: g.code,
      graphType: g.graphType,
      subject: g.subject,
      nodeCount: g._count.nodes,
    }));
  }

  /**
   * GET /kp/nodes:graphId 必填;grade 精确匹配,chapter/keyword 包含匹配。
   * graphId 指向他 org 或不存在 → 404(宪法 §7 跨租户)。
   */
  async nodes(q: KpNodesQueryDto): Promise<KpNodeDto[]> {
    const graph = await this.prisma.client.kpGraph.findFirst({ where: { id: BigInt(q.graphId) } });
    if (!graph) throw new NotFoundException('图谱不存在');

    const rows = await this.prisma.client.kpNode.findMany({
      where: {
        graphId: graph.id,
        ...(q.grade ? { grade: q.grade } : {}),
        ...(q.chapter ? { chapter: { contains: q.chapter } } : {}),
        ...(q.keyword ? { name: { contains: q.keyword } } : {}),
      },
      orderBy: { id: 'asc' },
    });
    return rows.map((n) => ({
      id: Number(n.id),
      graphId: Number(n.graphId),
      code: n.code,
      name: n.name,
      parentCode: n.parentCode,
      level: n.level,
      category: n.category,
      grade: n.grade,
      chapter: n.chapter,
      section: n.section,
      difficulty: n.difficulty,
      examWeight: n.examWeight === null ? null : Number(n.examWeight),
      summary: n.summary,
    }));
  }
}
