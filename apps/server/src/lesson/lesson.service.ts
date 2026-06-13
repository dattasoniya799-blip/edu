import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { LessonDto, LessonSegmentDto } from '@qiming/contracts';
import { iso, num } from '../admin/helpers';
import { BizException, ERR_LESSON_CHECKLIST } from '../course/business.exception';
import { PrismaService } from '../prisma/prisma.service';
import { LessonUpdateDto, SegmentInputDto } from './lesson.dto';

/**
 * 备课检查清单(prep_checklist,自由编排口径,IMPL2):按实际存在的环节类型标记。
 * - warmup / lecture / summary:存在对应类型环节即为 true
 * - practice / homework:存在对应环节,且其中挂了 paper 的环节 paper 全部 published
 * 仅作展示;不再要求四类环节齐备。
 */
const CHECKLIST_KEYS = ['warmup', 'lecture', 'practice', 'summary', 'homework'] as const;

type SegForCheck = { type: string; paper: { status: string } | null };

@Injectable()
export class LessonService {
  constructor(private readonly prisma: PrismaService) {}

  // ---------------- 讲次 ----------------

  /** GET /courses/:id/lessons:讲次时间线 */
  async listByCourse(courseId: number): Promise<LessonDto[]> {
    const course = await this.prisma.client.course.findFirst({
      where: { id: BigInt(courseId), deletedAt: null },
    });
    if (!course) throw new NotFoundException('课程不存在');
    const rows = await this.prisma.client.lesson.findMany({
      where: { courseId: course.id },
      orderBy: { seq: 'asc' },
    });
    return rows.map((l) => this.toLessonDto(l));
  }

  /** GET /lessons/:id */
  async detail(id: number): Promise<LessonDto> {
    return this.toLessonDto(await this.findOrThrow(id));
  }

  /** PUT /lessons/:id:改标题/时间 */
  async update(id: number, dto: LessonUpdateDto): Promise<null> {
    const lesson = await this.findOrThrow(id);
    const start = dto.scheduledStart ? new Date(dto.scheduledStart) : lesson.scheduledStart;
    const end = dto.scheduledEnd ? new Date(dto.scheduledEnd) : lesson.scheduledEnd;
    if (start && end && start >= end)
      throw new BadRequestException('scheduledStart 必须早于 scheduledEnd');
    await this.prisma.client.lesson.update({
      where: { id: lesson.id },
      data: {
        ...(dto.title !== undefined ? { title: dto.title } : {}),
        ...(dto.scheduledStart !== undefined ? { scheduledStart: new Date(dto.scheduledStart) } : {}),
        ...(dto.scheduledEnd !== undefined ? { scheduledEnd: new Date(dto.scheduledEnd) } : {}),
      },
    });
    return null;
  }

  // ---------------- 编排(segments) ----------------

  /** GET /lessons/:id/segments(join kp_nodes 填 kpNodeName) */
  async getSegments(lessonId: number): Promise<LessonSegmentDto[]> {
    const lesson = await this.findOrThrow(lessonId);
    const rows = await this.prisma.client.lessonSegment.findMany({
      where: { lessonId: lesson.id },
      include: { kpNode: { select: { name: true } } },
      orderBy: { seq: 'asc' },
    });
    return rows.map((s) => ({
      id: num(s.id),
      seq: s.seq,
      type: s.type,
      durationMin: s.durationMin,
      config: (s.config ?? {}) as Record<string, unknown>,
      resourceId: s.resourceId == null ? null : num(s.resourceId),
      paperId: s.paperId == null ? null : num(s.paperId),
      kpNodeId: s.kpNodeId == null ? null : num(s.kpNodeId),
      kpNodeName: s.kpNode?.name ?? null,
    }));
  }

