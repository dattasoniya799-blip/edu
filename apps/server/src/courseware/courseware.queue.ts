import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, Worker } from 'bullmq';
import { bullConnection, queuePrefix } from '../grading/queue.util';
import { CoursewarePageJob, CoursewarePageService } from './courseware-page.service';

/** 队列名(实际键形如 `${BULLMQ_PREFIX}:courseware:*`,前缀随 BULLMQ_PREFIX 隔离) */
export const COURSEWARE_QUEUE = 'courseware';

/**
 * AI 生成课件的逐页出图队列(BullMQ,复用 A5 的 bullConnection/queuePrefix 惯例)。
 * - 生产:建任务时逐页入队;retry 时只重新入队条件写成功的页;
 * - 消费:并发 2(生图单页数十秒且按张计费,不宜放大);
 * - attempts=1 —— 重试语义由业务层管(教师点「重试失败页」),BullMQ 不自动重投,
 *   否则同一页会被重复计费,且与运行态里的 failed 状态语义打架。
 */
@Injectable()
export class CoursewareQueueService implements OnModuleDestroy {
  private readonly logger = new Logger('CoursewareQueue');
  private readonly queue: Queue<CoursewarePageJob>;
  private readonly worker: Worker<CoursewarePageJob>;

  constructor(cfg: ConfigService, pages: CoursewarePageService) {
    const connection = bullConnection(cfg);
    const prefix = queuePrefix(cfg);
    this.queue = new Queue<CoursewarePageJob>(COURSEWARE_QUEUE, {
      connection,
      prefix,
      defaultJobOptions: { removeOnComplete: true, removeOnFail: 100, attempts: 1 },
    });
    this.worker = new Worker<CoursewarePageJob>(
      COURSEWARE_QUEUE,
      async (job) => {
        await pages.render(job.data);
      },
      { connection, prefix, concurrency: 2 },
    );
    // [2026-08-22 audit-fix-server · D3] 三个事件此前全静默,观测性为零。
    this.worker.on('error', (e) => this.logger.error(`worker 故障:${e?.message ?? e}`));
    this.worker.on('failed', (job, e) =>
      this.logger.error(`出图任务失败 job=${job?.data?.jobId} seq=${job?.data?.seq}:${e?.message ?? e}`),
    );
    // [P0-3] stalled = worker 被 OOM/发布重启打断,attempts=1 下 job 直接被丢弃而该页仍是
    // pending。运行态侧靠 startedAt 超时折算 failed 放出重试口,这里补上告警线索。
    this.worker.on('stalled', (jobId) =>
      this.logger.warn(`出图任务被判 stalled(worker 中断),该页将由超时折算转为可重试:job=${jobId}`),
    );
  }

  async enqueue(jobs: CoursewarePageJob[]): Promise<void> {
    if (!jobs.length) return;
    await this.queue.addBulk(jobs.map((data) => ({ name: 'page', data })));
  }

  async onModuleDestroy() {
    await this.worker?.close().catch(() => undefined);
    await this.queue?.close().catch(() => undefined);
  }
}
