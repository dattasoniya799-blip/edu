import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  UseFilters,
} from '@nestjs/common';
import { AssignmentService } from '../assignment/assignment.service';
import type { JwtUser } from '../auth/auth.service';
import { CurrentUser, Roles } from '../common/decorators';
import { BizExceptionFilter } from '../grading/business.exception';
import { StartAttemptDto, StudentAssignmentsQueryDto, SubmitAnswerDto } from './attempt.dto';
import { AttemptService } from './attempt.service';

/** openapi /student/assignments + /student/attempts* [student] */
@Controller('student')
@UseFilters(BizExceptionFilter)
@Roles('student')
export class AttemptController {
  constructor(
    private readonly attempts: AttemptService,
    private readonly assignments: AssignmentService,
  ) {}

  /** GET /student/assignments(复用 A4 listForStudent,target 解析唯一口径) */
  @Get('assignments')
  listAssignments(@CurrentUser() user: JwtUser, @Query() q: StudentAssignmentsQueryDto) {
    return this.assignments.listForStudent(user, q.status ?? 'pending');
  }

  @Post('attempts')
  @HttpCode(200)
  start(@CurrentUser() user: JwtUser, @Body() dto: StartAttemptDto) {
    return this.attempts.start(user, dto.assignmentId);
  }

  @Get('attempts/:id')
  detail(@CurrentUser() user: JwtUser, @Param('id', ParseIntPipe) id: number) {
    return this.attempts.detail(user, id);
  }

  @Put('attempts/:id/answers/:qid')
  submitAnswer(
    @CurrentUser() user: JwtUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('qid', ParseIntPipe) qid: number,
    @Body() dto: SubmitAnswerDto,
  ) {
    return this.attempts.submitAnswer(user, id, qid, dto);
  }

  @Post('attempts/:id/submit')
  @HttpCode(200)
  submit(@CurrentUser() user: JwtUser, @Param('id', ParseIntPipe) id: number) {
    return this.attempts.submit(user, id);
  }
}