  /** PUT /lessons/:id/segments:全量替换(事务),并同步重算 prep_checklist */
  async replaceSegments(lessonId: number, segments: SegmentInputDto[]): Promise<null> {
    const lesson = await this.findOrThrow(lessonId);
    if (lesson.status === 'in_progress' || lesson.status === 'finished')
      throw new ConflictException('讲次已开课/已结课,不可再编排');

    // seq 不得重复
    const seqs = new Set(segments.map((s) => s.seq));
    if (seqs.size !== segments.length) throw new BadRequestException('环节 seq 不得重复');

    // 挂载约束(设计文档 §5.2):lecture 挂课件;practice/homework 挂试卷
    for (const s of segments) {
      if (s.resourceId != null && s.type !== 'lecture')
        throw new BadRequestException(`resourceId 仅 lecture 环节可挂(seq=${s.seq})`);
      if (s.paperId != null && s.type !== 'practice' && s.type !== 'homework')
        throw new BadRequestException(`paperId 仅 practice/homework 环节可挂(seq=${s.seq})`);
      this.validateConfig(s);
    }

    // 引用存在性(租户注入保证只查本 org → 跨租户即 404)
    const resourceIds = [...new Set(segments.filter((s) => s.resourceId != null).map((s) => s.resourceId!))];
    if (resourceIds.length) {
      const found = await this.prisma.client.resource.findMany({
        where: { id: { in: resourceIds.map(BigInt) }, deletedAt: null },
        select: { id: true },
      });
      if (found.length !== resourceIds.length) throw new NotFoundException('引用的课件资源不存在');
    }
    const paperIds = [...new Set(segments.filter((s) => s.paperId != null).map((s) => s.paperId!))];
    const papers = paperIds.length
      ? await this.prisma.client.paper.findMany({
          where: { id: { in: paperIds.map(BigInt) } },
          select: { id: true, status: true },
        })
      : [];
    if (papers.length !== paperIds.length) throw new NotFoundException('引用的试卷不存在');

    // 知识点节点存在性(租户注入保证只查本 org → 跨租户即 404)
    const kpNodeIds = [...new Set(segments.filter((s) => s.kpNodeId != null).map((s) => s.kpNodeId!))];
    if (kpNodeIds.length) {
      const foundNodes = await this.prisma.client.kpNode.findMany({
        where: { id: { in: kpNodeIds.map(BigInt) } },
        select: { id: true },
      });
      if (foundNodes.length !== kpNodeIds.length) throw new NotFoundException('引用的知识点节点不存在');
    }

    const paperStatus = new Map(papers.map((p) => [String(p.id), p.status]));
    const checklist = this.computeChecklist(
      segments.map((s) => ({
        type: s.type,
        paper: s.paperId != null ? { status: paperStatus.get(String(s.paperId)) ?? 'draft' } : null,
      })),
    );

    await this.prisma.client.$transaction(async (tx) => {
      await tx.lessonSegment.deleteMany({ where: { lessonId: lesson.id } });
      if (segments.length) {
        await tx.lessonSegment.createMany({
          data: segments.map((s) => ({
            lessonId: lesson.id,
            seq: s.seq,
            type: s.type,
            durationMin: s.durationMin,
            config: (s.config ?? {}) as object,
            resourceId: s.resourceId != null ? BigInt(s.resourceId) : null,
            paperId: s.paperId != null ? BigInt(s.paperId) : null,
            kpNodeId: s.kpNodeId != null ? BigInt(s.kpNodeId) : null,
          })) as never,
        });
      }
      await tx.lesson.update({ where: { id: lesson.id }, data: { prepChecklist: checklist } });
    });
    return null;
  }

  // ---------------- 发布 ----------------

