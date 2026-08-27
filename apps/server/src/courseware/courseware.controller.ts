import { Body, Controller, Get, HttpCode, Param, Post, UseFilters } from '@nestjs/common';
import { BizExceptionFilter } from '../ai/ai.codes';
import type { JwtUser } from '../auth/auth.service';
import { CurrentUser, Roles } from '../common/decorators';
import { FeatureGateService } from '../features/feature-gate.service';
import { FEATURE_AI_COURSEWARE } from '../features/feature-catalog';
import { CoursewareJobCreateDto, CoursewareOutlineRequestDto } from './courseware.dto';
import { CoursewareService } from './courseware.service';

/**
 * openapi /courseware/* [teacher]:大纲 → 建生图任务 → 轮询进度 → 重试失败页。
 * jobId 是 Redis 运行态字符串(契约明确不复用数字 idPath),故 param 不过 ParseIntPipe。
 * E1:4 个端点全部挂 ai_courseware 功能门禁(UI 隐藏不是安全边界,服务端硬断言,
 * 不通过 → 403 FEATURE_NOT_ENABLED)。
 */
@Controller('courseware')
@UseFilters(BizExceptionFilter)
export class CoursewareController {
  constructor(
    private readonly courseware: CoursewareService,
    private readonly gate: FeatureGateService,
  ) {}

  @Post('outline')
  @HttpCode(200)
  @Roles('teacher')
  async outline(@CurrentUser() user: JwtUser, @Body() dto: CoursewareOutlineRequestDto) {
    await this.gate.assertEnabled(user, FEATURE_AI_COURSEWARE);
    return this.courseware.outline(user, dto);
  }

  @Post('jobs')
  @HttpCode(200)
  @Roles('teacher')
  async createJob(@CurrentUser() user: JwtUser, @Body() dto: CoursewareJobCreateDto) {
    await this.gate.assertEnabled(user, FEATURE_AI_COURSEWARE);
    return this.courseware.createJob(user, dto);
  }

  @Get('jobs/:jobId')
  @Roles('teacher')
  async getJob(@CurrentUser() user: JwtUser, @Param('jobId') jobId: string) {
    await this.gate.assertEnabled(user, FEATURE_AI_COURSEWARE);
    return this.courseware.getJob(user, jobId);
  }

  @Post('jobs/:jobId/retry')
  @HttpCode(200)
  @Roles('teacher')
  async retry(@CurrentUser() user: JwtUser, @Param('jobId') jobId: string) {
    await this.gate.assertEnabled(user, FEATURE_AI_COURSEWARE);
    return this.courseware.retry(user, jobId);
  }
}
