import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AdminController } from './admin.controller';
import { CoursesService } from './courses.service';
import { InsightsService } from './insights.service';
import { SmsService } from './sms.service';
import { StudentsService } from './students.service';
import { TeachersService } from './teachers.service';

/** A2 · 管理员域(/admin/*);PrismaModule/AuditModule/RedisModule 为全局模块,直接注入 */
@Module({
  imports: [AuthModule],
  controllers: [AdminController],
  providers: [TeachersService, StudentsService, CoursesService, InsightsService, SmsService],
})
export class AdminModule {}
