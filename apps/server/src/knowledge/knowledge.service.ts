import { Injectable, NotFoundException } from '@nestjs/common';
import type { KpContentPackDto } from '@qiming/contracts';
import { num } from '../admin/helpers';
import { PrismaService } from '../prisma/prisma.service';
import { ContentPackInputDto } from './knowledge.dto';

/** 内容包 join 形状(回填 kpNodeName / resourceName / paperName) */
const PACK_JOIN = {
  kpNode: { select: { name: true } },
  lectureResource: { select: { name: true } },
  practicePaper: { select: { name: true } },
};

type PackRow = {
  kpNodeId: bigint;
  lectureResourceId: bigint | null;
  practicePaperId: bigint | null;
  summaryConfig: unknown;
  kpNode: { name: string };
  lectureResource: { name: string } | null;
  practicePaper: { name: string } | null;
};

/**
 * 知识点内容库(C3-back #A):每机构每知识点维护一份可复用"内容包"
 * (讲解课件 / 随堂练卷 / 小结模板)。所有查询走租户注入,他 org 节点天然 404。
 */
@Injectable()
export class KnowledgeService {
  constructor(private readonly prisma: PrismaService) {}

  /** GET /knowledge/content-packs?graphId=:某图谱下已维护的内容包列表 */
  async listByGraph(graphId: number): Promise<KpContentPackDto[]> {
    const graph = await this.prisma.client.kpGraph.findFirst({
      where: { id: BigInt(graphId) },
      select: { id: true },
    });
    if (!graph) throw new NotFoundException('图谱不存在');

    const rows = await this.prisma.client.kpContentPack.findMany({
      where: { kpNode: { graphId: graph.id } },
      include: PACK_JOIN,
      orderBy: { kpNodeId: 'asc' },
    });
    return rows.map((r) => this.toDto(r as PackRow));
  }

  /** GET /knowledge/content-packs/:kpNodeId:单个;未维护返回空包(不 404) */
  async getOne(kpNodeId: number): Promise<KpContentPackDto> {
    const node = await this.mustKpNode(kpNodeId);
    const pack = await this.prisma.client.kpContentPack.findFirst({
      where: { kpNodeId: node.id },
      include: PACK_JOIN,
    });
    if (!pack) {
      // 未维护 → 空包:lecture/practice 为 null、summaryConfig {}
      return {
        kpNodeId: num(node.id),
        kpNodeName: node.name,
        lectureResourceId: null,
        lectureResourceName: null,
        practicePaperId: null,
        practicePaperName: null,
        summaryConfig: {},
      };
    }
    return this.toDto(pack as PackRow);
  }

  /**
   * PUT /knowledge/content-packs/:kpNodeId:upsert(按 orgId+kpNodeId)。
   * 缺省字段不改、显式 null 清空;校验 kpNode/resource/paper 同 org。
   */
  async upsert(kpNodeId: number, dto: ContentPackInputDto): Promise<null> {
    const node = await this.mustKpNode(kpNodeId);
    if (dto.lectureResourceId != null) await this.mustResource(dto.lectureResourceId);
    if (dto.practicePaperId != null) await this.mustPaper(dto.practicePaperId);

    const existing = await this.prisma.client.kpContentPack.findFirst({
      where: { kpNodeId: node.id },
      select: { id: true },
    });

    if (existing) {
      await this.prisma.client.kpContentPack.update({
        where: { id: existing.id },
        data: {
          ...(dto.lectureResourceId !== undefined
            ? {
                lectureResourceId:
                  dto.lectureResourceId === null ? null : BigInt(dto.lectureResourceId),
              }
            : {}),
          ...(dto.practicePaperId !== undefined
            ? {
                practicePaperId:
                  dto.practicePaperId === null ? null : BigInt(dto.practicePaperId),
              }
            : {}),
          ...(dto.summaryConfig !== undefined ? { summaryConfig: dto.summaryConfig as object } : {}),
        },
      });
    } else {
      await this.prisma.client.kpContentPack.create({
        data: {
          kpNodeId: node.id,
          lectureResourceId:
            dto.lectureResourceId != null ? BigInt(dto.lectureResourceId) : null,
          practicePaperId: dto.practicePaperId != null ? BigInt(dto.practicePaperId) : null,
          summaryConfig: (dto.summaryConfig ?? {}) as object,
        } as never,
      });
    }
    return null;
  }

  // ---------------- 内部 ----------------

  private async mustKpNode(kpNodeId: number) {
    const node = await this.prisma.client.kpNode.findFirst({
      where: { id: BigInt(kpNodeId) },
      select: { id: true, name: true },
    });
    if (!node) throw new NotFoundException('知识点节点不存在');
    return node;
  }

  private async mustResource(id: number): Promise<void> {
    const r = await this.prisma.client.resource.findFirst({
      where: { id: BigInt(id), deletedAt: null },
      select: { id: true },
    });
    if (!r) throw new NotFoundException('讲解课件资源不存在');
  }

  private async mustPaper(id: number): Promise<void> {
    const p = await this.prisma.client.paper.findFirst({
      where: { id: BigInt(id) },
      select: { id: true },
    });
    if (!p) throw new NotFoundException('随堂练卷不存在');
  }

  private toDto(r: PackRow): KpContentPackDto {
    return {
      kpNodeId: num(r.kpNodeId),
      kpNodeName: r.kpNode.name,
      lectureResourceId: r.lectureResourceId == null ? null : num(r.lectureResourceId),
      lectureResourceName: r.lectureResource?.name ?? null,
      practicePaperId: r.practicePaperId == null ? null : num(r.practicePaperId),
      practicePaperName: r.practicePaper?.name ?? null,
      summaryConfig: (r.summaryConfig ?? {}) as Record<string, unknown>,
    };
  }
}
