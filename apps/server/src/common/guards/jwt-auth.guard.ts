import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type Redis from 'ioredis';
import { PWD_RESET_KEY } from '../../auth/pwd-reset';
import { REDIS } from '../../redis/redis.module';
import { IS_PUBLIC_KEY } from '../decorators';
import { tenantAls } from '../tenant-context';

/** 全局认证守卫:校验 Bearer JWT,写入 request.user 与租户上下文 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly logger = new Logger(JwtAuthGuard.name);

  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

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

    // 密码重置吊销:重置时刻之前签发的 access token 一律 401(iat 严格小于,同秒新登录不误杀);
    // Redis 不可用时 fail-open 放行并告警,不把全站打挂。
    try {
      const resetAt = await this.redis.get(PWD_RESET_KEY(Number(payload.uid)));
      if (resetAt !== null && Number(payload.iat) < Number(resetAt)) {
        throw new UnauthorizedException('凭证无效或已过期');
      }
    } catch (e) {
      if (e instanceof UnauthorizedException) throw e;
      this.logger.warn(`密码重置吊销检查跳过(Redis 不可用,fail-open):${(e as Error).message}`);
    }

    const user = { uid: Number(payload.uid), orgId: Number(payload.orgId), role: payload.role };
    req.user = user;
    // 写入 ALS(ContextMiddleware 已为本请求开启 store)
    const store = tenantAls.getStore();
    if (store) store.user = user;
    return true;
  }
}
