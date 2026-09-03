import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { PageResp, PaperDto } from '@qiming/contracts';
import { num } from '../admin/helpers';
import type { JwtUser } from '../auth/auth.service';
import { BizException, ERR_PAPER_ASSIGNED } from '../course/business.exception';
import { PrismaService } from '../prisma/prisma.service';
import { PaperInputDto, PaperListQueryDto } from './paper.dto';

/**
 * 卷内题目 join:题型 / 题干(出参)+ 学科 + 教材知识点标注(2026-09-02 起聚合 subject / kpNodes,
 * 见 packages/contracts/CHANGELOG 2026-09-02:不落列,读时推导)。
 */
const QUESTION_JOIN = {
  questions: {
    orderBy: { seq: 'asc' as const },
    include: {
      question: {
        select: {
          type: true,
          stemLatex: true,
          subject: true,
          tags: {
            where: { node: { graph: { graphType: 'curriculum_knowledge' as const } } },
            select: { node: { select: { id: true, name: true } } },
          },
        },
      },
    },
  },
};

type PaperRow = {
  id: bigint;
  name: string;
  type: PaperDto['type'];
  totalScore: unknown;
  status: string;
  questions: {
    seq: number;
    questionId: bigint;
    score: unknown;
    question: {
      type: PaperDto['questions'][number]['type'];
      stemLatex: string;
      subject: string;
      tags: { node: { id: bigint; name: string } }[];
    };
  }[];
};

/**
 * 试卷(任务卡 A4;2026-09-02 走查修复 A-2 / F-6):
 * - 创建/改题服务端重算 totalScore(= Σ score,不信任客户端)
 * - status:缺省 published(向后兼容);可存 draft,经 POST /papers/:id/publish 转正。
 *   草稿不可被编排 practice/homework 引用(LessonService 发布检查 4201 照旧)、不可布置作业(AssignmentService 校验)
 * - subject / kpNodes 只读聚合:学科取卷内题目学科的众数(全一致即该学科;空卷 null),知识点为教材标注去重
 * - 已被 assignment 引用 → 禁改(业务码 4302)
 */
@Injectable()
export class PaperService {
  constructor(private readonly prisma: PrismaService) {}

  async list(q: PaperListQueryDto): Promise<PageResp<PaperDto>> {
    const page = q.page ?? 1;
    const size = q.size ?? 20;
    const where = {
      ...(q.type ? { type: q.type } : {}),
      ...(q.status ? { status: q.status } : {}),
      // kpNodeId:卷内任一题带该知识点标注
      ...(q.kpNodeId != null ? { questions: { some: { question: { tags: { some: { nodeId: BigInt(q.kpNodeId) } } } } } } : {}),
    };
    if (q.subject) {
      // 学科是聚合值(众数),不能直接 where;先按「卷内含该学科题」缩小候选,再在内存按聚合结果精确过滤后分页。
      // 试卷量级为机构内百级,可接受;量级上来后改为落列。
      const candidates = await this.prisma.client.paper.findMany({
        where: { ...where, questions: { some: { question: { subject: q.subject } } } },
        include: QUESTION_JOIN,
        orderBy: { id: 'desc' },
      });
      const matched = candidates.map((p) => this.toDto(p as PaperRow)).filter((p) => p.subject === q.subject);
      return { items: matched.slice((page - 1) * size, page * size), total: matched.length };
    }
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
    return { items: rows.map((p) => this.toDto(p as PaperRow)), total };
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
          status: dto.status ?? 'published',
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
    this.assertOwner(user, paper.creatorId);
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
        data: {
          name: dto.name,
          type: dto.type,
          totalScore: this.sumScore(dto),
          // PUT 带 status 才改(如草稿直接改为 published);不带保持原状
          ...(dto.status ? { status: dto.status } : {}),
        },
      });
    });
    return null;
  }

  /** POST /papers/:id/publish:draft → published;已 published 幂等;创建者本人或 admin */
  async publish(user: JwtUser, id: number): Promise<null> {
    const paper = await this.findOrThrow(id);
    this.assertOwner(user, paper.creatorId);
    if (paper.status !== 'published') {
      await this.prisma.client.paper.update({ where: { id: paper.id }, data: { status: 'published' } });
    }
    return null;
  }

  // ---------------- 内部 ----------------

  /** 归属写校验:仅创建者本人或 admin 可改,否则 403 */
  private assertOwner(user: JwtUser, creatorId: bigint) {
    if (user.role !== 'admin' && num(creatorId) !== user.uid)
      throw new ForbiddenException('无权修改他人创建的试卷');
  }

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

  /** 卷内题目学科众数(全一致即该学科;并列取先出现者;空卷 null) */
  static aggregateSubject(subjects: string[]): string | null {
    if (!subjects.length) return null;
    const count = new Map<string, number>();
    for (const s of subjects) count.set(s, (count.get(s) ?? 0) + 1);
    let best: string | null = null;
    let bestN = 0;
    for (const [s, n] of count) if (n > bestN) { best = s; bestN = n; }
    return best;
  }

  private toDto(p: PaperRow): PaperDto {
    const kpMap = new Map<number, string>();
    for (const it of p.questions) for (const t of it.question.tags) kpMap.set(num(t.node.id), t.node.name);
    return {
      id: num(p.id),
      name: p.name,
      type: p.type,
      totalScore: Number(p.totalScore),
      status: p.status,
      subject: PaperService.aggregateSubject(p.questions.map((it) => it.question.subject)),
      kpNodes: [...kpMap.entries()].map(([id, name]) => ({ id, name })),
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