  /**
   * POST /lessons/:id/publish(自由编排口径,IMPL2):
   * 不再要求四类环节齐备。硬规则:① 至少 1 个环节;② practice/homework 环节若挂了 paper,
   * 该 paper 必须 published。违反 → 4201 + 缺失项(empty / practice / homework),prep_checklist 同步落库;
   * 通过 → status=ready。
   */
  async publish(id: number): Promise<null> {
    const lesson = await this.findOrThrow(id);
    if (lesson.status === 'in_progress' || lesson.status === 'finished')
      throw new ConflictException('讲次已开课/已结课,无法发布');

    const segs = await this.prisma.client.lessonSegment.findMany({
      where: { lessonId: lesson.id },
      include: { paper: { select: { status: true } } },
    });
    const checklist = this.computeChecklist(segs);

    const missing: string[] = [];
    if (segs.length === 0) missing.push('empty');
    for (const t of ['practice', 'homework'] as const) {
      const hasUnpublished = segs.some(
        (s) => s.type === t && s.paper != null && s.paper.status !== 'published',
      );
      if (hasUnpublished) missing.push(t);
    }

    if (missing.length) {
      await this.prisma.client.lesson.update({
        where: { id: lesson.id },
        data: { prepChecklist: checklist },
      });
      throw new BizException(ERR_LESSON_CHECKLIST, '备课检查未通过,存在缺失项', missing);
    }
    await this.prisma.client.lesson.update({
      where: { id: lesson.id },
      data: { status: 'ready', prepChecklist: checklist },
    });
    return null;
  }

  // ---------------- 内部 ----------------

  private async findOrThrow(id: number) {
    const l = await this.prisma.client.lesson.findFirst({ where: { id: BigInt(id) } });
    if (!l) throw new NotFoundException('讲次不存在');
    return l;
  }

  private computeChecklist(segs: SegForCheck[]): Record<(typeof CHECKLIST_KEYS)[number], boolean> {
    const has = (t: string) => segs.some((s) => s.type === t);
    // 自由编排:存在该类型环节,且其中挂了 paper 的环节 paper 均已 published(无 paper 不阻塞)
    const paperReady = (t: string) => {
      const list = segs.filter((s) => s.type === t);
      return list.length > 0 && list.every((s) => s.paper == null || s.paper.status === 'published');
    };
    return {
      warmup: has('warmup'),
      lecture: has('lecture'),
      practice: paperReady('practice'),
      summary: has('summary'),
      homework: paperReady('homework'),
    };
  }

  /** config 轻量形状校验(设计文档 §5.2 约定;键可省略,出现则类型必须正确) */
  private validateConfig(s: SegmentInputDto) {
    const c = (s.config ?? {}) as Record<string, unknown>;
    const bad = (msg: string) => new BadRequestException(`环节 config 不合法(seq=${s.seq}):${msg}`);
    if (s.type === 'warmup') {
      if ('count' in c && (!Number.isInteger(c.count) || (c.count as number) < 1))
        throw bad('warmup.count 须为正整数');
      if ('source' in c && typeof c.source !== 'string') throw bad('warmup.source 须为字符串');
    } else if (s.type === 'lecture') {
      if ('checkpoints' in c && !Array.isArray(c.checkpoints)) throw bad('lecture.checkpoints 须为数组');
    } else if (s.type === 'practice') {
      if ('ai_guide' in c && typeof c.ai_guide !== 'boolean') throw bad('practice.ai_guide 须为布尔');
      if ('stuck_alert_min' in c && (!Number.isInteger(c.stuck_alert_min) || (c.stuck_alert_min as number) < 1))
        throw bad('practice.stuck_alert_min 须为正整数');
    } else if (s.type === 'summary') {
      if ('personal_consolidation' in c && (typeof c.personal_consolidation !== 'object' || c.personal_consolidation == null))
        throw bad('summary.personal_consolidation 须为对象');
    }
  }

  private toLessonDto(l: {
    id: bigint;
    courseId: bigint;
    seq: number;
    title: string;
    scheduledStart: Date | null;
    scheduledEnd: Date | null;
    status: LessonDto['status'];
    prepChecklist: unknown;
  }): LessonDto {
    return {
      id: num(l.id),
      courseId: num(l.courseId),
      seq: l.seq,
      title: l.title,
      scheduledStart: iso(l.scheduledStart),
      scheduledEnd: iso(l.scheduledEnd),
      status: l.status,
      prepChecklist: (l.prepChecklist ?? {}) as Record<string, boolean>,
    };
  }
}
