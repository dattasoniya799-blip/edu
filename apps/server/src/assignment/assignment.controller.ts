import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post } from '@nestjs/common';
import { CurrentUser, Roles } from '../common/decorators';
import type { JwtUser } from '../auth/auth.service';
import { AssignmentInputDto } from './assignment.dto';
import { AssignmentService } from './assignment.service';

/** openapi /assignments* [teacher] */
@Controller('assignments')
export class AssignmentController {
  constructor(private readonly assignments: AssignmentService) {}

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
