import { Injectable, NotFoundException } from '@nestjs/common';
import type { AssignmentDto, AssignmentKind, PageResp, WrongBookItemDto } from '@qiming/contracts';
import { dec, iso, num } from '../admin/helpers';
import { AssignmentService } from '../assignment/assignment.service';
import type { JwtUser } from '../auth/auth.service';
import { BizException, ERR_WRONG_NOT_REDOABLE } from '../grading/business.exception';
import { PrismaService } from '../prisma/prisma.service';
import { WrongBookQueryDto } from './wrongbook.dto';

/** finalize 错题入账的单题视图(由 GradingService 组装) */
export interface AccountItem {
  answerId: bigint;
  questionId: bigint;
  /** 客观题判定(主观题为 null) */
  isCorrect: boolean | null;
  /** 主观题复核分(客观题为 null) */
  finalScore: number | null;
  /** 卷面满分(paper_questions.score) */
  fullScore: number;
  type: string;
  /** 是否走复核管线(solution / 公式填空)→ 对错由 finalScore 判;否则由 isCorrect 判 */
  needsReview: boolean;
  /** AI 预批错因(主观题 / 公式填空) */
  errorTags: string[];
}

/** redo 类作业(答对累计 correct_redo_count) */
const REDO_KINDS: AssignmentKind[] = ['wrong_redo', 'correction'];

/**
 * 错题本(任务卡 A5):
 * - finalize 入账:错 → upsert(再错 wrong_count+1、重置进度并 re-open);
 *   redo 类作业答对 → correct_redo_count+1,达 2 → cleared
 * - 主观题对错口径:final_score 是否拿满卷面分;客观题用 is_correct
 * - redo / redo-all:按错题生成 practice paper + wrong_redo assignment(scoreCounted=false,
 *   经 A4 AssignmentService.create 复用 target 解析口径)
 */
