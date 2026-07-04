import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  AssignmentKind,
  GradingAnswerBriefDto,
  GradingItemDto,
  RubricStep,
} from '@qiming/contracts';
import { dec, num, round1 } from '../admin/helpers';
import {
  AssignmentAnchor,
  ownedAssignmentIds,
} from '../assignment/assignment-ownership.util';
import type { JwtUser } from '../auth/auth.service';
import { getJwtSecret } from '../common/env-assert';
import { MasteryQueueService } from '../mastery/mastery.queue';
import { PrismaService } from '../prisma/prisma.service';
import { AccountItem, WrongBookService } from '../wrongbook/wrongbook.service';
import { isOssKeyOwned } from '../upload/oss-key.util';
import { signStorageUrl } from '../upload/storage/storage-sign.util';
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
 * - 教师复核:pending(按作业聚合)/ answers/:id 详情 / review / finalize
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
    // solution 大题不跑 AI 预批(仅进教师人工复核);blank 仅公式填空(参考答案含 LaTeX)走预批。
    // 即便有历史/误投的 solution 预批任务到达,这里也短路,保证大题绝不被 AI 预批。
    if (!question || question.type === 'solution' || !questionNeedsReview(question.type, question.answer))
      return;

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

  /** GET /grading/pending:submitted attempt 中未复核的主观题,按作业聚合(仅归属当前教师的作业) */
  async pending(user: JwtUser): Promise<PendingGroupDto[]> {
    const rows = await this.prisma.client.answer.findMany({
      where: { isCorrect: null, attempt: { status: 'submitted' } },
      select: {
        questionId: true,
        grading: { select: { aiScore: true, finalScore: true } },
        attempt: {
          select: {
            assignment: {
              select: {
                id: true,
                teacherId: true,
                lessonId: true,
                target: true,
                paper: { select: { name: true } },
              },
            },
          },
        },
      },
    });
    // 归属过滤(统一规则,见 assignment-ownership.util):teacherId=本人,
    // 或 teacherId 为空且 course 锚点属本人;学生自发(无 teacher 无锚点,如 wrong_redo)任何教师不可见。
    const assignments = [
      ...new Map(rows.map((r) => [String(r.attempt.assignment.id), r.attempt.assignment])).values(),
    ];
    const owned = await ownedAssignmentIds(this.prisma.client, user, assignments);
    const ownable = (assignmentId: bigint): boolean => owned.has(String(assignmentId));
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
      if (!ownable(r.attempt.assignment.id)) continue; // 非本人课程的作业不计入
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

  /**
   * GET /grading/assignments/:id/answers:某作业逐题作答名单(供教师在复核页切换)。
   * 口径与 /grading/pending、/grading/answers/:id 一致 —— 只含走复核管线的题(solution + 公式填空);
   * 统计 submitted/graded 两态 attempt 的作答。status='graded' = grading_records.final_score 已写
   * 或 answer 已出分(answers.score 非空);否则 'pending'。?status 过滤同义。跨租户作业 → 404。
   */
  async assignmentAnswers(
    user: JwtUser,
    assignmentId: number,
    status?: 'pending' | 'graded',
  ): Promise<GradingAnswerBriefDto[]> {
    const assignment = await this.mustAssignment(user, assignmentId);
    // 卷面 seq 映射(逐题作答按题序展示)
    const pqs = await this.prisma.client.paperQuestion.findMany({
      where: { paperId: assignment.paperId },
      select: { questionId: true, seq: true },
    });
    const seqByQuestion = new Map(pqs.map((pq) => [String(pq.questionId), pq.seq]));
    // 走复核管线的题(solution + 公式填空)
    const reviewIds = new Set(
      (
        await this.prisma.client.question.findMany({
          where: { id: { in: pqs.map((pq) => pq.questionId) } },
          select: { id: true, type: true, answer: true },
        })
      )
        .filter((q) => questionNeedsReview(q.type, q.answer))
        .map((q) => String(q.id)),
    );
    if (!reviewIds.size) return [];

    const answers = await this.prisma.client.answer.findMany({
      where: {
        questionId: { in: [...reviewIds].map((id) => BigInt(id)) },
        attempt: { assignmentId: BigInt(assignmentId), status: { in: ['submitted', 'graded'] } },
      },
      select: {
        id: true,
        questionId: true,
        score: true,
        grading: { select: { aiScore: true, finalScore: true } },
        attempt: { select: { student: { select: { id: true, name: true } } } },
      },
    });

    const briefs: GradingAnswerBriefDto[] = answers.map((a) => {
      // 已复核 = grading.final_score 已写 或 该作答已出分(answers.score 非空)
      const graded = a.grading?.finalScore != null || dec(a.score) != null;
      return {
        answerId: num(a.id),
        studentId: num(a.attempt.student.id),
        studentName: a.attempt.student.name,
        questionId: num(a.questionId),
        seq: seqByQuestion.get(String(a.questionId)) ?? 0,
        status: graded ? 'graded' : 'pending',
        aiScore: dec(a.grading?.aiScore),
        finalScore: dec(a.grading?.finalScore),
      };
    });
    return briefs
      .filter((b) => status == null || b.status === status)
      .sort((x, y) => x.seq - y.seq || x.studentId - y.studentId);
  }

  /** GET /grading/answers/:id:原稿(签名 URL)+ AI 预批 + rubric */
  async answerDetail(user: JwtUser, id: number): Promise<GradingItemDto> {
    const ans = await this.prisma.client.answer.findFirst({
      where: { id: BigInt(id) },
      include: {
        grading: true,
        attempt: {
          select: {
            student: { select: { id: true, name: true } },
            assignment: { select: { id: true, teacherId: true, lessonId: true, target: true } },
          },
        },
      },
    });
    if (!ans) throw new NotFoundException('作答不存在');
    await this.assertAssignmentOwned(user, ans.attempt.assignment); // 归属:teacher 锚点统一规则
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
      photoUrl: resp?.photoOssKey ? this.signPhotoUrl(resp.photoOssKey, user.orgId) : null,
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
      select: {
        id: true,
        questionId: true,
        attempt: {
          select: {
            id: true,
            status: true,
            objectiveScore: true,
            assignment: {
              select: { id: true, teacherId: true, lessonId: true, target: true, paperId: true },
            },
          },
        },
      },
    });
    if (!ans) throw new NotFoundException('作答不存在');
    await this.assertAssignmentOwned(user, ans.attempt.assignment); // 归属:teacher 锚点统一规则
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

    // 对已出分(graded)的作答再次 review:回写 answers.score 并重算 attempt 分数,
    // 避免「批改详情分」与「学生成绩分」分叉(尚未 finalize 的 submitted 态仍由 finalize 统一出分)。
    if (ans.attempt.status === 'graded') {
      await this.resyncGradedAnswer(
        ans.id,
        question.type,
        dto.finalScore,
        fullScore,
        ans.attempt.id,
        ans.attempt.assignment.paperId,
        dec(ans.attempt.objectiveScore) ?? 0,
      );
    }
    return null;
  }

  /**
   * 已 graded 作答的复核分回写 + attempt 重算(口径同 settleAttempt):
   * - 该作答:answers.score = finalScore;公式填空(blank)同步回填 is_correct(满分=对);
   * - 该 attempt:subjective = 各需复核题复核分之和,score = objective + subjective。
   * 注:不重跑错题入账 / 掌握度(最小修正,见 README · REV-back #7);仅消除分数分叉。
   */
  private async resyncGradedAnswer(
    answerId: bigint,
    type: string,
    finalScore: number,
    fullScore: number,
    attemptId: bigint,
    paperId: bigint,
    objective: number,
  ): Promise<void> {
    const data: { score: number; isCorrect?: boolean } = { score: finalScore };
    if (type === 'blank') data.isCorrect = finalScore >= fullScore;

    const meta = await this.paperMeta(paperId);
    const answers = await this.prisma.client.answer.findMany({
      where: { attemptId },
      select: { id: true, questionId: true, grading: { select: { finalScore: true } } },
    });
    const hasReview = [...meta.values()].some((m) => m.needsReview);
    let subjective: number | null = null;
    for (const a of answers) {
      if (!meta.get(String(a.questionId))?.needsReview) continue;
      // 当前作答的复核分尚未落 grading_records(本次刚改)→ 用入参 finalScore
      const fs = a.id === answerId ? finalScore : dec(a.grading?.finalScore);
      if (fs != null) subjective = round1((subjective ?? 0) + fs);
    }
    if (hasReview && subjective == null) subjective = 0;
    // 包事务防交错(sec-back · #5):作答回写分与 attempt 重算一并提交
    await this.prisma.client.$transaction(async (tx) => {
      await tx.answer.update({ where: { id: answerId }, data });
      await tx.attempt.update({
        where: { id: attemptId },
        data: { subjectiveScore: subjective, score: round1(objective + (subjective ?? 0)) },
      });
    });
  }

  /** POST /grading/assignments/:id/finalize:出分(全部主观题须已复核,否则 4501) */
  async finalizeAssignment(user: JwtUser, assignmentId: number): Promise<null> {
    const assignment = await this.mustAssignment(user, assignmentId);
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
      throw new BizException(ERR_GRADING_PENDING, '仍有主观题/公式填空未复核,请先 review', {
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
    // 先在内存里算好各需复核题的 answers.score / is_correct 回写(不落库)
    const answerUpdates: { id: bigint; data: { score: number; isCorrect?: boolean } }[] = [];

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
        answerUpdates.push({ id: a.id, data });
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

    // 并发安全(sec-back · #5):原子夺取 submitted→graded,并把结算写入并入同一事务。
    // finalizeAssignment(逐个 settle)的并发、submit 自动出分的并发、教师 finalize 与
    // 自动出分交错,都只有夺到这次状态转换(count===1)的请求继续执行 ——
    // 错题入账(wrongbook.increment 非幂等)与 mastery 重算因此恰好执行一次。
    const won = await this.prisma.client.$transaction(async (tx) => {
      const claim = await tx.attempt.updateMany({
        where: { id: at.id, status: 'submitted' },
        data: {
          status: 'graded',
          subjectiveScore: subjective,
          score: round1(objective + (subjective ?? 0)),
        },
      });
      if (claim.count !== 1) return false; // 已被并发请求结算,放弃
      for (const u of answerUpdates) await tx.answer.update({ where: { id: u.id }, data: u.data });
      return true;
    });
    if (!won) return;

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

  private async mustAssignment(user: JwtUser, id: number) {
    const assignment = await this.prisma.client.assignment.findFirst({
      where: { id: BigInt(id) },
      select: { id: true, kind: true, paperId: true, teacherId: true, lessonId: true, target: true },
    });
    if (!assignment) throw new NotFoundException('作业不存在');
    await this.assertAssignmentOwned(user, assignment);
    return assignment;
  }

  // ---------------- 批改归属(teacher 锚点统一规则,经用户批准的 schema 变更)----------------

  /**
   * 作业归属断言(统一规则,见 assignment-ownership.util):
   * teacherId=本人,或 teacherId 为空且 course 锚点课程属本人,否则 404(不泄露存在性)。
   * 学生自发作业(teacherId 为空且无锚点,如 wrong_redo)→ 任何教师 404。
   */
  private async assertAssignmentOwned(user: JwtUser, assignment: AssignmentAnchor): Promise<void> {
    const owned = await ownedAssignmentIds(this.prisma.client, user, [assignment]);
    if (!owned.has(String(assignment.id))) throw new NotFoundException('作业不存在');
  }

  /**
   * 手写原稿签名 URL(短时效 10 分钟):FIX4 · #2 起复用 signStorageUrl,URL 指向
   * @Public GET /api/v1/storage/*(StorageDownloadController),修复此前 /storage 无路由 → 404。
   * HMAC 算法/secret 不变;生产切 OSS 时由 storage 适配器换成真实签名 URL,字段形状不变。
   */
  private signPhotoUrl(ossKey: string, orgId: number): string | null {
    // 纵深防御(sec-back · #6):签名前校验 ossKey 属本机构 answer_photo 前缀。
    // 读/签名端软失败——不合规(历史脏数据/越权写入/跨租户)直接不签发(返回 null),
    // 既杜绝跨租户原稿被签出可访问 URL,又不让历史脏 key 403 掉整张批改详情(摄入端 submit 已硬拒 400)。
    if (!isOssKeyOwned(ossKey, orgId, ['answer_photo'])) return null;
    const base = this.cfg.get<string>(
      'UPLOAD_PUBLIC_BASE',
      `http://127.0.0.1:${this.cfg.get('PORT', '3000')}`,
    );
    const secret = getJwtSecret(this.cfg);
    return signStorageUrl(base, secret, ossKey);
  }
}
