import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, Worker } from 'bullmq';
import { runAsUser } from '../common/tenant-context';
import { GradingService } from './grading.service';
import { bullConnection, PRE_GRADING_QUEUE, queuePrefix } from './queue.util';

export interface PreGradingJob {
  orgId: number;
  answerId: number;
}

/**
 * 主观题 AI 预批队列(BullMQ,队列名 a5:pre_grading,并发 5 —— 设计文档 §8.1):
 * - 生产:学生提交 solution 单题后投递
 * - 消费:Worker 在租户上下文内调用 GradingService.processPreGrade(经 AiGateway stub)
 */
@Injectable()
export class PreGradingQueueService implements OnModuleDestroy {
  private readonly logger = new Logger('PreGradingQueue');
  private readonly queue: Queue<PreGradingJob>;
  private readonly worker: Worker<PreGradingJob>;

  constructor(cfg: ConfigService, grading: GradingService) {
    const connection = bullConnection(cfg);
    const prefix = queuePrefix(cfg);
    this.queue = new Queue<PreGradingJob>(PRE_GRADING_QUEUE, {
      connection,
      prefix,
      defaultJobOptions: { removeOnComplete: true, removeOnFail: 100, attempts: 2 },
    });
    this.worker = new Worker<PreGradingJob>(
      PRE_GRADING_QUEUE,
      async (job) => {
        const { orgId, answerId } = job.data;
        await runAsUser({ uid: 0, orgId, role: 'admin' }, () =>
          grading.processPreGrade(answerId, orgId),
        );
      },
      { connection, prefix, concurrency: 5 },
    );
    // [2026-08-22 audit-fix-server · D3] 原先两个事件都无人订阅:Redis 抖动导致 worker
    // 停止消费、或 attempts 耗尽后学生的 AI 预批结果静默丢失,日志里一个字都没有。
    this.worker.on('error', (e) => this.logger.error(`worker 故障:${e?.message ?? e}`));
    this.worker.on('failed', (job, e) =>
      this.logger.error(`预批任务失败 job=${job?.id} answerId=${job?.data?.answerId} attempts=${job?.attemptsMade}:${e?.message ?? e}`),
    );
  }

  async enqueue(orgId: number, answerId: number): Promise<void> {
    await this.queue.add('pre_grade', { orgId, answerId });
  }

  async onModuleDestroy() {
    await this.worker?.close().catch(() => undefined);
    await this.queue?.close().catch(() => undefined);
  }
}
