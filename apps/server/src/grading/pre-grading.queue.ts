import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, Worker } from 'bullmq';
import { runAsUser } from '../common/tenant-context';
import { GradingService } from './grading.service';
import { bullConnection, PRE_GRADING_QUEUE, QUEUE_PREFIX } from './queue.util';

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
  private readonly queue: Queue<PreGradingJob>;
  private readonly worker: Worker<PreGradingJob>;

  constructor(cfg: ConfigService, grading: GradingService) {
    const connection = bullConnection(cfg);
    this.queue = new Queue<PreGradingJob>(PRE_GRADING_QUEUE, {
      connection,
      prefix: QUEUE_PREFIX,
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
      { connection, prefix: QUEUE_PREFIX, concurrency: 5 },
    );
    this.worker.on('error', () => undefined);
  }

  async enqueue(orgId: number, answerId: number): Promise<void> {
    await this.queue.add('pre_grade', { orgId, answerId });
  }

  async onModuleDestroy() {
    await this.worker?.close().catch(() => undefined);
    await this.queue?.close().catch(() => undefined);
  }
}
