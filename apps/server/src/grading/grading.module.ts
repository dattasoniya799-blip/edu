import { Module } from '@nestjs/common';
import { MasteryModule } from '../mastery/mastery.module';
import { WrongBookModule } from '../wrongbook/wrongbook.module';
import { AI_GATEWAY } from './ai/ai-gateway';
import { StubAiGateway } from './ai/stub-ai-gateway';
import { GradingController } from './grading.controller';
import { GradingService } from './grading.service';
import { PreGradingQueueService } from './pre-grading.queue';

/**
 * 批改域(A5):AI 预批队列 + 教师复核 + finalize 出分。
 * AI_GATEWAY 当前绑定 StubAiGateway —— A7 落地真实网关时仅替换此 Provider。
 */
@Module({
  imports: [MasteryModule, WrongBookModule],
  controllers: [GradingController],
  providers: [
    GradingService,
    PreGradingQueueService,
    { provide: AI_GATEWAY, useClass: StubAiGateway },
  ],
  exports: [GradingService, PreGradingQueueService],
})
export class GradingModule {}
