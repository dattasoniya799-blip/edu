import { Module } from '@nestjs/common';
import { MasteryQueueService } from './mastery.queue';
import { MasteryService } from './mastery.service';

/** 掌握度重算(A5):队列 + 重算服务,供 grading finalize 投递 */
@Module({
  providers: [MasteryService, MasteryQueueService],
  exports: [MasteryQueueService, MasteryService],
})
export class MasteryModule {}
