import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, Put, Query, UseFilters } from '@nestjs/common';
import type { JwtUser } from '../auth/auth.service';
import { CurrentUser, Roles } from '../common/decorators';
import { BizExceptionFilter } from './business.exception';
import { GradingAnswersQueryDto, ReviewDto } from './grading.dto';
import { GradingService } from './grading.service';

/** openapi /grading/* [teacher] */
@Controller('grading')
@UseFilters(BizExceptionFilter)
@Roles('teacher')
export class GradingController {
  constructor(private readonly grading: GradingService) {}

  @Get('pending')
  pending(@CurrentUser() user: JwtUser) {
    return this.grading.pending(user);
  }

  @Get('assignments/:id/answers')
  assignmentAnswers(
    @CurrentUser() user: JwtUser,
    @Param('id', ParseIntPipe) id: number,
    @Query() q: GradingAnswersQueryDto,
  ) {
    return this.grading.assignmentAnswers(user, id, q.status);
  }

  @Get('answers/:id')
  answerDetail(@CurrentUser() user: JwtUser, @Param('id', ParseIntPipe) id: number) {
    return this.grading.answerDetail(user, id);
  }

  @Put('answers/:id/review')
  review(
    @CurrentUser() user: JwtUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ReviewDto,
  ) {
    return this.grading.review(user, id, dto);
  }

  @Post('assignments/:id/finalize')
  @HttpCode(200)
  finalize(@CurrentUser() user: JwtUser, @Param('id', ParseIntPipe) id: number) {
    return this.grading.finalizeAssignment(user, id);
  }
}
