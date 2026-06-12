import { Module } from '@nestjs/common';
import { AnalyticsModule } from '../analytics/analytics.module';
import { AssignmentModule } from '../assignment/assignment.module';
import { ResourceViewService } from './resource-view.service';
import { StudentMiscController, StudentResourceDownloadController } from './student-misc.controller';
import { StudentMiscService } from './student-misc.service';

/**
 * FIX1 · 学生端只读杂项(契约缝隙补漏):
 * GET /student/today · /student/courses · /student/courses/:id/lessons ·
 * /student/report · /student/resources/:id/view(+ local 驱动的 @Public 回看下载端点)。
 * 复用:A4 AssignmentService(作业可见性唯一口径)、A8 AnalyticsService(mastery 聚合)。
 */
@Module({
  imports: [AssignmentModule, AnalyticsModule],
  controllers: [StudentMiscController, StudentResourceDownloadController],
  providers: [StudentMiscService, ResourceViewService],
})
export class StudentMiscModule {}
