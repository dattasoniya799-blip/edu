import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  AnswerResponse,
  AttemptDto,
  AttemptQuestionView,
  QuestionAnswer,
  QuestionFigure,
  QuestionOptionDto,
  QuestionType,
} from '@qiming/contracts';
import { dec, iso, num, round1 } from '../admin/helpers';
import { AssignmentService } from '../assignment/assignment.service';
import type { JwtUser } from '../auth/auth.service';
import { BizException, ERR_ATTEMPT_STATE } from '../grading/business.exception';
import { questionNeedsReview } from '../grading/formula-blank.util';
import { GradingService } from '../grading/grading.service';
import { PreGradingQueueService } from '../grading/pre-grading.queue';
import { PrismaService } from '../prisma/prisma.service';
import { assertOssKeyOwned } from '../upload/oss-key.util';
import { SubmitAnswerDto } from './attempt.dto';

export interface SubmitAnswerResultDto {
  judged: boolean;
  isCorrect: boolean | null;
  correctAnswer: string | null;
  analysisLatex: string | null;
}

/** blank 归一化(任务卡 A5):全角→半角,再去全部空白 */
export function normalizeBlank(s: string): string {
  return [...s]
    .map((ch) => {
      const c = ch.charCodeAt(0);
      if (c === 0x3000) return ' '; // 全角空格
      if (c >= 0xff01 && c <= 0xff5e) return String.fromCharCode(c - 0xfee0);
      return ch;
    })
    .join('')
    .replace(/\s+/g, '');
}

/**
 * 卷面题面视图(学生)所需字段:题干/选项/插图 + 答案/解析(按 revealed 决定是否下发)。
 * toDto.questions 与课堂随堂练题面(B6)共用同一 select + 映射,保证形状一致。
 */
const PAPER_QUESTION_VIEW_SELECT = {
  seq: true,
  score: true,
  questionId: true,
  question: {
    select: {
      type: true,
      stemLatex: true,
      figures: true,
      analysisLatex: true,
      analysisBriefLatex: true,
      analysisDetailLatex: true,
      answer: true,
      options: {
        orderBy: { label: 'asc' },
        select: { label: true, contentLatex: true },
      },
    },
  },
} satisfies Prisma.PaperQuestionSelect;

type PaperQuestionViewRow = Prisma.PaperQuestionGetPayload<{
  select: typeof PAPER_QUESTION_VIEW_SELECT;
}>;

type QuestionRow = {
  id: bigint;
  type: QuestionType;
  answer: unknown;
  analysisLatex: string | null;
};

/**
 * 学生作答(任务卡 A5):
 * - 开始作答幂等:已有 in_progress 直接返回(断点续答);否则 attempt_no+1 新开
 * - 单题提交:single/multi/blank 即时判分;solution 存 photoOssKey/text 并投递
 *   BullMQ pre_grading 任务(AI stub 预批)
 * - 交卷:汇总客观分;卷面无主观题 → 直接走 GradingService.finalizeAttempt 自动出分
 *   (与教师 finalize 同一条流水线:错题入账 + mastery 重算)
 * - 可见性 / target 解析复用 A4 AssignmentService.listForStudent(禁止重写口径)
 */
