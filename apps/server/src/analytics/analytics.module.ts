import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';

/** A8 · 学情聚合(/analytics/*)。AI 账单 /admin/ai-usage/* 已由 A2 完整实现并通过对账,本模块不重复实现。 */
@Module({
  imports: [AiModule],
  controllers: [AnalyticsController],
  providers: [AnalyticsService],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
