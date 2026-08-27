import { Body, Controller, Get, HttpCode, Param, Post, UseFilters } from '@nestjs/common';
import { BizExceptionFilter } from '../ai/ai.codes';
import type { JwtUser } from '../auth/auth.service';
import { CurrentUser, Roles } from '../common/decorators';
import { CoursewareJobCreateDto, CoursewareOutlineRequestDto } from './courseware.dto';
import { CoursewareService } from './courseware.service';

/**
 * openapi /courseware/* [teacher]:大纲 → 建生图任务 → 轮询进度 → 重试失败页。
 * jobId 是 Redis 运行态字符串(契约明确不复用数字 idPath),故 param 不过 ParseIntPipe。
 */
@Controller('courseware')
@UseFilters(BizExceptionFilter)
export class CoursewareController {
  constructor(private readonly courseware: CoursewareService) {}

  @Post('outline')
  @HttpCode(200)
  @Roles('teacher')
  outline(@CurrentUser() user: JwtUser, @Body() dto: CoursewareOutlineRequestDto) {
    return this.courseware.outline(user, dto);
  }

  @Post('jobs')
  @HttpCode(200)
  @Roles('teacher')
  createJob(@CurrentUser() user: JwtUser, @Body() dto: CoursewareJobCreateDto) {
    return this.courseware.createJob(user, dto);
  }

  @Get('jobs/:jobId')
  @Roles('teacher')
  getJob(@CurrentUser() user: JwtUser, @Param('jobId') jobId: string) {
    return this.courseware.getJob(user, jobId);
  }

  @Post('jobs/:jobId/retry')
  @HttpCode(200)
  @Roles('teacher')
  retry(@CurrentUser() user: JwtUser, @Param('jobId') jobId: string) {
    return this.courseware.retry(user, jobId);
  }
}
