import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  UseFilters,
} from '@nestjs/common';
import { CurrentUser, Roles } from '../common/decorators';
import { BusinessExceptionFilter } from './business.exception';
import { QuestionInputDto, QuestionListQueryDto } from './question.dto';
import { JwtUser, QuestionService } from './question.service';

/**
 * 题库 CRUD(openapi /questions*)。
 * 角色:录题/列表/详情 [teacher];编辑/删除/入库 owner 或 admin(admin 进门禁,owner 校验在 service)。
 */
@Controller('questions')
@UseFilters(BusinessExceptionFilter)
export class QuestionController {
  constructor(private readonly questions: QuestionService) {}

  @Get()
  @Roles('teacher', 'admin')
  list(@CurrentUser() user: JwtUser, @Query() q: QuestionListQueryDto) {
    return this.questions.list(user, q);
  }

  @Post()
  @HttpCode(200)
  @Roles('teacher')
  create(@CurrentUser() user: JwtUser, @Body() dto: QuestionInputDto) {
    return this.questions.create(user, dto);
  }

  @Get(':id')
  @Roles('teacher', 'admin')
  detail(@CurrentUser() user: JwtUser, @Param('id', ParseIntPipe) id: number) {
    return this.questions.detail(user, id);
  }

  @Put(':id')
  @Roles('teacher', 'admin')
  update(
    @CurrentUser() user: JwtUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: QuestionInputDto,
  ) {
    return this.questions.update(user, id, dto);
  }

  @Delete(':id')
  @Roles('teacher', 'admin')
  remove(@CurrentUser() user: JwtUser, @Param('id', ParseIntPipe) id: number) {
    return this.questions.remove(user, id);
  }

  @Post(':id/publish')
  @HttpCode(200)
  @Roles('teacher', 'admin')
  publish(@CurrentUser() user: JwtUser, @Param('id', ParseIntPipe) id: number) {
    return this.questions.publish(user, id);
  }
}
