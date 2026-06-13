import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'crypto';
import type { AssignmentKind, GradingItemDto, RubricStep } from '@qiming/contracts';
import { dec, num, round1 } from '../admin/helpers';
import type { JwtUser } from '../auth/auth.service';
import { MasteryQueueService } from '../mastery/mastery.queue';
import { PrismaService } from '../prisma/prisma.service';
import { AccountItem, WrongBookService } from '../wrongbook/wrongbook.service';
import { AI_GATEWAY, AiGateway } from './ai/ai-gateway';
import { BizException, ERR_GRADING_PENDING } from './business.exception';
import { questionNeedsReview } from './formula-blank.util';
import { ReviewDto } from './grading.dto';

export interface PendingGroupDto {
  assignmentId: number;
  paperName: string;
  pendingCount: number;
  aiAvgScore: number | null;
}

type AnswerWithGrading = {
  id: bigint;
  questionId: bigint;
  response: unknown;
  isCorrect: boolean | null;
  score: unknown;
  grading: {
    aiScore: unknown;
    aiSteps: unknown;
    aiErrorTags: unknown;
    finalScore: unknown;
    comment: string | null;
  } | null;
};

/** 卷面单题元信息(题型 / 满分 / 是否需复核) */
type PaperQMeta = { type: string; fullScore: number; needsReview: boolean };

/**
 * 批改域(任务卡 A5):
 * - AI 预批 worker 回调 processPreGrade(经 AiGateway,本卡 stub)
 * - 教师复核:pending(按作业聚合)/ answers/:id 详情 / review / adopt-ai / finalize
 * - finalize 出分:主观题 final_score → answers.score,attempt 写
 *   score/subjective_score 并置 graded → 错题入账 → 投递 mastery 重算
 * - 客观题专属卷(无 solution 题)在交卷时由 AttemptService 走同一 finalizeAttempt 自动出分
 */
