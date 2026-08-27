import { Injectable, Logger } from '@nestjs/common';
import { composePagePrompt, styleLabel } from '../ai/features/courseware-style';
import { LlmGatewayService } from '../ai/llm/llm-gateway.service';
import { runAsUser } from '../common/tenant-context';
import { PrismaService } from '../prisma/prisma.service';
import { assertOssKeyOwned } from '../upload/oss-key.util';
import { CoursewareStorageService } from './courseware-storage.service';
import { CoursewareJobPageState, CoursewareJobState, CoursewareStore } from './courseware.store';

/** 队列载荷:逐页入队,一页一 job(重试语义 = 只重新入队失败页) */
export interface CoursewarePageJob {
  orgId: number;
  teacherId: number;
  jobId: string;
  seq: number;
}

/**
 * [2026-08-22 audit-fix-server · P2-13] 起跑前要求的最小剩余 TTL。
 * 生图单页超时 120s、队列还可能积压,24h 边界上「图已生成、已计费、已落盘,状态却写不回去」
 * 是纯浪费(教师侧只看到 404)。剩余不足这个数就直接判失败,不发起调用。
 */
const MIN_REMAINING_TTL_SEC = 10 * 60;

/**
 * [2026-08-22 audit-fix-server · P0-1] 整页幻灯片 PNG 的最小合理字节数。
 * 真实链路返回的极小图片(上游降级、返回体异常、透明占位)一律判异常 —— 一张
 * 1536×1024 的整页幻灯片不可能只有几 KB。mock 供应商的 70 字节 1×1 占位图
 * 由 `ImageResult.mock` 标记豁免(那是设计如此,e2e 与无 key 环境都依赖它)。
 */
const MIN_IMAGE_BYTES = 10 * 1024;

/**
 * 逐页出图 worker 的实际处理逻辑(队列壳见 courseware.queue.ts)。
 * 单页流水:认领本页(条件写入 startedAt,并发下只有一个 worker 能认领)
 * → 组装提示词(风格前缀 + 整页内容 + 页码,与前端 composePagePrompt 同构)
 * → AiGateway.image(额度/路由/并发/计量都在网关内,业务不见任何供应商)
 * → base64 解码 + 字节体检 → 落盘(resource/{orgId}/{yyyyMM}/{hex}.png)→ 条件写回该页运行态。
 * 单页失败只把该页置 failed 并记原因,**不抛给 BullMQ、不中断其他页**(attempts=1,
 * 重试由业务层 POST /courseware/jobs/{jobId}/retry 驱动)。
 * 全部页 done 时抢一次落库权,建 Resource(type=ppt)并把 resourceId 写回运行态。
 */
@Injectable()
export class CoursewarePageService {
  private readonly logger = new Logger('CoursewarePage');

  constructor(
    private readonly store: CoursewareStore,
    private readonly storage: CoursewareStorageService,
    private readonly llm: LlmGatewayService,
    private readonly prisma: PrismaService,
  ) {}

