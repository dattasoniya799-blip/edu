import { Controller, Get, HttpCode, Param, ParseIntPipe, Post, Query, UseFilters } from '@nestjs/common';
import type { JwtUser } from '../auth/auth.service';
import { CurrentUser, Roles } from '../common/decorators';
import { BizExceptionFilter } from '../grading/business.exception';
import { WrongBookQueryDto } from './wrongbook.dto';
import { WrongBookService } from './wrongbook.service';

/** openapi /student/wrong-book* [student] */
@Controller('student/wrong-book')
@UseFilters(BizExceptionFilter)
@Roles('student')
export class WrongBookController {
  constructor(private readonly wrongBook: WrongBookService) {}

  @Get()
  list(@CurrentUser() user: JwtUser, @Query() q: WrongBookQueryDto) {
    return this.wrongBook.list(user, q);
  }

  @Post(':id/redo')
  @HttpCode(200)
  redo(@CurrentUser() user: JwtUser, @Param('id', ParseIntPipe) id: number) {
    return this.wrongBook.redo(user, id);
  }

  @Post('redo-all')
  @HttpCode(200)
  redoAll(@CurrentUser() user: JwtUser) {
    return this.wrongBook.redoAll(user);
  }
}
