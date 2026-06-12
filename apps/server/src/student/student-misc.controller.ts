import {
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import type { JwtUser } from '../auth/auth.service';
import { CurrentUser, Public, Roles } from '../common/decorators';
import { ResourceViewService } from './resource-view.service';
import { StudentMiscService } from './student-misc.service';

/**
 * FIX1 · 学生端只读杂项 5 端点(openapi [student]):
 * today / courses / courses/:id/lessons / report / resources/:id/view
 */
@Controller('student')
@Roles('student')
export class StudentMiscController {
  constructor(private readonly misc: StudentMiscService) {}

  @Get('today')
  today(@CurrentUser() user: JwtUser) {
    return this.misc.today(user);
  }

  @Get('courses')
  courses(@CurrentUser() user: JwtUser) {
    return this.misc.myCourses(user);
  }

  @Get('courses/:id/lessons')
  lessons(@CurrentUser() user: JwtUser, @Param('id', ParseIntPipe) id: number) {
    return this.misc.lessonTimeline(user, id);
  }

  @Get('report')
  report(@CurrentUser() user: JwtUser) {
    return this.misc.report(user);
  }

  @Get('resources/:id/view')
  resourceView(@CurrentUser() user: JwtUser, @Param('id', ParseIntPipe) id: number) {
    return this.misc.resourceViewUrl(user, id);
  }
}

/**
 * local 驱动的"预签名 GET"下载端点(不属于 openapi 契约,等价于 OSS 的外部回看地址;
 * 形状与 A3 的 PUT /uploads/local/:token 对称):一次性 token 即凭证,故 @Public;
 * token 无效/过期/已使用 → 403。独立控制器,避免继承上面 @Roles('student') 的门禁。
 */
@Controller('student/resources')
export class StudentResourceDownloadController {
  constructor(private readonly view: ResourceViewService) {}

  @Public()
  @Get('local/:token')
  async getLocal(@Param('token') token: string, @Res() res: Response) {
    const ossKey = await this.view.consumeToken(token);
    if (!ossKey) throw new ForbiddenException('回看凭证无效、已过期或已使用');
    const body = await this.view.readObject(ossKey);
    if (!body) throw new NotFoundException('课件文件不存在');
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Length', String(body.length));
    res.end(body);
  }
}
