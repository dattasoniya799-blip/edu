import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Role } from '@qiming/contracts';
import { ROLES_KEY } from '../decorators';

/** 角色守卫:配合 @Roles();未标注的接口仅要求登录 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!roles || roles.length === 0) return true;
    const user = ctx.switchToHttp().getRequest().user;
    if (!user) return true; // 公开接口标了 @Roles 也不拦(由 JwtAuthGuard 决定是否要求登录)
    if (!roles.includes(user.role)) throw new ForbiddenException('无权访问该资源');
    return true;
  }
}