@Injectable()
export class GradingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cfg: ConfigService,
    private readonly wrongBook: WrongBookService,
    private readonly masteryQueue: MasteryQueueService,
    @Inject(AI_GATEWAY) private readonly ai: AiGateway,
  ) {}

  // ================= AI 预批(BullMQ worker 回调) =================

  /** pre_grading 任务体:OCR 占位文本 + 参考答案 + rubric → AiGateway → grading_records */
  async processPreGrade(answerId: number, orgId: number): Promise<void> {
    const ans = await this.prisma.client.answer.findFirst({ where: { id: BigInt(answerId) } });
    if (!ans) return; // 作答已被清理,任务作废
    const question = await this.prisma.client.question.findFirst({
      where: { id: ans.questionId },
      select: { type: true, answer: true, rubric: true },
    });
    // solution 恒走预批;blank 仅公式填空(参考答案含 LaTeX)走预批
    if (!question || !questionNeedsReview(question.type, question.answer)) return;

    const resp = ans.response as
      | { text?: string; photoOssKey?: string; texts?: string[] }
      | null;
    // 公式填空:OCR 文本 = 学生各空作答;参考答案 = 题目各空参考(均按空拼接,供真实 OCR/AI 用)
    const ocrText =
      question.type === 'blank'
        ? (Array.isArray(resp?.texts) ? resp.texts : []).join(' | ')
        : typeof resp?.text === 'string'
          ? resp.text
          : `[photo:${resp?.photoOssKey ?? ''}]`;
    const referenceAnswer =
      question.type === 'blank'
        ? ((question.answer as { texts?: string[] } | null)?.texts ?? []).join(' | ')
        : ((question.answer as { referenceLatex?: string } | null)?.referenceLatex ?? '');
    const out = await this.ai.preGrade(
      { ocrText, referenceAnswer, rubric: (question.rubric as unknown as RubricStep[]) ?? [] },
      { orgId, feature: 'pre_grading' },
    );
    // 只写 AI 字段,不覆盖教师 final_score(教师先复核、AI 后到的场景)
    await this.prisma.client.gradingRecord.upsert({
      where: { answerId: ans.id },
      update: { aiScore: out.aiScore, aiSteps: out.steps as never, aiErrorTags: out.errorTags },
      create: {
        answerId: ans.id,
        aiScore: out.aiScore,
        aiSteps: out.steps as never,
        aiErrorTags: out.errorTags,
      } as never,
    });
  }

  // ================= 教师复核 =================

  /** GET /grading/pending:submitted attempt 中未复核的主观题,按作业聚合 */
  async pending(): Promise<PendingGroupDto[]> {
    const rows = await this.prisma.client.answer.findMany({
      where: { isCorrect: null, attempt: { status: 'submitted' } },
      select: {
        questionId: true,
        grading: { select: { aiScore: true, finalScore: true } },
        attempt: {
          select: { assignment: { select: { id: true, paper: { select: { name: true } } } } },
        },
      },
    });
    // 待复核题 = solution + 公式填空(均 isCorrect=null);需按题目 answer 判定公式填空
    const reviewIds = new Set(
      (
        await this.prisma.client.question.findMany({
          where: { id: { in: [...new Set(rows.map((r) => r.questionId))] } },
          select: { id: true, type: true, answer: true },
        })
      )
        .filter((q) => questionNeedsReview(q.type, q.answer))
        .map((q) => String(q.id)),
    );
    const groups = new Map<
      string,
      { assignmentId: number; paperName: string; pendingCount: number; aiScores: number[] }
    >();
    for (const r of rows) {
      if (!reviewIds.has(String(r.questionId))) continue;
      if (r.grading?.finalScore != null) continue; // 已复核
      const key = String(r.attempt.assignment.id);
      const g = groups.get(key) ?? {
        assignmentId: num(r.attempt.assignment.id),
        paperName: r.attempt.assignment.paper.name,
        pendingCount: 0,
        aiScores: [],
      };
      g.pendingCount += 1;
      const aiScore = dec(r.grading?.aiScore);
      if (aiScore != null) g.aiScores.push(aiScore);
      groups.set(key, g);
    }
    return [...groups.values()]
      .sort((a, b) => a.assignmentId - b.assignmentId)
      .map((g) => ({
        assignmentId: g.assignmentId,
        paperName: g.paperName,
        pendingCount: g.pendingCount,
        aiAvgScore: g.aiScores.length
          ? round1(g.aiScores.reduce((s, x) => s + x, 0) / g.aiScores.length)
          : null,
      }));
  }

  /** GET /grading/answers/:id:原稿(签名 URL)+ AI 预批 + rubric */
  async answerDetail(id: number): Promise<GradingItemDto> {
    const ans = await this.prisma.client.answer.findFirst({
      where: { id: BigInt(id) },
      include: {
        grading: true,
        attempt: { select: { student: { select: { id: true, name: true } } } },
      },
    });
    if (!ans) throw new NotFoundException('作答不存在');
    const question = await this.prisma.client.question.findFirst({
      where: { id: ans.questionId },
      select: { stemLatex: true, rubric: true },
    });
    if (!question) throw new NotFoundException('题目不存在');
    const resp = ans.response as
      | { text?: string; photoOssKey?: string; texts?: string[] }
      | null;
    // 公式填空无 photo/text,各空作答拼接到 textResponse 供教师查看
    const textResponse =
      resp?.text ?? (Array.isArray(resp?.texts) ? resp.texts.join(' | ') : null);
    return {
      answerId: num(ans.id),
      studentId: num(ans.attempt.student.id),
      studentName: ans.attempt.student.name,
      questionId: num(ans.questionId),
      stemLatex: question.stemLatex,
      rubric: (question.rubric as unknown as RubricStep[]) ?? [],
      photoUrl: resp?.photoOssKey ? this.signPhotoUrl(resp.photoOssKey) : null,
      textResponse,
      aiScore: dec(ans.grading?.aiScore),
      aiSteps: (ans.grading?.aiSteps as GradingItemDto['aiSteps']) ?? [],
      aiErrorTags: (ans.grading?.aiErrorTags as string[]) ?? [],
      finalScore: dec(ans.grading?.finalScore),
      comment: ans.grading?.comment ?? null,
    };
  }

  /** PUT /grading/answers/:id/review:确认得分与评语(允许先于 AI 预批) */
  async review(user: JwtUser, id: number, dto: ReviewDto): Promise<null> {
    const ans = await this.prisma.client.answer.findFirst({
      where: { id: BigInt(id) },
      select: { id: true, questionId: true, attempt: { select: { assignment: { select: { paperId: true } } } } },
    });
    if (!ans) throw new NotFoundException('作答不存在');
    const question = await this.prisma.client.question.findFirst({
      where: { id: ans.questionId },
      select: { type: true, answer: true },
    });
    if (!question || !questionNeedsReview(question.type, question.answer))
      throw new BadRequestException('仅主观题或公式填空需要复核');
    const pq = await this.prisma.client.paperQuestion.findFirst({
      where: { paperId: ans.attempt.assignment.paperId, questionId: ans.questionId },
      select: { score: true },
    });
    const fullScore = dec(pq?.score) ?? 0;
    if (dto.finalScore < 0 || dto.finalScore > fullScore)
      throw new BadRequestException(`finalScore 必须在 0 ~ ${fullScore} 之间`);
    await this.prisma.client.gradingRecord.upsert({
      where: { answerId: ans.id },
      update: {
        finalScore: dto.finalScore,
        comment: dto.comment ?? null,
        reviewerId: BigInt(user.uid),
        reviewedAt: new Date(),
      },
      create: {
        answerId: ans.id,
        finalScore: dto.finalScore,
        comment: dto.comment ?? null,
        reviewerId: BigInt(user.uid),
        reviewedAt: new Date(),
      } as never,
    });
    return null;
  }

  /** POST /grading/assignments/:id/adopt-ai:全部采纳 AI 分(仅未复核且有 AI 分的) */
  async adoptAi(user: JwtUser, assignmentId: number): Promise<null> {
    await this.mustAssignment(assignmentId);
    const records = await this.prisma.client.gradingRecord.findMany({
      where: {
        finalScore: null,
        aiScore: { not: null },
        answer: { attempt: { assignmentId: BigInt(assignmentId), status: 'submitted' } },
      },
      select: { id: true, aiScore: true },
    });
    for (const r of records) {
      await this.prisma.client.gradingRecord.update({
        where: { id: r.id },
        data: { finalScore: r.aiScore, reviewerId: BigInt(user.uid), reviewedAt: new Date() },
      });
    }
    return null;
  }

  /** POST /grading/assignments/:id/finalize:出分(全部主观题须已复核,否则 4501) */
  async finalizeAssignment(assignmentId: number): Promise<null> {
    const assignment = await this.mustAssignment(assignmentId);
    const attempts = await this.prisma.client.attempt.findMany({
      where: { assignmentId: assignment.id, status: 'submitted' },
      include: { answers: { include: { grading: true } } },
    });
    if (!attempts.length) return null;

    const meta = await this.paperMeta(assignment.paperId);
    const pendingAnswerIds: number[] = [];
    for (const at of attempts) {
      for (const a of at.answers) {
        if (meta.get(String(a.questionId))?.needsReview && dec(a.grading?.finalScore) == null)
          pendingAnswerIds.push(num(a.id));
      }
    }
    if (pendingAnswerIds.length)
      throw new BizException(ERR_GRADING_PENDING, '仍有主观题/公式填空未复核,请先 review 或 adopt-ai', {
        pendingAnswerIds,
      });

    for (const at of attempts) {
      await this.settleAttempt(at, assignment.kind, meta);
    }
    return null;
  }

  /**
   * 交卷自动出分入口(AttemptService 调用):卷面无主观题时直接走 finalize 流水线。
   * 与教师 finalize 共用 settleAttempt,保证错题/掌握度口径一致。
   */
  async finalizeAttempt(attemptId: bigint): Promise<void> {
    const at = await this.prisma.client.attempt.findFirst({
      where: { id: attemptId, status: 'submitted' },
      include: {
        answers: { include: { grading: true } },
        assignment: { select: { kind: true, paperId: true } },
      },
    });
    if (!at) return;
    const meta = await this.paperMeta(at.assignment.paperId);
    await this.settleAttempt(at, at.assignment.kind, meta);
  }

  // ================= 内部 =================

  /** 单次作答出分:汇总主观分 → attempt graded → 错题入账 → mastery 任务 */
  private async settleAttempt(
    at: { id: bigint; studentId: bigint; orgId: bigint; objectiveScore: unknown; answers: AnswerWithGrading[] },
    kind: AssignmentKind,
    meta: Map<string, PaperQMeta>,
  ): Promise<void> {
    let subjective: number | null = null;
    const hasReview = [...meta.values()].some((m) => m.needsReview);
    const items: AccountItem[] = [];

    for (const a of at.answers) {
      const m = meta.get(String(a.questionId));
      if (!m) continue;
      // 需复核题(solution / 公式填空)用复核分;否则客观题保持 null(用 isCorrect)
      const finalScore = m.needsReview ? dec(a.grading?.finalScore) : null;
      let isCorrect = a.isCorrect;
      if (m.needsReview && finalScore != null) {
        subjective = round1((subjective ?? 0) + finalScore);
        // 复核分落到 answers.score(出分对学生可见)
        const data: { score: number; isCorrect?: boolean } = { score: finalScore };
        // 公式填空本质是客观题:回填 is_correct(满分=对)以纳入掌握度样本;
        // solution 是主观题,is_correct 恒 NULL 不入掌握度样本(沿用 A5 口径)
        if (m.type === 'blank') {
          isCorrect = finalScore >= m.fullScore;
          data.isCorrect = isCorrect;
        }
        await this.prisma.client.answer.update({ where: { id: a.id }, data });
      }
      items.push({
        answerId: a.id,
        questionId: a.questionId,
        isCorrect,
        finalScore,
        fullScore: m.fullScore,
        type: m.type,
        needsReview: m.needsReview,
        errorTags: (a.grading?.aiErrorTags as string[]) ?? [],
      });
    }
    if (hasReview && subjective == null) subjective = 0;

    const objective = dec(at.objectiveScore) ?? 0;
    await this.prisma.client.attempt.update({
      where: { id: at.id },
      data: {
        status: 'graded',
        subjectiveScore: subjective,
        score: round1(objective + (subjective ?? 0)),
      },
    });
    await this.wrongBook.accountAttempt(at.studentId, kind, items);
    await this.masteryQueue.enqueue(num(at.orgId), num(at.studentId));
  }

  /** 卷面题型/满分/是否需复核表(needsReview = solution 或 公式填空) */
  private async paperMeta(paperId: bigint): Promise<Map<string, PaperQMeta>> {
    const pqs = await this.prisma.client.paperQuestion.findMany({
      where: { paperId },
      select: {
        questionId: true,
        score: true,
        question: { select: { type: true, answer: true } },
      },
    });
    return new Map(
      pqs.map((pq) => [
        String(pq.questionId),
        {
          type: pq.question.type,
          fullScore: dec(pq.score) ?? 0,
          needsReview: questionNeedsReview(pq.question.type, pq.question.answer),
        },
      ]),
    );
  }

  private async mustAssignment(id: number) {
    const assignment = await this.prisma.client.assignment.findFirst({
      where: { id: BigInt(id) },
      select: { id: true, kind: true, paperId: true },
    });
    if (!assignment) throw new NotFoundException('作业不存在');
    return assignment;
  }

  /**
   * 手写原稿签名 URL(短时效 10 分钟):
   * HMAC(ossKey:exp) 签名,base 取 UPLOAD_PUBLIC_BASE(同 A3 storage 适配器口径);
   * 生产切 OSS 时由 storage 适配器换成真实签名 URL,字段形状不变。
   */
  private signPhotoUrl(ossKey: string): string {
    const base = this.cfg.get<string>('UPLOAD_PUBLIC_BASE', 'http://127.0.0.1:3000');
    const secret = this.cfg.get<string>('JWT_SECRET', 'dev-secret-change-me');
    const exp = Date.now() + 600_000;
    const sig = createHmac('sha256', secret).update(`${ossKey}:${exp}`).digest('hex').slice(0, 32);
    return `${base}/storage/${ossKey}?exp=${exp}&sig=${sig}`;
  }
}
