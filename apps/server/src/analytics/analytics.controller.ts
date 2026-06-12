import { Controller, Get, Param, ParseIntPipe } from '@nestjs/common';
import { Roles } from '../common/decorators';
import { AnalyticsService } from './analytics.service';

/**
 * openapi /analytics/*(学情·教师):
 * - GET /analytics/courses/:id/mastery   课程知识点掌握热力 [teacher]
 * - GET /analytics/courses/:id/attention 重点关注学生 [teacher]
 * - GET /analytics/students/:id          单生 30 天报告 [teacher/admin]
 * 角色门禁严格按 openapi 标注;org 内不再细分 owner(A4 既定口径,契约未要求)。
 */
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('courses/:id/mastery')
  @Roles('teacher')
  courseMastery(@Param('id', ParseIntPipe) id: number) {
    return this.analytics.courseMastery(id);
  }

  @Get('courses/:id/attention')
  @Roles('teacher')
  courseAttention(@Param('id', ParseIntPipe) id: number) {
    return this.analytics.courseAttention(id);
  }

  @Get('students/:id')
  @Roles('teacher', 'admin')
  studentReport(@Param('id', ParseIntPipe) id: number) {
    return this.analytics.studentReport(id);
  }
}