@Injectable()
export class WrongBookService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly assignments: AssignmentService,
  ) {}

  /** GET /student/wrong-book */
  async list(user: JwtUser, q: WrongBookQueryDto): Promise<PageResp<WrongBookItemDto>> {
    const page = q.page ?? 1;
    const size = q.size ?? 20;
    const where = { studentId: BigInt(user.uid), ...(q.status ? { status: q.status } : {}) };
    const [total, rows] = await Promise.all([
      this.prisma.client.wrongBookEntry.count({ where }),
      this.prisma.client.wrongBookEntry.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: (page - 1) * size,
        take: size,
        include: {
          sourceAnswer: {
            select: { attempt: { select: { assignment: { select: { paper: { select: { name: true } } } } } } },
          },
        },
      }),
    ]);
    const qIds = [...new Set(rows.map((r) => r.questionId))];
    const questions = qIds.length
      ? await this.prisma.client.question.findMany({
          where: { id: { in: qIds } },
          select: { id: true, type: true, subject: true, stemLatex: true, analysisLatex: true },
        })
      : [];
    const qMap = new Map(questions.map((it) => [String(it.id), it]));
    return {
      items: rows.map((r) => {
        const question = qMap.get(String(r.questionId));
        return {
          id: num(r.id),
          questionId: num(r.questionId),
          type: (question?.type ?? 'single') as WrongBookItemDto['type'],
          stemLatex: question?.stemLatex ?? '',
          analysisLatex: question?.analysisLatex ?? null,
          wrongCount: r.wrongCount,
          correctRedoCount: r.correctRedoCount,
          errorTags: (r.errorTags as string[]) ?? [],
          status: r.status,
          sourceName: r.sourceAnswer.attempt.assignment.paper.name,
          createdAt: iso(r.createdAt),
          subject: question?.subject ?? '', // [2026-06-13] 错题本按学科分组,源自题目 subject
        };
      }),
      total,
    };
  }

  /** POST /student/wrong-book/:id/redo —— 单题重做 */
  async redo(user: JwtUser, entryId: number): Promise<AssignmentDto> {
    const entry = await this.prisma.client.wrongBookEntry.findFirst({
      where: { id: BigInt(entryId), studentId: BigInt(user.uid) },
    });
    if (!entry) throw new NotFoundException('错题不存在');
    if (entry.status !== 'open')
      throw new BizException(ERR_WRONG_NOT_REDOABLE, '该错题已清除,无需重做');
    return this.buildRedoAssignment(user, [entry], `错题重做 · 第${entryId}号`);
  }

  /** POST /student/wrong-book/redo-all —— 一键重练全部 open 错题 */
  async redoAll(user: JwtUser): Promise<AssignmentDto> {
    const entries = await this.prisma.client.wrongBookEntry.findMany({
      where: { studentId: BigInt(user.uid), status: 'open' },
      orderBy: { id: 'asc' },
    });
    if (!entries.length) throw new BizException(ERR_WRONG_NOT_REDOABLE, '当前没有未清除的错题');
    return this.buildRedoAssignment(user, entries, '错题重练卷');
  }

  /**
   * finalize 错题入账(GradingService.finalizeAttempt 调用,事务外幂等靠
   * attempt 状态机保证只入账一次):
   * - 错(客观 is_correct=false / 主观 final_score<满分)→ upsert:
   *   新建 wrong_count=1;已有 wrong_count+1、re-open 并重置 correct_redo_count
   * - redo 类作业答对 → open 条目 correct_redo_count+1,达 2 → cleared
   */
  async accountAttempt(
    studentId: bigint,
    kind: AssignmentKind,
    items: AccountItem[],
  ): Promise<void> {
    const isRedo = REDO_KINDS.includes(kind);
    for (const item of items) {
      // 需复核题(solution / 公式填空):对错由复核分判;客观题:由 is_correct 判
      const wrong = item.needsReview
        ? item.finalScore != null && item.finalScore < item.fullScore
        : item.isCorrect === false;
      const correct = item.needsReview
        ? item.finalScore != null && item.finalScore >= item.fullScore
        : item.isCorrect === true;

      if (wrong) {
        await this.prisma.client.wrongBookEntry.upsert({
          where: { studentId_questionId: { studentId, questionId: item.questionId } },
          update: { wrongCount: { increment: 1 }, status: 'open', correctRedoCount: 0 },
          create: {
            studentId,
            questionId: item.questionId,
            sourceAnswerId: item.answerId,
            wrongCount: 1,
            errorTags: item.errorTags,
            status: 'open',
          } as never,
        });
      } else if (correct && isRedo) {
        const entry = await this.prisma.client.wrongBookEntry.findFirst({
          where: { studentId, questionId: item.questionId, status: 'open' },
        });
        if (entry) {
          const redoCount = entry.correctRedoCount + 1;
          await this.prisma.client.wrongBookEntry.update({
            where: { id: entry.id },
            data: { correctRedoCount: redoCount, status: redoCount >= 2 ? 'cleared' : 'open' },
          });
        }
      }
    }
  }

  // ---------------- 内部 ----------------

  /** 按错题生成 practice paper(分值沿用来源卷面分)+ wrong_redo assignment */
  private async buildRedoAssignment(
    user: JwtUser,
    entries: { questionId: bigint; sourceAnswerId: bigint }[],
    paperName: string,
  ): Promise<AssignmentDto> {
    // 来源卷面分:source_answer → attempt → assignment.paper 的 paper_questions.score
    const scores: number[] = [];
    for (const e of entries) {
      const src = await this.prisma.client.answer.findFirst({
        where: { id: e.sourceAnswerId },
        select: { attempt: { select: { assignment: { select: { paperId: true } } } } },
      });
      const pq = src
        ? await this.prisma.client.paperQuestion.findFirst({
            where: { paperId: src.attempt.assignment.paperId, questionId: e.questionId },
            select: { score: true },
          })
        : null;
      scores.push(dec(pq?.score) ?? 5);
    }
    const totalScore = scores.reduce((s, x) => s + x, 0);
    const paper = await this.prisma.client.$transaction(async (tx) => {
      const created = await tx.paper.create({
        data: {
          creatorId: BigInt(user.uid),
          name: paperName,
          type: 'practice',
          totalScore,
          status: 'published',
        } as never,
      });
      await tx.paperQuestion.createMany({
        data: entries.map((e, i) => ({
          paperId: created.id,
          questionId: e.questionId,
          seq: i + 1,
          score: scores[i],
        })) as never,
      });
      return created;
    });
    // 复用 A4 的发布口径:wrong_redo → scoreCounted=false,target=本人
    return this.assignments.create(user, {
      paperId: num(paper.id),
      kind: 'wrong_redo',
      target: { studentIds: [user.uid] },
    } as never);
  }
}
