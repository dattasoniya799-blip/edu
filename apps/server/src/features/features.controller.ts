import { Controller, Get } from '@nestjs/common';
import type { JwtUser } from '../auth/auth.service';
import { CurrentUser } from '../common/decorators';
import { FeaturesService } from './features.service';

/**
 * openapi GET /features/my [任意已登录角色](E1):
 * 三端用它渲染实验室分区与路由门禁;不标 @Roles = 仅要求登录。
 */
@Controller('features')
export class FeaturesController {
  constructor(private readonly features: FeaturesService) {}

  @Get('my')
  my(@CurrentUser() user: JwtUser) {
    return this.features.myFeatures(user);
  }
}
