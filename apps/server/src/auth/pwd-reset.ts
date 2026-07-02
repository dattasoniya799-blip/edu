/**
 * 密码重置吊销(access token 层,无 schema 改动):
 * - 重置/修改密码时在 Redis 记 `auth:pwdreset:{userId}` = 当前 epoch 秒,TTL = JWT_ACCESS_TTL;
 * - JwtAuthGuard 验签通过后,若存在该键且 payload.iat < 键值 → 401(旧 access token 立即失效);
 * - iat 用严格小于:同一秒内"重置→立刻新登录"的新 token(iat == resetAt)不误杀;
 * - 键随 access TTL 自动过期(此后旧 token 本身已过期,无需再拦)。
 */
import type { ConfigService } from '@nestjs/config';
import type Redis from 'ioredis';

export const PWD_RESET_KEY = (uid: number) => `auth:pwdreset:${uid}`;

/** '2h' / '14d' / '900s' → 秒(与 AuthService 签发 token 的 TTL 同口径) */
export function ttlSeconds(ttl: string): number {
  const m = /^(\d+)([smhd])$/.exec(ttl.trim());
  if (!m) return 7200;
  const n = Number(m[1]);
  return n * { s: 1, m: 60, h: 3600, d: 86400 }[m[2] as 's' | 'm' | 'h' | 'd'];
}

/** 所有改密路径(admin 重置学生/教师、用户自助改密)统一调用 */
export async function markPasswordReset(redis: Redis, cfg: ConfigService, uid: number): Promise<void> {
  const ttl = ttlSeconds(cfg.get<string>('JWT_ACCESS_TTL', '2h'));
  await redis.set(PWD_RESET_KEY(uid), String(Math.floor(Date.now() / 1000)), 'EX', ttl);
}
