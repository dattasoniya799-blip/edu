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
import type { JwtUser } from '../auth/auth.service';
import { BizExceptionFilter } from '../course/business.exception';
import { ResourceCreateDto, ResourceListQueryDto, ResourceUpdateDto } from './resource.dto';
import { ResourceService } from './resource.service';

/** openapi /resources* [teacher] */
@Controller('resources')
@UseFilters(BizExceptionFilter)
export class ResourceController {
  constructor(private readonly resources: ResourceService) {}

  @Get()
  @Roles('teacher')
  list(@Query() q: ResourceListQueryDto) {
    return this.resources.list(q);
  }

  @Post()
  @HttpCode(200)
  @Roles('teacher')
  create(@CurrentUser() user: JwtUser, @Body() dto: ResourceCreateDto) {
    return this.resources.create(user, dto);
  }

  @Put(':id')
  @Roles('teacher')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: ResourceUpdateDto) {
    return this.resources.update(id, dto);
  }

  @Delete(':id')
  @Roles('teacher')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.resources.remove(id);
  }
}
