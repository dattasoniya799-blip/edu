import { Module } from '@nestjs/common';
import { LlmPreGradeGateway } from '../ai/features/pre-grading.gateway';
import { MasteryModule } from '../mastery/mastery.module';
import { WrongBookModule } from '../wrongbook/wrongbook.module';
import { AI_GATEWAY } from './ai/ai-gateway';
import { GradingController } from './grading.controller';
import { GradingService } from './grading.service';
import { PreGradingQueueService } from './pre-grading.queue';

/**
 * 批改域(A5):AI 预批队列 + 教师复核 + finalize 出分。
 * AI_GATEWAY 已由 A7 接管:绑定 AiModule(@Global)导出的 LlmPreGradeGateway
 * (真实网关:OCR 接口 + LlmGateway 路由/计量/额度 + JSON Schema 校验)。
 * 此替换是 A5 README 预留的唯一接线点。改预批逻辑去 ai/features/pre-grading.gateway.ts;
 * A5 时代的规则版 StubAiGateway 已删除(需要时查 git 历史),mock 路由下的同规则实现
 * 在 ai/llm/providers/mock.provider.ts。
 */
@Module({
  imports: [MasteryModule, WrongBookModule],
  controllers: [GradingController],
  providers: [
    GradingService,
    PreGradingQueueService,
    { provide: AI_GATEWAY, useExisting: LlmPreGradeGateway },
  ],
  exports: [GradingService, PreGradingQueueService],
})
export class GradingModule {}
