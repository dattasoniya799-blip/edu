import { HttpStatus, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import type Redis from 'ioredis';
import type {
  CoursewareJobDto,
  CoursewareJobPageDto,
  CoursewareOutlinePageDto,
} from '@qiming/contracts';
import {
  BizException,
  ERR_COURSEWARE_JOB_NOT_FOUND,
  ERR_COURSEWARE_RATE_LIMIT,
} from '../ai/ai.codes';
import { CoursewareOutlineService } from '../ai/features/courseware-outline.service';
import { AuditService } from '../audit/audit.service';
import type { JwtUser } from '../auth/auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { REDIS } from '../redis/redis.module';
import { isOssKeyOwned } from '../upload/oss-key.util';
import { CoursewarePageJob, CoursewarePageService } from './courseware-page.service';
import { CoursewareStorageService } from './courseware-storage.service';
import {
  CoursewareJobCreateDto,
  CoursewareOutlineRequestDto,
  DEFAULT_PAGE_COUNT,
} from './courseware.dto';
import { CoursewareQueueService } from './courseware.queue';
import {
  CoursewareJobPageState,
  CoursewareJobState,
  CoursewarePageStatus,
  CoursewareStore,
  jobRateKey,
  outlineRateKey,
  publishRetryKey,
} from './courseware.store';

/** jobId:24 位十六进制随机串(契约口径是 Redis 运行态字符串,不是自增数字 id) */
const JOB_ID_BYTES = 12;

/**
 * [2026-08-22 audit-fix-server · P1-10] 按教师限流。
 * 此前 4 个 /courseware 端点没有任何按人限流(对照 /ai/qa 的 6 次/分):一个教师连点
 * 即可发起 N 个 20 页任务 = 20N 次按张计费的生图,唯一护栏是机构月额度。
 * - outline:每次都是一次真实 LLM 调用 → 10 次/分钟;
 * - jobs:一次提交最多 20 张图 → 3 次/10 分钟;
 * - 并且限制**在飞任务数**(未终态 job)—— 固定窗口挡不住「窗口一到再来三个」。
 */
const OUTLINE_LIMIT = { max: 10, windowSec: 60 };
const JOB_LIMIT = { max: 3, windowSec: 10 * 60 };
const MAX_IN_FLIGHT_JOBS = 3;

/**
 * [2026-08-22 audit-fix-server · P0-3] pending 页折算 failed 的两条时限。
 * - 已被 worker 取件(有 startedAt)却久未结算 → 进程被 OOM/发布重启/BullMQ 判 stalled 打断。
 *   生图单页超时 120s,取其数倍留足余量;
 * - 从未被取件(无 startedAt)且任务已创建很久 → 入队本身失败或队列无消费者。
 * 折算只影响**派生出的状态**(让「重试失败页」按钮出现),运行态仍是 pending;
 * retry 会用条件写把它安全地重置并重新入队。
 */
const STALE_STARTED_MS = 10 * 60_000;
const STALE_UNCLAIMED_MS = 15 * 60_000;

/** 落库补偿的轮询节流:全页 done 但 resourceId 为空时,最多每 30s 重试一次建 Resource */
const PUBLISH_RETRY_THROTTLE_SEC = 30;

/**
 * AI 生成课件(openapi 4 个 /courseware 端点,全部 [teacher]):
 * 文字稿 → 逐页大纲(文本 LLM)→ 教师确认 → 逐页生图(BullMQ + GPT Image)→ 成品落 Resource。
 * 本服务只做业务编排,所有模型调用都经 AiGateway(宪法 §4:业务模块不见供应商 SDK);
 * 任务状态在 Redis 运行态(CoursewareStore),不落库。
 */
@Injectable()
export class CoursewareService {
  private readonly logger = new Logger('Courseware');

  constructor(
    private readonly outlines: CoursewareOutlineService,
    private readonly store: CoursewareStore,
    private readonly queue: CoursewareQueueService,
    private readonly storage: CoursewareStorageService,
    private readonly pages: CoursewarePageService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  /** POST /courseware/outline */
  async outline(user: JwtUser, dto: CoursewareOutlineRequestDto): Promise<{ pages: CoursewareOutlinePageDto[] }> {
    await this.enforceRate(outlineRateKey(user.uid), OUTLINE_LIMIT, '大纲生成太频繁了,请稍后再试');
    const ctx = await this.resolveContext(dto.lessonId, dto.kpNodeId);
    const pages = await this.outlines.generate({
      orgId: user.orgId,
      sourceText: dto.sourceText,
      pageCount: dto.pageCount ?? DEFAULT_PAGE_COUNT,
      style: { id: dto.style.id, ...(dto.style.customText ? { customText: dto.style.customText } : {}) },
      lessonName: ctx.lessonName,
      kpNodeName: ctx.kpNodeName,
      trace: { userId: user.uid, ...(dto.lessonId != null ? { lessonId: dto.lessonId } : {}) },
    });
    return { pages };
  }

  /** POST /courseware/jobs:建运行态任务 + 逐页入队 */
  async createJob(user: JwtUser, dto: CoursewareJobCreateDto): Promise<{ jobId: string }> {
    await this.enforceRate(jobRateKey(user.uid), JOB_LIMIT, '生成任务提交太频繁了,请稍后再试');
    await this.enforceInFlightLimit(user);
    await this.resolveContext(dto.lessonId, dto.kpNodeId);
    const jobId = randomBytes(JOB_ID_BYTES).toString('hex');
    const state: CoursewareJobState = {
      jobId,
      orgId: user.orgId,
      teacherId: user.uid,
      name: dto.name.trim(),
      style: { id: dto.style.id, ...(dto.style.customText ? { customText: dto.style.customText } : {}) },
      lessonId: dto.lessonId ?? null,
      kpNodeId: dto.kpNodeId ?? null,
      pages: dto.pages.map((p, i) => ({
        seq: i + 1,
        title: p.title,
        body: p.body,
        imagePrompt: p.imagePrompt,
        status: 'pending' as const,
      })),
      total: dto.pages.length,
      resourceId: null,
      createdAt: new Date().toISOString(),
    };
    await this.store.create(state);
    await this.store.trackJob(user.orgId, user.uid, jobId);
    await this.queue.enqueue(state.pages.map((p) => this.pageJob(state, p.seq)));
    // [P2-23] courseware 全程不写 audit_logs、ai_calls 也不存提示词,教师可控文本直接进
    // 生图提示词却事后无法追责。至少留一条「谁、何时、什么 name/styleId/页数」。
    await this.audit.log({
      actorId: user.uid,
      orgId: user.orgId,
      action: 'courseware.job.create',
      targetType: 'courseware_job',
      detail: {
        jobId,
        name: state.name,
        styleId: state.style.id,
        pages: state.total,
        lessonId: state.lessonId,
        kpNodeId: state.kpNodeId,
      },
    });
    return { jobId };
  }

  /** GET /courseware/jobs/{jobId}:归属校验 + 进度组装(done 页签 10 分钟回看 URL) */
  async getJob(user: JwtUser, jobId: string): Promise<CoursewareJobDto> {
    let state = await this.mustOwnJob(user, jobId);
    let counts = this.countPages(state);
    // [P0-2] 全页出图成功但成品没落库(建 Resource 抛错):这是教师自己救不回来的死局,
    // 由轮询顺手触发一次补偿(节流 30s,避免每轮都打一次 DB)。
    if (counts.done === state.total && state.resourceId == null) {
      const fixed = await this.tryPublishCompensation(jobId);
      if (fixed) {
        state = fixed;
        counts = this.countPages(state);
      }
    }
    const pages: CoursewareJobPageDto[] = state.pages.map((p) => ({
      seq: p.seq,
      title: p.title,
      status: this.effectivePageStatus(p, state.createdAt),
      imageUrl: this.signPageUrl(state.orgId, p),
    }));
    return {
      jobId: state.jobId,
      status: this.deriveStatus(counts, state.resourceId != null),
      total: state.total,
      done: counts.done,
      pages,
      resourceId: state.resourceId,
    };
  }

  /** POST /courseware/jobs/{jobId}/retry:失败页重置 pending 并重新入队 */
  async retry(user: JwtUser, jobId: string): Promise<null> {
    const state = await this.mustOwnJob(user, jobId);
    const requeued: CoursewareJobPageState[] = [];
    for (const p of state.pages) {
      if (this.effectivePageStatus(p, state.createdAt) !== 'failed') continue;
      const reset: CoursewareJobPageState = { ...p, status: 'pending', startedAt: null, error: null };
      // [P1-4] 条件写:只有真正由本次请求完成「failed → pending」(或把久未结算的 pending
      // 原地重置)的页才入队。连点两次 / 两个标签页并发时,第二次全部落空 —— 不会出现
      // 同一页被生两张图(重复计费 + 孤儿 PNG)。
      const ok =
        p.status === 'failed'
          ? await this.store.setPageIf(jobId, reset, { status: ['failed'] })
          : await this.store.setPageIf(jobId, reset, { status: ['pending'], startedAt: p.startedAt ?? null });
      if (ok) requeued.push(p);
    }
    if (requeued.length) {
      await this.queue.enqueue(requeued.map((p) => this.pageJob(state, p.seq)));
      return null;
    }
    // [P0-2] 没有可重试的页,说明要么全成功、要么已被别人重试:主动走一次完成判定 ——
    // 「全页 done 但落库失败」正是靠这条路恢复(原先 enqueue([]) 直接 return,永不重试落库)。
    await this.tryPublishCompensation(jobId);
    return null;
  }

  // ---------------- 内部 ----------------

  /**
   * 页的**派生**状态([2026-08-22 audit-fix-server · P0-3]):
   * pending 且久未结算 → 对外报 failed,使前端 canRetry 为真、「重试失败页」按钮出现。
   * 运行态本身不改(worker 可能还活着),重置由 retry 的条件写完成。
   */
  private effectivePageStatus(p: CoursewareJobPageState, createdAt: string): CoursewarePageStatus {
    if (p.status !== 'pending') return p.status;
    const now = Date.now();
    const started = p.startedAt ? Date.parse(p.startedAt) : NaN;
    if (Number.isFinite(started)) return now - started > STALE_STARTED_MS ? 'failed' : 'pending';
    const created = Date.parse(createdAt);
    return Number.isFinite(created) && now - created > STALE_UNCLAIMED_MS ? 'failed' : 'pending';
  }

  /**
   * 逐页计数。总数一律取 `state.total`(建任务时定下的 meta.total,P2-22):
   * Redis 缺页时 `pages.length` 会缩水,用它当分母会让 8 页任务变成 5 页任务并直接判 done。
   * 缺失的页计入 pending —— 缺页是异常,绝不能算完成。
   */
  private countPages(state: CoursewareJobState): { total: number; done: number; failed: number; pending: number } {
    let done = 0;
    let failed = 0;
    for (const p of state.pages) {
      const s = this.effectivePageStatus(p, state.createdAt);
      if (s === 'done') done += 1;
      else if (s === 'failed') failed += 1;
    }
    return { total: state.total, done, failed, pending: state.total - done - failed };
  }

  /**
   * 派生任务状态(与 apps/teacher 走查基准同口径):
   * 全 done → done;无 pending 且有 failed → failed;一页都还没结算 → queued;其余 running。
   *
   * [2026-08-22 audit-fix-server · P0-2] 全页 done 但 `resourceId` 为空时**不报 done** ——
   * 前端 `finished: status==='done'` 会告诉教师「已存入资源库」,而资源库里什么都没有。
   * 报 running 让前端继续轮询,轮询本身会触发落库补偿(见 getJob),补偿成功后自然转 done。
   */
  private deriveStatus(
    c: { total: number; done: number; failed: number; pending: number },
    published: boolean,
  ): CoursewareJobDto['status'] {
    if (c.total > 0 && c.done === c.total) return published ? 'done' : 'running';
    if (c.pending === 0 && c.failed > 0) return 'failed';
    return c.done + c.failed === 0 ? 'queued' : 'running';
  }

  /**
   * 回看 URL([2026-08-22 audit-fix-server · P2-14])。
   * 签名前套一层 ossKey 归属校验(与 sec-back #6 的「签名端软失败」口径一致):
   * `a7:courseware:*` 键不带 org 前缀且 Redis 是跨工作区共享的,运行态一旦被写脏,
   * 无校验的 signUrl 就能签出别的 org / 别的 purpose 的对象。不合规即返回 null,不下发。
   */
  private signPageUrl(orgId: number, p: CoursewareJobPageState): string | null {
    if (p.status !== 'done' || !p.imageOssKey) return null;
    if (!isOssKeyOwned(p.imageOssKey, orgId, ['resource'])) {
      this.logger.warn(`页图片 ossKey 归属校验失败,跳过签名:seq=${p.seq}`);
      return null;
    }
    return this.storage.signUrl(p.imageOssKey);
  }

  /** 节流后的落库补偿;成功改写了运行态就回传最新快照,否则 null */
  private async tryPublishCompensation(jobId: string): Promise<CoursewareJobState | null> {
    const first = await this.redis
      .set(publishRetryKey(jobId), '1', 'EX', PUBLISH_RETRY_THROTTLE_SEC, 'NX')
      .catch(() => null);
    if (first !== 'OK') return null;
    try {
      await this.pages.publishIfComplete(jobId);
    } catch (e) {
      // 补偿失败不该让轮询/重试接口 500:状态维持 running,下一轮(30s 后)再试
      this.logger.error(`job=${jobId} 成品落库补偿失败:${(e as Error).message}`);
      return null;
    }
    return this.store.get(jobId);
  }

  // ---------------- 限流(P1-10) ----------------

  /** 固定窗口计数(同 QaService.enforceRateLimit 口径),超限抛 4603 / HTTP 429 */
  private async enforceRate(key: string, limit: { max: number; windowSec: number }, message: string): Promise<void> {
    const count = await this.redis.incr(key);
    if (count === 1) await this.redis.expire(key, limit.windowSec);
    if (count > limit.max) {
      throw new BizException(
        ERR_COURSEWARE_RATE_LIMIT,
        message,
        { limit: limit.max, windowSec: limit.windowSec },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  /**
   * 在飞任务数上限:遍历该教师登记过的 jobId,按运行态复核 —— 已过期/已终态的顺手摘掉,
   * 剩下的就是真正还在跑的。固定窗口限流挡不住「等窗口过去再提三个」,这一层才是硬上限。
   */
  private async enforceInFlightLimit(user: JwtUser): Promise<void> {
    const tracked = await this.store.trackedJobIds(user.orgId, user.uid);
    if (!tracked.length) return;
    const stale: string[] = [];
    let inFlight = 0;
    for (const id of tracked) {
      const s = await this.store.get(id);
      if (!s || s.orgId !== user.orgId || s.teacherId !== user.uid) {
        stale.push(id);
        continue;
      }
      const status = this.deriveStatus(this.countPages(s), s.resourceId != null);
      if (status === 'done' || status === 'failed') stale.push(id);
      else inFlight += 1;
    }
    await this.store.untrackJobs(user.orgId, user.uid, stale);
    if (inFlight >= MAX_IN_FLIGHT_JOBS) {
      throw new BizException(
        ERR_COURSEWARE_RATE_LIMIT,
        `你还有 ${inFlight} 个生成任务在进行中,请等它们完成后再提交新任务`,
        { inFlight, max: MAX_IN_FLIGHT_JOBS },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  /**
   * 归属校验(宪法 §7):任务必须属当前机构**且**属当前教师,否则一律 404 ——
   * 他机构/他教师的 jobId 不给任何存在性线索。任务过期(24h TTL)同样 404。
   */
  private async mustOwnJob(user: JwtUser, jobId: string): Promise<CoursewareJobState> {
    const state = /^[a-f0-9]{1,64}$/.test(jobId) ? await this.store.get(jobId) : null;
    if (!state || state.orgId !== user.orgId || state.teacherId !== user.uid) {
      throw new BizException(
        ERR_COURSEWARE_JOB_NOT_FOUND,
        '生成任务不存在或已过期',
        undefined,
        HttpStatus.NOT_FOUND,
      );
    }
    return state;
  }

  private pageJob(state: CoursewareJobState, seq: number): CoursewarePageJob {
    return { orgId: state.orgId, teacherId: state.teacherId, jobId: state.jobId, seq };
  }

  /**
   * 可选的讲次/知识点锚点:存在性经租户注入保证同机构(跨租户/不存在 → 404,同 ResourceService.mustKpNode),
   * 顺带取名字给大纲提示词做知识点上下文。
   */
  private async resolveContext(
    lessonId?: number,
    kpNodeId?: number,
  ): Promise<{ lessonName: string | null; kpNodeName: string | null }> {
    let lessonName: string | null = null;
    let kpNodeName: string | null = null;
    if (lessonId != null) {
      const lesson = await this.prisma.client.lesson.findFirst({
        where: { id: BigInt(lessonId) },
        select: { title: true },
      });
      if (!lesson) throw new NotFoundException('讲次不存在');
      lessonName = lesson.title;
    }
    if (kpNodeId != null) {
      const node = await this.prisma.client.kpNode.findFirst({
        where: { id: BigInt(kpNodeId) },
        select: { name: true },
      });
      if (!node) throw new NotFoundException('知识点节点不存在');
      kpNodeName = node.name;
    }
    return { lessonName, kpNodeName };
  }
}
