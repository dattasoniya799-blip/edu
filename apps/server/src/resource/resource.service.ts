import { Injectable, NotFoundException } from '@nestjs/common';
import type { PageResp, ResourceDto } from '@qiming/contracts';
import { iso, num } from '../admin/helpers';
import type { JwtUser } from '../auth/auth.service';
import { BizException, ERR_RESOURCE_IN_USE } from '../course/business.exception';
import { PrismaService } from '../prisma/prisma.service';
import { ResourceCreateDto, ResourceListQueryDto, ResourceUpdateDto } from './resource.dto';

const SEGMENT_JOIN = {
  segments: { include: { lesson: { select: { id: true, title: true } } } },
  // C3-back #A:回填知识点名称(可空标签)
  kpNode: { select: { name: true } },
};

/**
 * 资源库 CRUD(任务卡 A4):
 * - usedByLessons = lesson_segments.resource_id 反查(去重)
 * - 被讲次引用 → 禁删(业务码 4303,detail 带引用讲次);删除为软删
 */
@Injectable()
export class ResourceService {
  constructor(private readonly prisma: PrismaService) {}

  async list(q: ResourceListQueryDto): Promise<PageResp<ResourceDto>> {
    const page = q.page ?? 1;
    const size = q.size ?? 20;
    const where = {
      deletedAt: null,
      ...(q.type ? { type: q.type } : {}),
      ...(q.keyword ? { name: { contains: q.keyword } } : {}),
      ...(q.kpNodeId != null ? { kpNodeId: BigInt(q.kpNodeId) } : {}), // C3-back #A:按知识点归档过滤
    };
    const [total, rows] = await Promise.all([
      this.prisma.client.resource.count({ where }),
      this.prisma.client.resource.findMany({
        where,
        include: SEGMENT_JOIN,
        orderBy: { id: 'desc' },
        skip: (page - 1) * size,
        take: size,
      }),
    ]);
    return { items: rows.map((r) => this.toDto(r)), total };
  }

  async create(user: JwtUser, dto: ResourceCreateDto): Promise<ResourceDto> {
    if (dto.kpNodeId != null) await this.mustKpNode(dto.kpNodeId);
    const created = await this.prisma.client.resource.create({
      data: {
        ownerId: BigInt(user.uid),
        type: dto.type,
        name: dto.name,
        ossKey: dto.ossKey,
        size: BigInt(dto.size),
        meta: (dto.meta ?? {}) as object,
        kpNodeId: dto.kpNodeId != null ? BigInt(dto.kpNodeId) : null, // C3-back #A
      } as never,
      include: SEGMENT_JOIN,
    });
    return this.toDto(created);
  }

  async update(id: number, dto: ResourceUpdateDto): Promise<null> {
    const r = await this.findOrThrow(id);
    // C3-back #A:kpNodeId 缺省不改、显式 null 清空、给值则校验同 org 存在
    if (dto.kpNodeId != null) await this.mustKpNode(dto.kpNodeId);
    await this.prisma.client.resource.update({
      where: { id: r.id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.meta !== undefined ? { meta: dto.meta as object } : {}),
        ...(dto.kpNodeId !== undefined
          ? { kpNodeId: dto.kpNodeId === null ? null : BigInt(dto.kpNodeId) }
          : {}),
      },
    });
    return null;
  }

  /** DELETE /resources/:id:被讲次引用 → 4303;否则软删 */
  async remove(id: number): Promise<null> {
    const r = await this.findOrThrow(id);
    const usedBy = this.usedByLessons(r.segments);
    if (usedBy.length > 0)
      throw new BizException(ERR_RESOURCE_IN_USE, '资源已被讲次引用,禁止删除', usedBy);
    await this.prisma.client.resource.update({
      where: { id: r.id },
      data: { deletedAt: new Date() },
    });
    return null;
  }

  // ---------------- 内部 ----------------

  private async findOrThrow(id: number) {
    const r = await this.prisma.client.resource.findFirst({
      where: { id: BigInt(id), deletedAt: null },
      include: SEGMENT_JOIN,
    });
    if (!r) throw new NotFoundException('资源不存在');
    return r;
  }

  /** C3-back #A:知识点存在性(租户注入保证同 org;跨租户/不存在 → 404) */
  private async mustKpNode(kpNodeId: number): Promise<void> {
    const node = await this.prisma.client.kpNode.findFirst({
      where: { id: BigInt(kpNodeId) },
      select: { id: true },
    });
    if (!node) throw new NotFoundException('知识点节点不存在');
  }

  private usedByLessons(
    segments: { lesson: { id: bigint; title: string } }[],
  ): { lessonId: number; lessonTitle: string }[] {
    const seen = new Map<number, string>();
    for (const s of segments) seen.set(num(s.lesson.id), s.lesson.title);
    return [...seen.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([lessonId, lessonTitle]) => ({ lessonId, lessonTitle }));
  }

  private toDto(r: Awaited<ReturnType<ResourceService['findOrThrow']>>): ResourceDto {
    return {
      id: num(r.id),
      type: r.type,
      name: r.name,
      ossKey: r.ossKey,
      size: Number(r.size),
      meta: (r.meta ?? {}) as Record<string, unknown>,
      usedByLessons: this.usedByLessons(r.segments),
      kpNodeId: r.kpNodeId == null ? null : num(r.kpNodeId), // C3-back #A
      kpNodeName: r.kpNode?.name ?? null,
      createdAt: iso(r.createdAt),
    };
  }
}
