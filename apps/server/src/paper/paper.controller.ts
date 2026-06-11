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
import { CurrentUser, Roles } from '../common/decorators';
import type { JwtUser } from '../auth/auth.service';
import { BizExceptionFilter } from '../course/business.exception';
import { PaperInputDto, PaperListQueryDto } from './paper.dto';
import { PaperService } from './paper.service';

/** openapi /papers* [teacher] */
@Controller('papers')
@UseFilters(BizExceptionFilter)
export class PaperController {
  constructor(private readonly papers: PaperService) {}

  @Get()
  @Roles('teacher')
  list(@Query() q: PaperListQueryDto) {
    return this.papers.list(q);
  }

  @Post()
  @HttpCode(200)
  @Roles('teacher')
  create(@CurrentUser() user: JwtUser, @Body() dto: PaperInputDto) {
    return this.papers.create(user, dto);
  }

  @Get(':id')
  @Roles('teacher')
  detail(@Param('id', ParseIntPipe) id: number) {
    return this.papers.detail(id);
  }

  @Put(':id')
  @Roles('teacher')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: PaperInputDto) {
    return this.papers.update(id, dto);
  }
}
