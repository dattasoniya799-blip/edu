import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { PageResp, PaperDto } from '@qiming/contracts';
import { num } from '../admin/helpers';
import type { JwtUser } from '../auth/auth.service';
import { BizException, ERR_PAPER_ASSIGNED } from '../course/business.exception';
import { PrismaService } from '../prisma/prisma.service';
import { PaperInputDto, PaperListQueryDto } from './paper.dto';

const QUESTION_JOIN = {
  questions: {
    orderBy: { seq: 'asc' as const },
    include: { question: { select: { type: true, stemLatex: true } } },
  },
};

/**
 * 试卷(任务卡 A4):
 * - 创建/改题服务端重算 totalScore(= Σ score,不信任客户端)
 * - 契约无 /papers/:id/publish 端点 → 创建即 status=published(可被编排/作业引用);
 *   schema 的 draft 状态保留给后续流程(如 AI 组卷草稿)
 * - 已被 assignment 引用 → 禁改(业务码 4302)
 */
@Injectable()
export class PaperService {
  constructor(private readonly prisma: PrismaService) {}

  async list(q: PaperListQueryDto): Promise<PageResp<PaperDto>> {
    const page = q.page ?? 1;
    const size = q.size ?? 20;
    const where = { ...(q.type ? { type: q.type } : {}) };
    const [total, rows] = await Promise.all([
      this.prisma.client.paper.count({ where }),
      this.prisma.client.paper.findMany({
        where,
        include: QUESTION_JOIN,
        orderBy: { id: 'desc' },
        skip: (page - 1) * size,
        take: size,
      }),
    ]);
    return { items: rows.map((p) => this.toDto(p)), total };
  }

  async create(user: JwtUser, dto: PaperInputDto): Promise<PaperDto> {
    await this.validateQuestions(dto);
    const totalScore = this.sumScore(dto);
    const created = await this.prisma.client.$transaction(async (tx) => {
      const paper = await tx.paper.create({
        data: {
          creatorId: BigInt(user.uid),
          name: dto.name,
          type: dto.type,
          totalScore,
          status: 'published',
        } as never,
      });
      await tx.paperQuestion.createMany({
        data: dto.questions.map((it, i) => ({
          paperId: paper.id,
          questionId: BigInt(it.questionId),
          seq: i + 1,
          score: it.score,
        })) as never,
      });
      return paper;
    });
    return this.detail(num(created.id));
  }

  async detail(id: number): Promise<PaperDto> {
    return this.toDto(await this.findOrThrow(id));
  }

  /** PUT /papers/:id:增删题/调分,重算 totalScore;已被 assignment 引用 → 4302 */
  async update(user: JwtUser, id: number, dto: PaperInputDto): Promise<null> {
    const paper = await this.findOrThrow(id);
    // 归属写校验:仅创建者本人或 admin 可改,否则 403
    if (user.role !== 'admin' && num(paper.creatorId) !== user.uid)
      throw new ForbiddenException('无权修改他人创建的试卷');
    const assigned = await this.prisma.client.assignment.count({ where: { paperId: paper.id } });
    if (assigned > 0)
      throw new BizException(ERR_PAPER_ASSIGNED, '试卷已被作业引用,禁止修改', {
        assignmentCount: assigned,
      });
    await this.validateQuestions(dto);
    await this.prisma.client.$transaction(async (tx) => {
      await tx.paperQuestion.deleteMany({ where: { paperId: paper.id } });
      await tx.paperQuestion.createMany({
        data: dto.questions.map((it, i) => ({
          paperId: paper.id,
          questionId: BigInt(it.questionId),
          seq: i + 1,
          score: it.score,
        })) as never,
      });
      await tx.paper.update({
        where: { id: paper.id },
        data: { name: dto.name, type: dto.type, totalScore: this.sumScore(dto) },
      });
    });
    return null;
  }

  // ---------------- 内部 ----------------

  private sumScore(dto: PaperInputDto): number {
    return dto.questions.reduce((s, it) => s + it.score, 0);
  }

  private async validateQuestions(dto: PaperInputDto) {
    const ids = dto.questions.map((it) => it.questionId);
    if (new Set(ids).size !== ids.length) throw new BadRequestException('同一题目不能重复加入试卷');
    const found = await this.prisma.client.question.count({
      where: { id: { in: ids.map(BigInt) }, deletedAt: null },
    });
    if (found !== ids.length) throw new NotFoundException('题目不存在');
  }

  private async findOrThrow(id: number) {
    const p = await this.prisma.client.paper.findFirst({
      where: { id: BigInt(id) },
      include: QUESTION_JOIN,
    });
    if (!p) throw new NotFoundException('试卷不存在');
    return p;
  }

  private toDto(p: Awaited<ReturnType<PaperService['findOrThrow']>>): PaperDto {
    return {
      id: num(p.id),
      name: p.name,
      type: p.type,
      totalScore: Number(p.totalScore),
      status: p.status,
      questions: p.questions.map((it) => ({
        seq: it.seq,
        questionId: num(it.questionId),
        score: Number(it.score),
        type: it.question.type,
        stemLatex: it.question.stemLatex,
      })),
    };
  }
}
