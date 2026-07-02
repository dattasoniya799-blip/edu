/**
 * A2 · 管理员域(openapi.yaml /admin/* 全量)
 * 路由角色:默认 [admin];students/{id}/profile 与 courses/{id}/roster 按契约放开 [admin/teacher]。
 */
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Ip,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { CurrentUser, Roles } from '../common/decorators';
import type { JwtUser } from '../auth/auth.service';
import {
  AddStudentsDto,
  AiQuotaInputDto,
  CourseInputDto,
  CourseListQueryDto,
  DailyQueryDto,
  PageQueryDto,
  SettingsInputDto,
  StudentInputDto,
  StudentListQueryDto,
  TeacherInputDto,
  TeacherListQueryDto,
} from './admin.dto';
import { AiFeatureRoutesInputDto, AiProviderConfigInputDto, AiTestInputDto } from '../ai/ai-admin.dto';
import { AiAdminService } from '../ai/ai-admin.service';
import { CoursesService } from './courses.service';
import { InsightsService } from './insights.service';
import { StudentsService } from './students.service';
import { TeachersService } from './teachers.service';

@Controller('admin')
@Roles('admin')
export class AdminController {
  constructor(
    private readonly teachers: TeachersService,
    private readonly students: StudentsService,
    private readonly courses: CoursesService,
    private readonly insights: InsightsService,
    private readonly aiAdmin: AiAdminService,
  ) {}

  // ================= 教师 =================
  @Get('teachers')
  listTeachers(@Query() q: TeacherListQueryDto) {
    return this.teachers.list(q);
  }

  @Post('teachers')
  @HttpCode(200)
  createTeacher(@CurrentUser() user: JwtUser, @Body() dto: TeacherInputDto, @Ip() ip: string) {
    return this.teachers.create(user, dto, ip);
  }

  @Put('teachers/:id')
  updateTeacher(
    @CurrentUser() user: JwtUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: TeacherInputDto,
    @Ip() ip: string,
  ) {
    return this.teachers.update(user, id, dto, ip);
  }

  @Delete('teachers/:id')
  disableTeacher(@CurrentUser() user: JwtUser, @Param('id', ParseIntPipe) id: number, @Ip() ip: string) {
    return this.teachers.disable(user, id, ip);
  }

  @Post('teachers/:id/reset-password')
  @HttpCode(200)
  resetTeacherPassword(@CurrentUser() user: JwtUser, @Param('id', ParseIntPipe) id: number, @Ip() ip: string) {
    return this.teachers.resetPassword(user, id, ip);
  }

  @Post('teachers/:id/enable')
  @HttpCode(200)
  enableTeacher(@CurrentUser() user: JwtUser, @Param('id', ParseIntPipe) id: number, @Ip() ip: string) {
    return this.teachers.enable(user, id, ip);
  }

  // ================= 学生 =================
  @Get('students')
  listStudents(@Query() q: StudentListQueryDto) {
    return this.students.list(q);
  }

  @Post('students')
  @HttpCode(200)
  createStudent(@CurrentUser() user: JwtUser, @Body() dto: StudentInputDto, @Ip() ip: string) {
    return this.students.create(user, dto, ip);
  }

  @Put('students/:id')
  updateStudent(
    @CurrentUser() user: JwtUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: StudentInputDto,
    @Ip() ip: string,
  ) {
    return this.students.update(user, id, dto, ip);
  }

  @Delete('students/:id')
  disableStudent(@CurrentUser() user: JwtUser, @Param('id', ParseIntPipe) id: number, @Ip() ip: string) {
    return this.students.disable(user, id, ip);
  }

  @Get('students/:id/profile')
  @Roles('admin', 'teacher')
  studentProfile(@Param('id', ParseIntPipe) id: number) {
    return this.students.profile(id);
  }

  @Post('students/:id/reset-password')
  @HttpCode(200)
  resetStudentPassword(@CurrentUser() user: JwtUser, @Param('id', ParseIntPipe) id: number, @Ip() ip: string) {
    return this.students.resetPassword(user, id, ip);
  }

