import { Module } from '@nestjs/common';
import { CoursewarePageService } from './courseware-page.service';
import { CoursewareStorageService } from './courseware-storage.service';
import { CoursewareController } from './courseware.controller';
import { CoursewareQueueService } from './courseware.queue';
import { CoursewareService } from './courseware.service';
import { CoursewareStore } from './courseware.store';

/**
 * AI 生成课件域([2026-08-22 批准·契约] 4 个 /courseware 端点)。
 * 依赖 AiModule(@Global)导出的 LlmGatewayService / CoursewareOutlineService ——
 * 本模块只做编排与运行态管理,不 import 任何供应商 SDK(宪法 §4)。
 */
@Module({
  controllers: [CoursewareController],
  providers: [
    CoursewareService,
    CoursewareStore,
    CoursewareStorageService,
    CoursewarePageService,
    CoursewareQueueService,
  ],
})
export class CoursewareModule {}
