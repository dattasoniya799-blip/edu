import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { PageResp, QuestionAnswer, QuestionDto, QuestionFigure } from '@qiming/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { BusinessException, ERR_QUESTION_IN_PAPER } from './business.exception';
import { QuestionInputDto, QuestionListQueryDto } from './question.dto';

/** JWT 用户(与 JwtAuthGuard 写入 request.user 的结构一致) */
export interface JwtUser {
  uid: number;
  orgId: number;
  role: 'admin' | 'teacher' | 'student';
}

const QUERY_INCLUDE = {
  options: { orderBy: { label: 'asc' as const } },
  tags: { include: { node: { include: { graph: true } } } },
  _count: { select: { paperItems: true } },
};

@Injectable()
export class QuestionService {
  constructor(private readonly prisma: PrismaService) {}

  // ---------------- 校验(任务卡 A3:create/put 共用) ----------------

  /** 选择题 options 必填且正确项数量合法;解答题 rubric 必填;tagNodeIds 至少含 1 个教材知识点 */
  private async validateInput(dto: QuestionInputDto) {
    const isChoice = dto.type === 'single' || dto.type === 'multi';
    const options = dto.options ?? [];

    this.validateFigures(dto);

    if (isChoice) {
      if (options.length < 2) throw new BadRequestException('选择题 options 必填且至少 2 项');
      const labels = new Set(options.map((o) => o.label));
      if (labels.size !== options.length) throw new BadRequestException('选项 label 不得重复');
      const correct = options.filter((o) => o.isCorrect === true).length;
      if (dto.type === 'single' && correct !== 1)
        throw new BadRequestException('单选题必须恰有 1 个正确选项');
      if (dto.type === 'multi' && correct < 2)
        throw new BadRequestException('多选题至少 2 个正确选项');
    } else if (options.length > 0) {
      throw new BadRequestException('该题型不支持 options');
    }

    // 答案形状与题型匹配
    const a = dto.answer as Record<string, unknown>;
    const shapeOk =
      dto.type === 'single'
        ? typeof a.choice === 'string' && a.choice !== ''
        : dto.type === 'multi'
          ? Array.isArray(a.choices) && a.choices.length > 0
          : dto.type === 'blank'
            ? Array.isArray(a.texts) && a.texts.length > 0
            : typeof a.referenceLatex === 'string' && a.referenceLatex !== '';
    if (!shapeOk) throw new BadRequestException('answer 与题型不匹配');

    if (dto.type === 'solution' && (dto.rubric ?? []).length === 0)
      throw new BadRequestException('解答题 rubric(评分细则)必填');

    const tagNodeIds = dto.tagNodeIds ?? [];
    if (tagNodeIds.length === 0)
      throw new BadRequestException('tagNodeIds 必填,至少含 1 个教材知识点');
    const nodes = await this.prisma.client.kpNode.findMany({
      where: { id: { in: tagNodeIds.map((n) => BigInt(n)) } },
      include: { graph: true },
    });
    if (nodes.length !== new Set(tagNodeIds).size)
      throw new BadRequestException('tagNodeIds 含不存在的图谱节点');
    if (!nodes.some((n) => n.graph.graphType === 'curriculum_knowledge'))
      throw new BadRequestException('tagNodeIds 至少需包含 1 个教材知识点(curriculum_knowledge)');
  }

  /**
   * 题目插图 anchor 校验(方案A,2026-06-13):
   * - anchor.target 必在 {stem,option,analysis,reference,rubric}(枚举由 DTO 的 @IsIn 把关)
   * - target=option → ref 必须匹配某选项 label
   * - target=rubric → ref 必须匹配某 rubric step(数值,以字符串传入)
   * - 缺省 anchor 视为题干(向后兼容),不校验
   */
  private validateFigures(dto: QuestionInputDto) {
    const figures = dto.figures ?? [];
    const optionLabels = new Set((dto.options ?? []).map((o) => o.label));
    const rubricSteps = new Set((dto.rubric ?? []).map((r) => String(r.step)));
    for (const fig of figures) {
      const anchor = fig.anchor;
      if (!anchor) continue; // 缺省 = 题干
      if (anchor.target === 'option') {
        if (anchor.ref == null || !optionLabels.has(anchor.ref))
          throw new BadRequestException(`插图 anchor.ref="${anchor.ref}" 不匹配任何选项 label`);
      } else if (anchor.target === 'rubric') {
        if (anchor.ref == null || !rubricSteps.has(String(anchor.ref)))
          throw new BadRequestException(`插图 anchor.ref="${anchor.ref}" 不匹配任何 rubric step`);
      }
      // stem / analysis / reference:ref 可选,不校验
    }
  }

