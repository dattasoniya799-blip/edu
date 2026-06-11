import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { AnswerResponse, AttemptDto, QuestionType } from '@qiming/contracts';
import { dec, iso, num, round1 } from '../admin/helpers';
import { AssignmentService } from '../assignment/assignment.service';
import type { JwtUser } from '../auth/auth.service';
import { BizException, ERR_ATTEMPT_STATE } from '../grading/business.exception';
import { GradingService } from '../grading/grading.service';
import { PreGradingQueueService } from '../grading/pre-grading.queue';
import { PrismaService } from '../prisma/prisma.service';
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
    if (!visible.some((a) => a.id === assignmentId)) throw new NotFoundException('作业不存在');

    const sid = BigInt(user.uid);
    const aid = BigInt(assignmentId);
    const inProgress = await this.prisma.client.attempt.findFirst({
      where: { assignmentId: aid, studentId: sid, status: 'in_progress' },
      orderBy: { attemptNo: 'desc' },
    });
    if (inProgress) return this.toDto(inProgress.id); // 断点续答

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

    const response = this.validateResponse(question.type, dto.response);
    const fullScore = dec(pq.score) ?? 0;
    let isCorrect: boolean | null = null;
    let score: number | null = null;
    if (question.type !== 'solution') {
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

    if (question.type === 'solution') {
      // 主观题:投递 AI 预批任务(BullMQ,stub 网关)
      await this.preGradingQueue.enqueue(user.orgId, num(saved.id));
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
    if (at.status !== 'in_progress') throw new BizException(ERR_ATTEMPT_STATE, '请勿重复交卷');

    const answers = await this.prisma.client.answer.findMany({
      where: { attemptId: at.id },
      select: { isCorrect: true, score: true },
    });
    const objective = round1(
      answers.reduce((s, a) => s + (a.isCorrect != null ? (dec(a.score) ?? 0) : 0), 0),
    );
    const now = new Date();
    await this.prisma.client.attempt.update({
      where: { id: at.id },
      data: {
        status: 'submitted',
        submittedAt: now,
        objectiveScore: objective,
        durationSec: Math.max(0, Math.round((now.getTime() - at.startedAt.getTime()) / 1000)),
      },
    });

    // 卷面无主观题(如错题重做)→ 自动出分:graded + 错题入账 + mastery 任务
    const hasSolution = await this.prisma.client.paperQuestion.findFirst({
      where: { paperId: at.assignment.paperId, question: { type: 'solution' } },
      select: { id: true },
    });
    if (!hasSolution) await this.grading.finalizeAttempt(at.id);
    return this.toDto(at.id);
  }

  // ---------------- 内部 ----------------

  private async mustOwn(user: JwtUser, id: number) {
    const at = await this.prisma.client.attempt.findFirst({
      where: { id: BigInt(id), studentId: BigInt(user.uid) },
      include: { assignment: { select: { paperId: true } } },
    });
    if (!at) throw new NotFoundException('作答不存在');
    return at;
  }

  /** response 形状按题型校验,并裁剪为规范字段 */
  private validateResponse(type: QuestionType, resp: Record<string, unknown>): AnswerResponse {
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
        if (typeof resp.photoOssKey === 'string' && resp.photoOssKey)
          return { photoOssKey: resp.photoOssKey };
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

  /** Attempt 契约视图:answers = 卷面全部题目(seq 序),未答 response=null */
  private async toDto(attemptId: bigint): Promise<AttemptDto> {
    const at = await this.prisma.client.attempt.findFirst({
      where: { id: attemptId },
      include: { answers: true, assignment: { select: { paperId: true } } },
    });
    if (!at) throw new NotFoundException('作答不存在');
    const pqs = await this.prisma.client.paperQuestion.findMany({
      where: { paperId: at.assignment.paperId },
      orderBy: { seq: 'asc' },
      select: { questionId: true },
    });
    const byQuestion = new Map(at.answers.map((a) => [String(a.questionId), a]));
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
    };
  }
}
