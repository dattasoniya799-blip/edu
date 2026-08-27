import { Module } from '@nestjs/common';
import { FeatureGateService } from './feature-gate.service';
import { FeaturesController } from './features.controller';
import { FeaturesService } from './features.service';

/**
 * E1 · 内测区与功能分级:功能目录下发(/features/my)+ 管理端阶段/白名单(经 AdminController)
 * + 运行时硬门禁 FeatureGateService(courseware / 拍照预批入队处消费)。
 * PrismaModule/AuditModule 为全局模块,直接注入。
 */
@Module({
  controllers: [FeaturesController],
  providers: [FeaturesService, FeatureGateService],
  exports: [FeaturesService, FeatureGateService],
})
export class FeaturesModule {}
