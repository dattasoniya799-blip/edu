import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, Put, UseFilters } from '@nestjs/common';
import type { JwtUser } from '../auth/auth.service';
import { CurrentUser, Roles } from '../common/decorators';
import { BizExceptionFilter } from './business.exception';
import { ReviewDto } from './grading.dto';
import { GradingService } from './grading.service';

/** openapi /grading/* [teacher] */
@Controller('grading')
@UseFilters(BizExceptionFilter)
@Roles('teacher')
export class GradingController {
  constructor(private readonly grading: GradingService) {}

  @Get('pending')
  pending() {
    return this.grading.pending();
  }

  @Get('answers/:id')
  answerDetail(@Param('id', ParseIntPipe) id: number) {
    return this.grading.answerDetail(id);
  }

  @Put('answers/:id/review')
  review(
    @CurrentUser() user: JwtUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ReviewDto,
  ) {
    return this.grading.review(user, id, dto);
  }

  @Post('assignments/:id/adopt-ai')
  @HttpCode(200)
  adoptAi(@CurrentUser() user: JwtUser, @Param('id', ParseIntPipe) id: number) {
    return this.grading.adoptAi(user, id);
  }

  @Post('assignments/:id/finalize')
  @HttpCode(200)
  finalize(@Param('id', ParseIntPipe) id: number) {
    return this.grading.finalizeAssignment(id);
  }
}
