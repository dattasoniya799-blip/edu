import { SetMetadata, createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Role } from '@qiming/contracts';

export const IS_PUBLIC_KEY = 'isPublic';
/** 免登录接口(login/student/login/refresh/healthz) */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const ROLES_KEY = 'roles';
/** 角色门禁:@Roles('admin') / @Roles('teacher','admin') */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

/** 控制器参数装饰器:取当前 JWT 用户 {uid,orgId,role} */
export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext) => {
  return ctx.switchToHttp().getRequest().user;
});