  @Post('students/:id/enable')
  @HttpCode(200)
  enableStudent(@CurrentUser() user: JwtUser, @Param('id', ParseIntPipe) id: number, @Ip() ip: string) {
    return this.students.enable(user, id, ip);
  }

  @Delete('students/:id/device')
  unbindDevice(@CurrentUser() user: JwtUser, @Param('id', ParseIntPipe) id: number, @Ip() ip: string) {
    return this.students.unbindDevice(user, id, ip);
  }

  // ================= 课程 =================
  @Get('courses')
  listCourses(@Query() q: CourseListQueryDto) {
    return this.courses.list(q);
  }

  @Post('courses')
  @HttpCode(200)
  createCourse(@CurrentUser() user: JwtUser, @Body() dto: CourseInputDto, @Ip() ip: string) {
    return this.courses.create(user, dto, ip);
  }

  @Put('courses/:id')
  updateCourse(
    @CurrentUser() user: JwtUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CourseInputDto,
    @Ip() ip: string,
  ) {
    return this.courses.update(user, id, dto, ip);
  }

  @Get('courses/:id/roster')
  @Roles('admin', 'teacher')
  courseRoster(@Param('id', ParseIntPipe) id: number) {
    return this.courses.roster(id);
  }

  @Post('courses/:id/students')
  @HttpCode(200)
  addCourseStudents(
    @CurrentUser() user: JwtUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AddStudentsDto,
    @Ip() ip: string,
  ) {
    return this.courses.addStudents(user, id, dto.studentIds, ip);
  }

  @Delete('courses/:id/students/:studentId')
  removeCourseStudent(
    @CurrentUser() user: JwtUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('studentId', ParseIntPipe) studentId: number,
    @Ip() ip: string,
  ) {
    return this.courses.removeStudent(user, id, studentId, ip);
  }

  // ================= 总览 / AI 用量 / 额度 =================
  @Get('dashboard')
  dashboard() {
    return this.insights.dashboard();
  }

  @Get('ai-usage/summary')
  aiUsageSummary() {
    return this.insights.aiUsageSummary();
  }

  @Get('ai-usage/daily')
  aiUsageDaily(@Query() q: DailyQueryDto) {
    return this.insights.aiUsageDaily(q.days);
  }

  @Get('ai-usage/breakdown')
  aiUsageBreakdown() {
    return this.insights.aiUsageBreakdown();
  }

  @Get('ai-quota')
  quotaGet() {
    return this.insights.quotaGet();
  }

  @Put('ai-quota')
  quotaPut(@CurrentUser() user: JwtUser, @Body() dto: AiQuotaInputDto, @Ip() ip: string) {
    return this.insights.quotaPut(user, dto, ip);
  }

  // ================= 设置 / 审计 =================
  @Get('settings')
  settingsGet(@CurrentUser() user: JwtUser) {
    return this.insights.settingsGet(user);
  }

  @Put('settings')
  settingsPut(@CurrentUser() user: JwtUser, @Body() dto: SettingsInputDto, @Ip() ip: string) {
    return this.insights.settingsPut(user, dto, ip);
  }

  @Get('audit-logs')
  auditLogs(@Query() q: PageQueryDto) {
    return this.insights.auditLogs(q);
  }

  // ================= AI 接口管理(运行态 LLM 配置 / 真假路由 / 测试连接) =================
  @Get('ai/config')
  aiConfigGet() {
    return this.aiAdmin.getConfig();
  }

  @Put('ai/config')
  aiConfigPut(@CurrentUser() user: JwtUser, @Body() dto: AiProviderConfigInputDto, @Ip() ip: string) {
    return this.aiAdmin.putConfig(user, dto, ip);
  }

  @Get('ai/routes')
  aiRoutesGet() {
    return this.aiAdmin.getRoutes();
  }

  @Put('ai/routes')
  aiRoutesPut(@CurrentUser() user: JwtUser, @Body() dto: AiFeatureRoutesInputDto, @Ip() ip: string) {
    return this.aiAdmin.putRoutes(user, dto, ip);
  }

  @Post('ai/test')
  @HttpCode(200)
  aiTest(@Body() dto: AiTestInputDto) {
    return this.aiAdmin.test(dto?.feature);
  }
}
