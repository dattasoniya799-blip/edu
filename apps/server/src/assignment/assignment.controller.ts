import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentUser, Roles } from '../common/decorators';
import type { JwtUser } from '../auth/auth.service';
import { AssignmentInputDto, AssignmentListQueryDto } from './assignment.dto';
import { AssignmentService } from './assignment.service';

/** openapi /assignments* [teacher] */
@Controller('assignments')
export class AssignmentController {
  constructor(private readonly assignments: AssignmentService) {}

  /** GET /assignments 作业总览(C3-back #C) */
  @Get()
  @Roles('teacher')
  list(@CurrentUser() user: JwtUser, @Query() q: AssignmentListQueryDto) {
    return this.assignments.briefList(user, q);
  }

  @Post()
  @HttpCode(200)
  @Roles('teacher')
  create(@CurrentUser() user: JwtUser, @Body() dto: AssignmentInputDto) {
    return this.assignments.create(user, dto);
  }

  @Get(':id/progress')
  @Roles('teacher')
  progress(@Param('id', ParseIntPipe) id: number) {
    return this.assignments.progress(id);
  }
}
