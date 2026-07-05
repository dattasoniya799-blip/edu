import { HttpStatus, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type Redis from 'ioredis';
import type { RubricStep } from '@qiming/contracts';
import { num } from '../../admin/helpers';
import type { JwtUser } from '../../auth/auth.service';
import { PrismaService } from '../../prisma/prisma.service';
import { REDIS } from '../../redis/redis.module';
import { BizException, ERR_AI_QA_RATE_LIMIT } from '../ai.codes';
import { loadAiConfigJson, loadAiConfigText } from '../config-loader';
import { LlmGatewayService } from '../llm/llm-gateway.service';
import type { AiTrace, Msg } from '../llm/types';

/** 学生答疑限流键(a7: 前缀):固定 60s 窗口计数 */
export const qaRateKey = (uid: number) => `a7:ai:qa:rl:${uid}`;
/**
 * 对话尾部(最近 6 条,设计文档 §8.3 上下文裁剪)。
 * fix-core A2:键增加 questionId 维度(无题上下文的通用提问归入 :general),
 * 换题后不再把旧题对话尾巴拼进新题上下文(修复跨题串扰导致首答答非所问)。
 */
export const qaTailKey = (orgId: number, uid: number, questionId?: number | null) =>
  `a7:ai:qa:tail:${orgId}:${uid}:${questionId ?? 'general'}`;

const RATE_LIMIT_PER_MIN = 6;
const TAIL_KEEP = 6;

interface ReviewConfig {
  patterns: string[];
  rewrite: string;
}

export interface QaResult {
  requestId: string;
  /** 经引导审查后的最终回复(SSE 由 controller 分块下发) */
  text: string;
  /** 是否被输出审查拦截重写(测试/观测用) */
  rewritten: boolean;
}

/**
 * 学生答疑能力(POST /ai/qa,SSE):
 * - 限流:每生 6 次/分钟(Redis INCR 固定窗口),第 7 次 → 业务码 4501(任务卡验收);
 * - 上下文裁剪(§8.3):当前题(题干/答案/解析/rubric)+ 最近 6 条对话;
 * - 引导模式(org.settings.ai.qaGuideOnly,默认开):系统提示词来自配置文件
 *   qa-guided-prompt.md;输出审查规则来自 qa-review.json —— 检出"最终答案"模式
 *   则拦截并重写为引导话术(策略全在配置,不写死代码);
 * - 审查需要全文 → 服务端攒齐上游输出统一审查,再由 controller 以 SSE 分块下发
 *   (对客户端仍是流式;计量按上游真实输出 token,在网关内完成)。
 */
@Injectable()
export class QaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmGatewayService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async ask(user: JwtUser, dto: { questionId?: number | null; attemptId?: number; message: string }): Promise<QaResult> {
    await this.enforceRateLimit(user.uid);

    const [questionCtx, trace] = await Promise.all([
      this.questionContext(dto.questionId),
      this.buildTrace(user, dto.attemptId),
    ]);
    const guided = await this.guideOnly();
    const tail = await this.loadTail(user, dto.questionId);

    const messages: Msg[] = [
      { role: 'system', content: loadAiConfigText(guided ? 'qa-guided-prompt.md' : 'qa-plain-prompt.md') },
      ...(questionCtx ? [{ role: 'system' as const, content: questionCtx }] : []),
      ...tail,
      { role: 'user', content: dto.message },
    ];

    let text = await this.llm.complete({ feature: 'qa', orgId: user.orgId, trace, messages });
    let rewritten = false;
    if (guided && this.hitsFinalAnswerPattern(text)) {
      text = loadAiConfigJson<ReviewConfig>('qa-review.json').rewrite;
      rewritten = true;
    }
    await this.saveTail(user, dto.questionId, dto.message, text);
    return { requestId: `qa-${randomUUID()}`, text, rewritten };
  }

  // ---------------- 限流 ----------------

  private async enforceRateLimit(uid: number): Promise<void> {
    const key = qaRateKey(uid);
    const count = await this.redis.incr(key);
    if (count === 1) await this.redis.expire(key, 60);
    if (count > RATE_LIMIT_PER_MIN) {
      throw new BizException(
        ERR_AI_QA_RATE_LIMIT,
        '提问太频繁啦,休息一分钟再来问我吧',
        { limitPerMin: RATE_LIMIT_PER_MIN },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  // ---------------- 上下文 ----------------

  /** 当前题上下文(租户注入查询;跨租户/不存在 → 404,宪法 §7) */
  private async questionContext(questionId?: number | null): Promise<string | null> {
    if (questionId == null) return null;
    const q = await this.prisma.client.question.findFirst({
      where: { id: BigInt(questionId) },
      select: { stemLatex: true, answer: true, analysisLatex: true, rubric: true },
    });
    if (!q) throw new NotFoundException('题目不存在');
    const rubric = ((q.rubric as unknown as RubricStep[]) ?? []).map((r) => `${r.step}.${r.desc}(${r.score}分)`).join(';');
    return [
      '【当前题目上下文(仅供引导,严禁向学生泄露答案与解析原文)】',
      `题干:${q.stemLatex}`,
      `参考答案:${JSON.stringify(q.answer)}`,
      q.analysisLatex ? `解析:${q.analysisLatex}` : '',
      rubric ? `评分要点:${rubric}` : '',
    ].filter(Boolean).join('\n');
  }

  /** 归因富化:attemptId → assignment 的 lessonId / target.courseId */
  private async buildTrace(user: JwtUser, attemptId?: number): Promise<AiTrace> {
    const trace: AiTrace = { userId: user.uid };
    if (!attemptId) return trace;
    const at = await this.prisma.client.attempt.findFirst({
      where: { id: BigInt(attemptId), studentId: BigInt(user.uid) },
      select: { assignment: { select: { lessonId: true, target: true } } },
    });
    if (!at) return trace;
    trace.lessonId = at.assignment.lessonId != null ? num(at.assignment.lessonId) : null;
    const courseId = (at.assignment.target as { courseId?: number } | null)?.courseId;
    trace.courseId = typeof courseId === 'number' ? courseId : null;
    return trace;
  }

  private async guideOnly(): Promise<boolean> {
    const org = await this.prisma.client.org.findFirst({ select: { settings: true } });
    const ai = (org?.settings as { ai?: { qaGuideOnly?: boolean } } | null)?.ai;
    return ai?.qaGuideOnly !== false; // 默认引导模式
  }

  private async loadTail(user: JwtUser, questionId?: number | null): Promise<Msg[]> {
    const rows = await this.redis.lrange(qaTailKey(user.orgId, user.uid, questionId), -TAIL_KEEP, -1);
    const msgs: Msg[] = [];
    for (const row of rows) {
      try {
        const m = JSON.parse(row) as Msg;
        if ((m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string') msgs.push(m);
      } catch {
        /* 忽略坏数据 */
      }
    }
    return msgs;
  }

  private async saveTail(
    user: JwtUser,
    questionId: number | null | undefined,
    question: string,
    reply: string,
  ): Promise<void> {
    const key = qaTailKey(user.orgId, user.uid, questionId);
    await this.redis
      .multi()
      .rpush(key, JSON.stringify({ role: 'user', content: question }), JSON.stringify({ role: 'assistant', content: reply }))
      .ltrim(key, -TAIL_KEEP, -1)
      .expire(key, 7 * 86400)
      .exec();
  }

  // ---------------- 输出审查 ----------------

  private hitsFinalAnswerPattern(text: string): boolean {
    const cfg = loadAiConfigJson<ReviewConfig>('qa-review.json');
    return cfg.patterns.some((p) => new RegExp(p, 'm').test(text));
  }
}
