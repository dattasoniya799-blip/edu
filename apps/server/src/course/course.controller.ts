import { Controller, Get } from '@nestjs/common';
import { CurrentUser, Roles } from '../common/decorators';
import type { JwtUser } from '../auth/auth.service';
import { CourseService } from './course.service';

/** openapi /teacher/courses [teacher] */
@Controller('teacher')
export class CourseController {
  constructor(private readonly courses: CourseService) {}

  @Get('courses')
  @Roles('teacher')
  myCourses(@CurrentUser() user: JwtUser) {
    return this.courses.myCourses(user);
  }
}