  /** 仅 owner 或 admin 可改/删/发布 */
  private assertOwnerOrAdmin(user: JwtUser, ownerId: bigint) {
    if (user.role !== 'admin' && Number(ownerId) !== user.uid)
      throw new ForbiddenException('仅题目创建者或管理员可操作');
  }

  private async findOrThrow(id: number) {
    const q = await this.prisma.client.question.findFirst({
      where: { id: BigInt(id), deletedAt: null },
      include: QUERY_INCLUDE,
    });
    if (!q) throw new NotFoundException('题目不存在');
    return q;
  }

  // ---------------- CRUD ----------------

  /** POST /questions:录题,存为草稿 */
  async create(user: JwtUser, dto: QuestionInputDto): Promise<QuestionDto> {
    await this.validateInput(dto);
    const created = await this.prisma.client.$transaction(async (tx) => {
      const q = await tx.question.create({
        data: {
          ownerId: BigInt(user.uid),
          type: dto.type,
          stage: dto.stage,
          subject: dto.subject,
          textbookVersion: dto.textbookVersion ?? null,
          chapter: dto.chapter ?? null,
          stemLatex: dto.stemLatex,
          figures: (dto.figures ?? []) as object[],
          answer: dto.answer as object,
          rubric: (dto.rubric ?? []) as unknown as object[],
          analysisLatex: dto.analysisLatex ?? null,
          analysisBriefLatex: dto.analysisBriefLatex ?? null,
          analysisDetailLatex: dto.analysisDetailLatex ?? null,
          difficulty: dto.difficulty ?? 2,
          status: 'draft',
        } as never,
      });
      await this.writeRelations(tx, q.id, dto);
      return q;
    });
    return this.detail(user, Number(created.id));
  }

  /** 选项与三维标签全量写入(create/put 共用;orgId 由租户注入自动填充) */
  private async writeRelations(
    tx: Pick<PrismaService['client'], 'questionOption' | 'questionTag'>,
    questionId: bigint,
    dto: QuestionInputDto,
  ) {
    if ((dto.options ?? []).length > 0) {
      await tx.questionOption.createMany({
        data: (dto.options ?? []).map((o) => ({
          questionId,
          label: o.label,
          contentLatex: o.contentLatex,
          isCorrect: o.isCorrect === true,
        })) as never,
      });
    }
    // FIX4 · #6:tagNodeIds 先去重再插入,避免 [x,x] 触发 (question_id,node_id) 唯一约束 → 500
    await tx.questionTag.createMany({
      data: [...new Set(dto.tagNodeIds ?? [])].map((nodeId) => ({
        questionId,
        nodeId: BigInt(nodeId),
      })) as never,
    });
  }

  /** GET /questions:分页 + 过滤(软删不可见) */
  async list(user: JwtUser, q: QuestionListQueryDto): Promise<PageResp<QuestionDto>> {
    const page = q.page ?? 1;
    const size = q.size ?? 20;
    const where = {
      deletedAt: null,
      ...(q.subject ? { subject: q.subject } : {}),
      ...(q.type ? { type: q.type } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.difficulty ? { difficulty: q.difficulty } : {}),
      ...(q.tagNodeId ? { tags: { some: { nodeId: BigInt(q.tagNodeId) } } } : {}),
      ...(q.keyword
        ? { OR: [{ stemLatex: { contains: q.keyword } }, { chapter: { contains: q.keyword } }] }
        : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.client.question.count({ where }),
      this.prisma.client.question.findMany({
        where,
        include: QUERY_INCLUDE,
        orderBy: { id: 'desc' },
        skip: (page - 1) * size,
        take: size,
      }),
    ]);
    const names = await this.ownerNames(rows.map((r) => r.ownerId));
    return { items: rows.map((r) => this.toDto(r, names)), total };
  }

  /** GET /questions/:id */
  async detail(_user: JwtUser, id: number): Promise<QuestionDto> {
    const q = await this.findOrThrow(id);
    const names = await this.ownerNames([q.ownerId]);
    return this.toDto(q, names);
  }