@Injectable()
export class AttemptService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly assignments: AssignmentService,
    private readonly grading: GradingService,
    private readonly preGradingQueue: PreGradingQueueService,
  ) {}

  /** POST /student/attempts(幂等开始) */
  async start(user: JwtUser, assignmentId: number): Promise<AttemptDto> {
    const visible = await this.assignments.listForStudent(user, 'all');
    const assignment = visible.find((a) => a.id === assignmentId);
    if (!assignment) throw new NotFoundException('作业不存在');

    const sid = BigInt(user.uid);
    const aid = BigInt(assignmentId);
    const inProgress = await this.prisma.client.attempt.findFirst({
      where: { assignmentId: aid, studentId: sid, status: 'in_progress' },
      orderBy: { attemptNo: 'desc' },
    });
    if (inProgress) return this.toDto(inProgress.id); // 断点续答

    // 作业 / 课堂练习(homework / in_class)一次性:已存在交卷或已出分的作答则不得再开新作答;
    // 订正 / 错题重做 / 巩固(correction / wrong_redo / consolidation)仍允许多次重做。
    if (assignment.kind === 'homework' || assignment.kind === 'in_class') {
      const done = await this.prisma.client.attempt.findFirst({
        where: { assignmentId: aid, studentId: sid, status: { in: ['submitted', 'graded'] } },
        select: { id: true },
      });
      if (done) throw new BizException(ERR_ATTEMPT_STATE, '该作业已完成,不可重复作答');
    }

    const last = await this.prisma.client.attempt.findFirst({
      where: { assignmentId: aid, studentId: sid },
      orderBy: { attemptNo: 'desc' },
      select: { attemptNo: true },
    });
    const created = await this.prisma.client.attempt.create({
      data: { assignmentId: aid, studentId: sid, attemptNo: (last?.attemptNo ?? 0) + 1 } as never,
    });
    return this.toDto(created.id);
  }

  /** GET /student/attempts/:id(断点续答快照:已答 + 剩余) */
  async detail(user: JwtUser, id: number): Promise<AttemptDto> {
    const at = await this.mustOwn(user, id);
    return this.toDto(at.id);
  }

  /** PUT /student/attempts/:id/answers/:qid(客观题即时判分) */
  async submitAnswer(
    user: JwtUser,
    attemptId: number,
    questionId: number,
    dto: SubmitAnswerDto,
  ): Promise<SubmitAnswerResultDto> {
    const at = await this.mustOwn(user, attemptId);
    if (at.status !== 'in_progress')
      throw new BizException(ERR_ATTEMPT_STATE, '已交卷,不能继续作答');

    const pq = await this.prisma.client.paperQuestion.findFirst({
      where: { paperId: at.assignment.paperId, questionId: BigInt(questionId) },
      select: { score: true },
    });
    if (!pq) throw new NotFoundException('题目不在本卷中');
    const question = (await this.prisma.client.question.findFirst({
      where: { id: BigInt(questionId) },
      select: { id: true, type: true, answer: true, analysisLatex: true },
    })) as QuestionRow | null;
    if (!question) throw new NotFoundException('题目不存在');

    // 判定后锁题(fix-core A1):客观题判错会即时下发正确答案与解析(契约行为,保留),
    // 若允许同题在本 attempt 内反复重答,成绩与错题本会被"看完答案再改对"刷失真。
    // 故:该题一旦判定完成(isCorrect 非空),本 attempt 内禁止再次作答。
    // 订正/错题重做/巩固(correction/wrong_redo/consolidation)的合法重练走"新开 attempt"
    // (见 start() 的一次性判断只限 homework/in_class),新 attempt 内每题仍是首次作答,不受影响;
    // solution/公式填空(needsReview,isCorrect=null 待复核)交卷前仍可重新提交(换照片/改文本)。
    const prior = await this.prisma.client.answer.findFirst({
      where: { attemptId: at.id, questionId: question.id },
      select: { isCorrect: true },
    });
    if (prior?.isCorrect != null) {
      throw new BizException(ERR_ATTEMPT_STATE, '该题已完成判定,不能再次作答');
    }

    const response = this.validateResponse(question.type, dto.response, user.orgId);
    const fullScore = dec(pq.score) ?? 0;
    // 公式填空(参考答案含 LaTeX)与 solution 同口径:不即时判分,走 AI 预批 + 教师复核
    const needsReview = questionNeedsReview(question.type, question.answer);
    let isCorrect: boolean | null = null;
    let score: number | null = null;
    if (!needsReview) {
      isCorrect = this.judge(question, response);
      score = isCorrect ? fullScore : 0;
    }

    const saved = await this.prisma.client.answer.upsert({
      where: { attemptId_questionId: { attemptId: at.id, questionId: question.id } },
      update: {
        response: response as never,
        isCorrect,
        score,
        ...(dto.timeSpentSec != null ? { timeSpentSec: dto.timeSpentSec } : {}),
        ...(dto.flagged != null ? { flagged: dto.flagged } : {}),
      },
      create: {
        attemptId: at.id,
        questionId: question.id,
        response: response as never,
        isCorrect,
        score,
        timeSpentSec: dto.timeSpentSec ?? null,
        flagged: dto.flagged ?? false,
      } as never,
    });

    if (needsReview) {
      // solution 大题:不跑 AI 预批,直接进教师人工复核(isCorrect=null 待复核)。
      // 公式填空(blank + 参考答案含 LaTeX):仍走 AI 预批,但受 org.settings.ai.preGrading 开关控制
      //(关则不入队,仍 needsReview=true 待复核)。
      if (question.type === 'blank' && (await this.preGradingEnabled())) {
        await this.preGradingQueue.enqueue(user.orgId, num(saved.id));
      }
      return { judged: false, isCorrect: null, correctAnswer: null, analysisLatex: null };
    }
    return {
      judged: true,
      isCorrect,
      // 判错后才下发正确答案与解析(契约 SubmitAnswerResult 描述)
      correctAnswer: isCorrect ? null : this.correctAnswerText(question),
      analysisLatex: isCorrect ? null : question.analysisLatex,
    };
  }

  /** POST /student/attempts/:id/submit(交卷汇总分) */
  async submit(user: JwtUser, id: number): Promise<AttemptDto> {
    const at = await this.mustOwn(user, id);
    // 快速路径(顺序重复交卷):状态已非 in_progress 直接拒
    if (at.status !== 'in_progress') throw new BizException(ERR_ATTEMPT_STATE, '请勿重复交卷');

    const answers = await this.prisma.client.answer.findMany({
      where: { attemptId: at.id },
      select: { isCorrect: true, score: true },
    });
    const objective = round1(
      answers.reduce((s, a) => s + (a.isCorrect != null ? (dec(a.score) ?? 0) : 0), 0),
    );
    const now = new Date();
    // 并发安全(sec-back · #5):条件 CAS 原子夺取 in_progress→submitted,
    // 杜绝 TOCTOU 下两个请求都通过状态判断而重复交卷/重复触发自动结算。
    // 只有夺到这次状态转换的请求(count===1)才继续算分并走 finalizeAttempt。
    const claimed = await this.prisma.client.attempt.updateMany({
      where: { id: at.id, studentId: BigInt(user.uid), status: 'in_progress' },
      data: {
        status: 'submitted',
        submittedAt: now,
        objectiveScore: objective,
        durationSec: Math.max(0, Math.round((now.getTime() - at.startedAt.getTime()) / 1000)),
      },
    });
    if (claimed.count === 0) throw new BizException(ERR_ATTEMPT_STATE, '请勿重复交卷');

    // 卷面无需复核题(无 solution 且无公式填空,如纯客观错题重做)→ 自动出分:
    // graded + 错题入账 + mastery 任务;否则等教师复核后 finalize
    const reviewables = await this.prisma.client.paperQuestion.findMany({
      where: { paperId: at.assignment.paperId },
      select: { question: { select: { type: true, answer: true } } },
    });
    const needsReview = reviewables.some((pq) =>
      questionNeedsReview(pq.question.type, pq.question.answer),
    );
    if (!needsReview) await this.grading.finalizeAttempt(at.id);
    return this.toDto(at.id);
  }

  // ---------------- 内部 ----------------

  /** org.settings.ai.preGrading 开关(默认开:保持既有公式填空 AI 预批行为;显式 false 才关闭) */
  private async preGradingEnabled(): Promise<boolean> {
    const org = await this.prisma.client.org.findFirst({ select: { settings: true } });
    const ai = (org?.settings as { ai?: { preGrading?: boolean } } | null)?.ai;
    return ai?.preGrading !== false;
  }

  private async mustOwn(user: JwtUser, id: number) {
    const at = await this.prisma.client.attempt.findFirst({
      where: { id: BigInt(id), studentId: BigInt(user.uid) },
      include: { assignment: { select: { paperId: true } } },
    });
    if (!at) throw new NotFoundException('作答不存在');
    return at;
  }

  /** response 形状按题型校验,并裁剪为规范字段 */
  private validateResponse(
    type: QuestionType,
    resp: Record<string, unknown>,
    orgId: number,
  ): AnswerResponse {
    const fail = (msg: string) => {
      throw new BadRequestException(msg);
    };
    switch (type) {
      case 'single':
        if (typeof resp.choice !== 'string' || !resp.choice) fail('single 题 response 需为 {choice}');
        return { choice: resp.choice as string };
      case 'multi':
        if (
          !Array.isArray(resp.choices) ||
          !resp.choices.length ||
          resp.choices.some((c) => typeof c !== 'string')
        )
          fail('multi 题 response 需为 {choices[]}');
        return { choices: resp.choices as string[] };
      case 'blank':
        if (
          !Array.isArray(resp.texts) ||
          !resp.texts.length ||
          resp.texts.some((t) => typeof t !== 'string')
        )
          fail('blank 题 response 需为 {texts[]}');
        return { texts: resp.texts as string[] };
      case 'solution':
        if (typeof resp.photoOssKey === 'string' && resp.photoOssKey) {
          // 归属校验(sec-back · #6):仅接受本机构 answer_photo 前缀的 ossKey,
          // 否则视为非法入参 → 400,杜绝凭他人/异用途 ossKey 占位提交。
          assertOssKeyOwned(resp.photoOssKey, orgId, ['answer_photo'], 'badRequest');
          return { photoOssKey: resp.photoOssKey };
        }
        if (typeof resp.text === 'string' && resp.text) return { text: resp.text };
        return fail('solution 题 response 需为 {photoOssKey} 或 {text}') as never;
    }
  }

  /** 客观题判分(blank:去空格 + 全角转半角后比对) */
  private judge(question: QuestionRow, response: AnswerResponse): boolean {
    const answer = question.answer as {
      choice?: string;
      choices?: string[];
      texts?: string[];
    } | null;
    if (question.type === 'single') {
      return (response as { choice: string }).choice === answer?.choice;
    }
    if (question.type === 'multi') {
      const mine = [...(response as { choices: string[] }).choices].sort().join(',');
      const std = [...(answer?.choices ?? [])].sort().join(',');
      return std !== '' && mine === std;
    }
    // blank
    const mine = (response as { texts: string[] }).texts;
    const std = answer?.texts ?? [];
    return (
      std.length > 0 &&
      mine.length === std.length &&
      mine.every((t, i) => normalizeBlank(t) === normalizeBlank(std[i]))
    );
  }

  private correctAnswerText(question: QuestionRow): string {
    const answer = question.answer as {
      choice?: string;
      choices?: string[];
      texts?: string[];
    } | null;
    if (question.type === 'single') return answer?.choice ?? '';
    if (question.type === 'multi') return [...(answer?.choices ?? [])].sort().join(',');
    return (answer?.texts ?? []).join('; ');
  }

  /**
   * Attempt 契约视图:
   * - answers = 卷面全部题目(seq 序),未答 response=null
   * - questions = 卷面全部题面(seq 序,学生视图):题干/选项(不含 isCorrect)/插图(含 anchor 原样);
   *   correctAnswer/analysisLatex 仅在「该题已判定(answer.isCorrect 非空)或 attempt 已交卷/已出分」时
   *   下发,否则为 null(防作弊:in_progress 且该题未判 → 两者 null)。
   */
  private async toDto(attemptId: bigint): Promise<AttemptDto> {
    const at = await this.prisma.client.attempt.findFirst({
      where: { id: attemptId },
      include: { answers: true, assignment: { select: { paperId: true } } },
    });
    if (!at) throw new NotFoundException('作答不存在');
    const pqs = await this.prisma.client.paperQuestion.findMany({
      where: { paperId: at.assignment.paperId },
      orderBy: { seq: 'asc' },
      select: PAPER_QUESTION_VIEW_SELECT,
    });
    const byQuestion = new Map(at.answers.map((a) => [String(a.questionId), a]));
    // 交卷/已出分 → 全卷可下发正确答案与解析
    const attemptRevealed = at.status === 'submitted' || at.status === 'graded';
    return {
      id: num(at.id),
      assignmentId: num(at.assignmentId),
      status: at.status,
      attemptNo: at.attemptNo,
      startedAt: iso(at.startedAt),
      submittedAt: iso(at.submittedAt),
      score: dec(at.score),
      objectiveScore: dec(at.objectiveScore),
      subjectiveScore: dec(at.subjectiveScore),
      answers: pqs.map((pq) => {
        const a = byQuestion.get(String(pq.questionId));
        return {
          questionId: num(pq.questionId),
          response: (a?.response as AnswerResponse | undefined) ?? null,
          isCorrect: a?.isCorrect ?? null,
          score: dec(a?.score),
          flagged: a?.flagged ?? false,
        };
      }),
      // 该题已判定(客观题即时判分)或整卷已交卷 → 下发正确答案 + 解析
      questions: pqs.map((pq): AttemptQuestionView =>
        this.toQuestionView(pq, attemptRevealed || byQuestion.get(String(pq.questionId))?.isCorrect != null),
      ),
    };
  }

  /**
   * 卷面行 → 学生题面视图(AttemptQuestionView)。toDto 与课堂随堂练共用此口径。
   * @param revealed 是否下发 correctAnswer/analysisLatex(false 时两者恒为 null,防作弊)。
   */
  private toQuestionView(pq: PaperQuestionViewRow, revealed: boolean): AttemptQuestionView {
    return {
      seq: pq.seq,
      questionId: num(pq.questionId),
      score: dec(pq.score) ?? 0,
      type: pq.question.type,
      stemLatex: pq.question.stemLatex,
      // figures 题目级 Json,原样下发(含 anchor)
      figures: (pq.question.figures ?? []) as unknown as QuestionFigure[],
      // 学生视图:不含 isCorrect(沿用题目域学生序列化口径)
      options: pq.question.options.map(
        (o): QuestionOptionDto => ({ label: o.label, contentLatex: o.contentLatex }),
      ),
      correctAnswer: revealed ? ((pq.question.answer ?? null) as QuestionAnswer | null) : null,
      analysisLatex: revealed ? pq.question.analysisLatex : null,
      // 两档解析(简单/详细):与 analysisLatex 同 revealed 门禁,课中(revealed=false)不下发
      analysisBriefLatex: revealed ? (pq.question.analysisBriefLatex ?? undefined) : undefined,
      analysisDetailLatex: revealed ? (pq.question.analysisDetailLatex ?? undefined) : undefined,
    };
  }

  /**
   * 某试卷的学生题面视图列表(seq 序),复用 toDto.questions 同一映射。
   * 课堂随堂练题面(B6)以 revealed=false 调用 → 课中不下发正确答案/解析。
   */
  async paperQuestionViews(paperId: bigint, revealed: boolean): Promise<AttemptQuestionView[]> {
    const pqs = await this.prisma.client.paperQuestion.findMany({
      where: { paperId },
      orderBy: { seq: 'asc' },
      select: PAPER_QUESTION_VIEW_SELECT,
    });
    return pqs.map((pq) => this.toQuestionView(pq, revealed));
  }
}
