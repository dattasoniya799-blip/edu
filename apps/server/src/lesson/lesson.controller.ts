import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseArrayPipe,
  ParseIntPipe,
  Post,
  Put,
  UseFilters,
} from '@nestjs/common';
import { CurrentUser, Roles } from '../common/decorators';
import type { JwtUser } from '../auth/auth.service';
import { BizExceptionFilter } from '../course/business.exception';
import { LessonUpdateDto, SegmentInputDto } from './lesson.dto';
import { LessonService } from './lesson.service';

/** openapi /courses/:id/lessons [teacher/admin] */
@Controller('courses')
export class CourseLessonsController {
  constructor(private readonly lessons: LessonService) {}

  @Get(':id/lessons')
  @Roles('teacher', 'admin')
  listByCourse(@Param('id', ParseIntPipe) id: number) {
    return this.lessons.listByCourse(id);
  }
}

/** openapi /lessons/* [teacher] */
@Controller('lessons')
@UseFilters(BizExceptionFilter)
export class LessonController {
  constructor(private readonly lessons: LessonService) {}

  @Get(':id')
  @Roles('teacher')
  detail(@Param('id', ParseIntPipe) id: number) {
    return this.lessons.detail(id);
  }

  @Put(':id')
  @Roles('teacher')
  update(
    @CurrentUser() user: JwtUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: LessonUpdateDto,
  ) {
    return this.lessons.update(user, id, dto);
  }

  @Get(':id/segments')
  @Roles('teacher')
  getSegments(@Param('id', ParseIntPipe) id: number) {
    return this.lessons.getSegments(id);
  }

  @Put(':id/segments')
  @Roles('teacher')
  replaceSegments(
    @CurrentUser() user: JwtUser,
    @Param('id', ParseIntPipe) id: number,
    @Body(new ParseArrayPipe({ items: SegmentInputDto, whitelist: true }))
    segments: SegmentInputDto[],
  ) {
    return this.lessons.replaceSegments(user, id, segments);
  }

  @Post(':id/publish')
  @HttpCode(200)
  @Roles('teacher')
  publish(@CurrentUser() user: JwtUser, @Param('id', ParseIntPipe) id: number) {
    return this.lessons.publish(user, id);
  }
}