  /** PUT /questions/:id:全量替换(仅 owner 或 admin) */
  async update(user: JwtUser, id: number, dto: QuestionInputDto): Promise<null> {
    const q = await this.findOrThrow(id);
    this.assertOwnerOrAdmin(user, q.ownerId);
    await this.validateInput(dto);
    await this.prisma.client.$transaction(async (tx) => {
      await tx.question.update({
        where: { id: q.id },
        data: {
          type: dto.type,
          stage: dto.stage,
          subject: dto.subject,
          textbookVersion: dto.textbookVersion ?? null,
          chapter: dto.chapter ?? null,
          stemLatex: dto.stemLatex,
          figures: (dto.figures ?? []) as object[],
          answer: dto.answer as object,
          rubric: (dto.rubric ?? []) as unknown as object[],
          analysisLatex: dto.analysisLatex ?? null,
          analysisBriefLatex: dto.analysisBriefLatex ?? null,
          analysisDetailLatex: dto.analysisDetailLatex ?? null,
          difficulty: dto.difficulty ?? 2,
        },
      });
      await tx.questionOption.deleteMany({ where: { questionId: q.id } });
      await tx.questionTag.deleteMany({ where: { questionId: q.id } });
      await this.writeRelations(tx, q.id, dto);
    });
    return null;
  }

  /** POST /questions/:id/publish:草稿 → published */
  async publish(user: JwtUser, id: number): Promise<null> {
    const q = await this.findOrThrow(id);
    this.assertOwnerOrAdmin(user, q.ownerId);
    if (q.status !== 'draft') throw new BadRequestException('仅草稿状态的题目可入库');
    await this.prisma.client.question.update({ where: { id: q.id }, data: { status: 'published' } });
    return null;
  }

  /** DELETE /questions/:id:软删;被试卷引用 → 业务码 4301(HTTP 409) */
  async remove(user: JwtUser, id: number): Promise<null> {
    const q = await this.findOrThrow(id);
    this.assertOwnerOrAdmin(user, q.ownerId);
    const used = await this.prisma.client.paperQuestion.count({ where: { questionId: q.id } });
    if (used > 0)
      throw new BusinessException(ERR_QUESTION_IN_PAPER, '题目已被试卷引用,不可删除');
    await this.prisma.client.question.update({
      where: { id: q.id },
      data: { deletedAt: new Date() },
    });
    return null;
  }

  // ---------------- 映射 ----------------

  private async ownerNames(ownerIds: bigint[]): Promise<Map<string, string>> {
    const ids = [...new Set(ownerIds.map((i) => i.toString()))];
    if (ids.length === 0) return new Map();
    const users = await this.prisma.client.user.findMany({
      where: { id: { in: ids.map((i) => BigInt(i)) } },
      select: { id: true, name: true },
    });
    return new Map(users.map((u) => [u.id.toString(), u.name]));
  }

  private toDto(
    q: Awaited<ReturnType<QuestionService['findOrThrow']>>,
    names: Map<string, string>,
  ): QuestionDto {
    const stats = (q.stats ?? {}) as { correctRate?: number };
    return {
      id: Number(q.id),
      type: q.type,
      stage: q.stage,
      subject: q.subject,
      textbookVersion: q.textbookVersion,
      chapter: q.chapter,
      stemLatex: q.stemLatex,
      // figures 是题目级 Json,原样返回(含 anchor;缺省 anchor 由读取端视为题干)
      figures: (q.figures ?? []) as unknown as QuestionFigure[],
      options: q.options.map((o) => ({
        label: o.label,
        contentLatex: o.contentLatex,
        isCorrect: o.isCorrect, // 教师端视图;学生视图不下发(学生角色无法访问本域接口)
      })),
      answer: (q.answer ?? null) as QuestionAnswer | null,
      rubric: (q.rubric ?? []) as unknown as QuestionDto['rubric'],
      analysisLatex: q.analysisLatex,
      analysisBriefLatex: q.analysisBriefLatex,
      analysisDetailLatex: q.analysisDetailLatex,
      difficulty: q.difficulty,
      status: q.status,
      tags: q.tags.map((t) => ({
        nodeId: Number(t.nodeId),
        graphType: t.node.graph.graphType,
        code: t.node.code,
        name: t.node.name,
      })),
      stats: { correctRate: stats.correctRate ?? null, usedInPapers: q._count.paperItems },
      ownerName: names.get(q.ownerId.toString()) ?? '',
      createdAt: q.createdAt.toISOString(),
    };
  }
}
