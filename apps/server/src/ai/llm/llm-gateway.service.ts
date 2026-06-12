import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import type { AiFeature } from '@qiming/contracts';
import { periodOf, round4 } from '../../admin/helpers';
import { AuditService } from '../../audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { REDIS } from '../../redis/redis.module';
import { BizException, ERR_AI_QUOTA_EXCEEDED } from '../ai.codes';
import { RouteTableService } from './route-table.service';
import type { Chunk, LlmChatRequest, LlmGateway, LlmProvider, Usage } from './types';

/** org 当月成本 Redis 键(a7: 前缀纪律;额度执行的唯一实时数据源,设计文档 §8.1) */
export const costKey = (orgId: number, period = periodOf()) => `a7:ai:cost:${orgId}:${period}`;
/** 额度告警只发一次的 SETNX 守卫键 */
export const alertKey = (orgId: number, period = periodOf()) => `a7:ai:alert:${orgId}:${period}`;

/** over_policy → 超额时被关闭的能力(默认 disable_qa:关答疑、保课堂伴学/预批) */
const OVER_POLICY_BLOCKS: Record<string, AiFeature[]> = {
  disable_qa: ['qa'],
  disable_all: ['qa', 'class_companion', 'diagnosis', 'pre_grading'],
  none: [],
};

/**
 * LlmGateway 实现(设计文档 §8.1):
 * 额度预检(Redis 当月成本 × ai_quotas.over_policy)→ 路由表 resolve →
 * 供应商调用(失败走 fallback)→ 计量落账:写 ai_calls(全归因)+
 * INCRBYFLOAT org 当月成本;达 alert_threshold 写一条 audit_logs(每 org 每月一次)。
 * 所有 LLM 调用必须经本网关(宪法 §4),业务模块不见任何供应商 SDK。
 */
@Injectable()
export class LlmGatewayService implements LlmGateway {
  private readonly logger = new Logger('LlmGateway');
  private readonly providers = new Map<string, LlmProvider>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly routes: RouteTableService,
    private readonly audit: AuditService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  /** AiModule 装配时注册供应商适配器 */
  register(provider: LlmProvider): void {
    this.providers.set(provider.name, provider);
  }

  providerOf(name: string): LlmProvider | undefined {
    return this.providers.get(name);
  }

  chat(req: LlmChatRequest): AsyncIterable<Chunk> {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    return (async function* () {
      const quota = await self.quotaOf();
      await self.enforceQuota(req, quota);
      const route = await self.routes.resolve(req.feature);
      const startedAt = Date.now();

      // 主路由 → fallback(各供应商首块输出前的失败可切换)
      let active = { provider: route.provider, model: route.model };
      let stream: AsyncIterable<Chunk>;
      try {
        stream = self.mustProvider(active.provider).chat({ model: active.model, messages: req.messages, feature: req.feature });
        stream = await self.primeStream(stream);
      } catch (e) {
        if (!route.fallback) {
          await self.meter(req, active, { tokensIn: 0, tokensOut: 0 }, startedAt, 'error');
          throw e;
        }
        self.logger.warn(`feature=${req.feature} 主路由 ${active.provider}/${active.model} 失败,切换 fallback:${(e as Error).message}`);
        active = { provider: route.fallback.provider, model: route.fallback.model };
        try {
          stream = self.mustProvider(active.provider).chat({ model: active.model, messages: req.messages, feature: req.feature });
          stream = await self.primeStream(stream);
        } catch (e2) {
          await self.meter(req, active, { tokensIn: 0, tokensOut: 0 }, startedAt, 'error');
          throw e2;
        }
      }

      let usage: Usage = { tokensIn: 0, tokensOut: 0 };
      let outChars = 0;
      try {
        for await (const chunk of stream) {
          if (chunk.usage) usage = chunk.usage;
          outChars += chunk.delta.length;
          yield chunk;
        }
      } catch (e) {
        await self.meter(req, active, usage, startedAt, 'error');
        throw e;
      }
      if (!usage.tokensIn && !usage.tokensOut) {
        // 供应商没回 usage 的兜底估算(按字符数)
        usage = { tokensIn: req.messages.reduce((s, m) => s + m.content.length, 0), tokensOut: outChars };
      }
      await self.meter(req, active, usage, startedAt, 'ok', quota);
    })();
  }

  /** 非流式便捷封装:聚合全文(预批/模板能力用) */
  async complete(req: Omit<LlmChatRequest, 'stream'>): Promise<string> {
    let text = '';
    for await (const chunk of this.chat({ ...req, stream: false })) text += chunk.delta;
    return text;
  }

  // ---------------- 额度护栏 ----------------