  /** worker 入口:在任务发起教师的租户上下文内执行(仿 A5 pre-grading worker) */
  async render(job: CoursewarePageJob): Promise<void> {
    await runAsUser({ uid: job.teacherId, orgId: job.orgId, role: 'teacher' }, async () => {
      const state = await this.store.get(job.jobId);
      // 任务已过期/被清理,或载荷与运行态归属不符(共享 Redis 下的纵深防御)
      if (!state || state.orgId !== job.orgId || state.teacherId !== job.teacherId) return;
      const page = state.pages.find((p) => p.seq === job.seq);
      if (!page || page.status !== 'pending') return;

      // P2-13:剩余 TTL 不足以完成一次出图 → 不发起调用(不产生无处可写的成本)
      const ttl = await this.store.ttl(job.jobId);
      if (ttl > 0 && ttl < MIN_REMAINING_TTL_SEC) {
        await this.store.setPageIf(
          job.jobId,
          { ...page, status: 'failed', error: '任务即将过期(剩余不足 10 分钟),已跳过生图' },
          { status: ['pending'], startedAt: page.startedAt ?? null },
        );
        return;
      }

      // 认领本页:写入 startedAt 作为「已取件」标记 + 结算令牌(P0-3 / P1-4)
      const claimedAt = new Date().toISOString();
      const claimed = await this.store.setPageIf(
        job.jobId,
        { ...page, startedAt: claimedAt, error: null },
        { status: ['pending'], startedAt: page.startedAt ?? null },
      );
      if (!claimed) return; // 已被他人认领/重置,本次投递作废

      let settled: CoursewareJobPageState;
      try {
        const prompt = composePagePrompt({
          style: state.style,
          page: { title: page.title, body: page.body, imagePrompt: page.imagePrompt },
          seq: page.seq,
          total: state.total,
        });
        const image = await this.llm.image({
          feature: 'courseware',
          orgId: job.orgId,
          prompt,
          userId: job.teacherId,
          // P2-19:同一次生成的账不能一半有讲次归因一半没有 —— 最贵的生图那半也要带上
          trace: {
            userId: job.teacherId,
            ...(state.lessonId != null ? { lessonId: state.lessonId } : {}),
          },
        });
        const bytes = Buffer.from(image.imageB64, 'base64');
        if (!bytes.length) throw new Error('生图返回空字节');
        if (!image.mock && bytes.length < MIN_IMAGE_BYTES) {
          throw new Error(`生图结果异常:整页图片仅 ${bytes.length} 字节,疑似上游返回占位图`);
        }
        const ossKey = this.storage.ossKeyFor(job.orgId);
        await this.storage.save(ossKey, bytes);
        settled = {
          ...page,
          status: 'done',
          startedAt: claimedAt,
          imageOssKey: ossKey,
          bytes: bytes.length,
          actualSize: image.actualSize ?? null,
          error: null,
        };
      } catch (e) {
        const reason = (e as Error).message || '生图失败';
        this.logger.warn(`job=${job.jobId} 第 ${job.seq} 页生图失败:${reason}`);
        settled = { ...page, status: 'failed', startedAt: claimedAt, error: reason.slice(0, 200) };
      }

      // 结算要求认领令牌未变:期间被 retry 重置过的页不该被这一轮的迟到结果覆盖
      const written = await this.store.setPageIf(job.jobId, settled, {
        status: ['pending'],
        startedAt: claimedAt,
      });
      if (!written) {
        this.logger.warn(`job=${job.jobId} 第 ${job.seq} 页结算被丢弃(任务已过期或该页已被重置)`);
        return;
      }
      if (settled.status === 'done') await this.publishIfComplete(job.jobId);
    });
  }

  /**
   * 全部页成功 → 成品落资源库(只落一次,靠 Redis SET NX 抢权)。
   *
   * [2026-08-22 audit-fix-server · P0-2] 本方法改为 **public**:落库失败后没有任何路径会
   * 再次触发完成判定(retry 只挑 failed 页,此刻零页 → enqueue([]) 直接 return),任务
   * 永久停在 status=done / resourceId=null。现在 `CoursewareService` 的 retry 与 getJob
   * 都能主动调它做补偿。
   */
  async publishIfComplete(jobId: string): Promise<void> {
    const state = await this.store.get(jobId);
    if (!state || state.resourceId != null) return;
    if (!this.isFullyRendered(state)) return;
    if (!(await this.store.claimPublish(jobId))) return;
    try {
      const resourceId = await this.createResource(state);
      await this.store.setResourceId(jobId, resourceId);
    } catch (e) {
      // 落库失败不该让已出的图白费:释放落库权,让 retry / 下一次轮询能再试一次
      this.logger.error(`job=${jobId} 成品落资源库失败:${(e as Error).message}`);
      await this.store.releasePublish(jobId);
      throw e;
    }
  }

  /** 全部页都出图成功(P2-22:页数以 meta.total 为准,Redis 缺页一律视为未完成) */
  private isFullyRendered(state: CoursewareJobState): boolean {
    return (
      state.total > 0 &&
      state.pages.length === state.total &&
      state.pages.every((p) => p.status === 'done' && p.imageOssKey)
    );
  }

  private async createResource(state: CoursewareJobState): Promise<number> {
    // 归属校验(sec-back · #6 口径):**逐页**校验课件 ossKey 必须是本机构的 resource/ 前缀。
    // [P2-14] 原先只校验第 1 页(封面),其余页的 imageOssKey 未经校验直接进 meta。
    for (const p of state.pages) assertOssKeyOwned(p.imageOssKey, state.orgId, ['resource']);
    const first = state.pages[0].imageOssKey!;
    const created = await this.prisma.client.resource.create({
      data: {
        ownerId: BigInt(state.teacherId),
        type: 'ppt',
        name: state.name,
        // 封面 = 第 1 页整页图;逐页 ossKey 在 meta.pages 里
        ossKey: first,
        size: BigInt(state.pages.reduce((s, p) => s + (p.bytes ?? 0), 0)),
        meta: {
          kind: 'ai_courseware',
          styleId: state.style.id,
          styleName: styleLabel(state.style),
          pages: state.pages.map((p) => ({
            seq: p.seq,
            title: p.title,
            body: p.body,
            imageOssKey: p.imageOssKey,
          })),
        },
        ...(state.kpNodeId != null ? { kpNodeId: BigInt(state.kpNodeId) } : {}),
      } as never,
      select: { id: true },
    });
    return Number(created.id);
  }
}
