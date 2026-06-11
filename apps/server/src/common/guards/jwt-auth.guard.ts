import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { IS_PUBLIC_KEY } from '../decorators';
import { tenantAls } from '../tenant-context';

/** 全局认证守卫:校验 Bearer JWT,写入 request.user 与租户上下文 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService, private readonly reflector: Reflector) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest();
    const auth: string | undefined = req.headers['authorization'];
    const token = auth?.startsWith('Bearer ') ? auth.slice(7) : undefined;
    if (!token) throw new UnauthorizedException('未登录');

    let payload: any;
    try {
      payload = await this.jwt.verifyAsync(token);
    } catch {
      throw new UnauthorizedException('凭证无效或已过期');
    }
    if (payload.typ === 'refresh') throw new UnauthorizedException('凭证类型错误');

    const user = { uid: Number(payload.uid), orgId: Number(payload.orgId), role: payload.role };
    req.user = user;
    // 写入 ALS(ContextMiddleware 已为本请求开启 store)
    const store = tenantAls.getStore();
    if (store) store.user = user;
    return true;
  }
}