  private async quotaOf(): Promise<{ monthlyLimit: number; alertThreshold: number; overPolicy: string } | null> {
    // 经 PrismaService(租户注入)读当月配额;未配置 = 不限额
    const row = await this.prisma.client.aiQuota.findFirst({ where: { period: periodOf() } });
    if (!row) return null;
    return {
      monthlyLimit: Number(row.monthlyLimit),
      alertThreshold: row.alertThreshold,
      overPolicy: row.overPolicy,
    };
  }

  private async enforceQuota(
    req: LlmChatRequest,
    quota: { monthlyLimit: number; overPolicy: string } | null,
  ): Promise<void> {
    if (!quota || quota.monthlyLimit <= 0) return;
    const used = Number((await this.redis.get(costKey(req.orgId))) ?? 0);
    if (used < quota.monthlyLimit) return;
    const blocked = OVER_POLICY_BLOCKS[quota.overPolicy] ?? OVER_POLICY_BLOCKS.disable_qa;
    if (blocked.includes(req.feature)) {
      throw new BizException(
        ERR_AI_QUOTA_EXCEEDED,
        '本月 AI 额度已用完,该功能暂时关闭,请联系机构管理员',
        { feature: req.feature, overPolicy: quota.overPolicy },
        HttpStatus.CONFLICT,
      );
    }
  }

  // ---------------- 计量落账 ----------------

  private async meter(
    req: LlmChatRequest,
    active: { provider: string; model: string },
    usage: Usage,
    startedAt: number,
    status: 'ok' | 'error',
    quota?: { monthlyLimit: number; alertThreshold: number } | null,
  ): Promise<void> {
    const pricing = await this.routes.pricingOf(active.model);
    const cost = round4((usage.tokensIn / 1000) * pricing.inPer1k + (usage.tokensOut / 1000) * pricing.outPer1k);
    const trace = req.trace ?? {};
    try {
      // org_id 由 PrismaService 租户注入自动填充(QA=请求上下文;预批 worker=runAsUser;
      // 类型上 orgId 必填而运行时由扩展注入 → as never,与 A5 gradingRecord 同口径)
      await this.prisma.client.aiCall.create({
        data: {
          feature: req.feature,
          userId: trace.userId != null ? BigInt(trace.userId) : null,
          sessionId: trace.sessionId != null ? BigInt(trace.sessionId) : null,
          courseId: trace.courseId != null ? BigInt(trace.courseId) : null,
          lessonId: trace.lessonId != null ? BigInt(trace.lessonId) : null,
          provider: active.provider,
          model: active.model,
          tokensIn: usage.tokensIn,
          tokensOut: usage.tokensOut,
          cost,
          latencyMs: Date.now() - startedAt,
          status,
        } as never,
      });
      if (cost > 0) {
        const total = Number(await this.redis.incrbyfloat(costKey(req.orgId), cost));
        if (quota && quota.monthlyLimit > 0 && total >= (quota.monthlyLimit * quota.alertThreshold) / 100) {
          await this.alertOnce(req, total, quota);
        }
      }
    } catch (e) {
      // 计量失败只记日志,不影响业务回复(与 AuditService 同口径)
      this.logger.error(`ai_calls 计量写入失败 feature=${req.feature}: ${(e as Error).message}`);
    }
  }

  /** 达 alert_threshold:audit_logs 顶替系统通知(任务卡),每 org 每月只发一次 */
  private async alertOnce(
    req: LlmChatRequest,
    total: number,
    quota: { monthlyLimit: number; alertThreshold: number },
  ): Promise<void> {
    const first = await this.redis.set(alertKey(req.orgId), '1', 'EX', 40 * 86400, 'NX');
    if (first !== 'OK') return;
    await this.audit.log({
      actorId: req.trace?.userId ?? 0,
      orgId: req.orgId,
      action: 'ai.quota.alert',
      targetType: 'ai_quota',
      detail: {
        period: periodOf(),
        usedCost: round4(total),
        monthlyLimit: quota.monthlyLimit,
        alertThreshold: quota.alertThreshold,
      },
    });
  }

  private mustProvider(name: string): LlmProvider {
    const p = this.providers.get(name);
    if (!p) throw new Error(`未注册的 LLM 供应商:${name}`);
    return p;
  }

  /**
   * 预取第一块:把"建连即失败"(如未配 key、网络拒绝)在 fallback 决策点暴露出来,
   * 其后再以原顺序回放。
   */
  private async primeStream(stream: AsyncIterable<Chunk>): Promise<AsyncIterable<Chunk>> {
    const it = stream[Symbol.asyncIterator]();
    const first = await it.next();
    return (async function* () {
      if (!first.done) yield first.value;
      for (;;) {
        const n = await it.next();
        if (n.done) return;
        yield n.value;
      }
    })();
  }
}
