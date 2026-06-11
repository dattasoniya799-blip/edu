import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, Worker } from 'bullmq';
import { runAsUser } from '../common/tenant-context';
import { bullConnection, MASTERY_QUEUE, QUEUE_PREFIX } from '../grading/queue.util';
import { MasteryService } from './mastery.service';

export interface MasteryJob {
  orgId: number;
  studentId: number;
}

/**
 * 掌握度重算队列(BullMQ,队列名 a5:mastery):
 * - 生产:finalize 出分后按学生投递
 * - 消费:Worker 在 runAsUser 注入的租户上下文内调用 MasteryService.recalcStudent
 */
@Injectable()
export class MasteryQueueService implements OnModuleDestroy {
  private readonly queue: Queue<MasteryJob>;
  private readonly worker: Worker<MasteryJob>;

  constructor(cfg: ConfigService, mastery: MasteryService) {
    const connection = bullConnection(cfg);
    this.queue = new Queue<MasteryJob>(MASTERY_QUEUE, {
      connection,
      prefix: QUEUE_PREFIX,
      defaultJobOptions: { removeOnComplete: true, removeOnFail: 100, attempts: 2 },
    });
    this.worker = new Worker<MasteryJob>(
      MASTERY_QUEUE,
      async (job) => {
        const { orgId, studentId } = job.data;
        await runAsUser({ uid: 0, orgId, role: 'admin' }, () => mastery.recalcStudent(studentId));
      },
      { connection, prefix: QUEUE_PREFIX, concurrency: 5 },
    );
    // 任务失败仅记录(BullMQ attempts=2 自动重试),不打断进程
    this.worker.on('error', () => undefined);
  }

  async enqueue(orgId: number, studentId: number): Promise<void> {
    await this.queue.add('recalc', { orgId, studentId });
  }

  async onModuleDestroy() {
    await this.worker?.close().catch(() => undefined);
    await this.queue?.close().catch(() => undefined);
  }
}
