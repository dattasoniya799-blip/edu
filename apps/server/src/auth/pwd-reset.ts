/**
 * access token 层的即时吊销(无 schema 改动),两个来源:
 * 1) 密码重置 / 自助改密:Redis `auth:pwdreset:{userId}` = 当前 epoch 秒,TTL = JWT_ACCESS_TTL;
 *    验签通过后若 payload.iat < 键值 → 401(旧 access token 立即失效)。
 *    iat 用严格小于:同一秒内"重置→立刻新登录"的新 token(iat == resetAt)不误杀;
 *    代价是同一秒内签发的旧 token 会漏拦(已知边界,可接受)。
 * 2) 账号停用:Redis `auth:disabled:{userId}` = 1,TTL = JWT_ACCESS_TTL;存在即 401「账号已停用」;
 *    启用时删除该位并写一条 1) 的吊销 epoch(启用前的旧 token 不复活,须重新登录)。停用本身已让登录被拒并作废 refresh token,这一层补的是"已登录的人立刻被踢"
 *    (2026-09-02 走查 D-1:此前旧 token 可用到过期)。
 * 两个键都随 access TTL 自动过期(此后旧 token 本身已过期,无需再拦)。
 * HTTP 守卫(JwtAuthGuard)与课堂 WS 握手(ClassroomGateway)共用 checkTokenRevoked,口径一致。
 */
import type { ConfigService } from '@nestjs/config';
import type Redis from 'ioredis';

export const PWD_RESET_KEY = (uid: number) => `auth:pwdreset:${uid}`;
export const DISABLED_KEY = (uid: number) => `auth:disabled:${uid}`;

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

/** 停用账号(admin DELETE teachers/students)调用:已签发的 access token 立即失效 */
export async function markAccountDisabled(redis: Redis, cfg: ConfigService, uid: number): Promise<void> {
  const ttl = ttlSeconds(cfg.get<string>('JWT_ACCESS_TTL', '2h'));
  await redis.set(DISABLED_KEY(uid), '1', 'EX', ttl);
}

/**
 * 启用账号调用:解除停用位,但**不复活**停用前签发的 token——同时写一条吊销 epoch(与改密同机制),
 * 启用前的 access token 一律 401,用户重新登录拿新 token。否则停用期间泄露的凭证会随启用一起复活。
 */
export async function clearAccountDisabled(redis: Redis, cfg: ConfigService, uid: number): Promise<void> {
  await redis.del(DISABLED_KEY(uid));
  await markPasswordReset(redis, cfg, uid);
}

export type RevokeReason = 'disabled' | 'password_reset';

/**
 * 验签通过后的吊销判定:返回 null = 放行;否则给出原因(调用方决定 401 文案)。
 * Redis 异常由调用方兜底(fail-open + 告警),这里不吞。
 */
export async function checkTokenRevoked(
  redis: Redis,
  payload: { uid: number | string; iat?: number | string },
): Promise<RevokeReason | null> {
  const uid = Number(payload.uid);
  const [disabled, resetAt] = await redis.mget(DISABLED_KEY(uid), PWD_RESET_KEY(uid));
  if (disabled !== null) return 'disabled';
  if (resetAt !== null && Number(payload.iat) < Number(resetAt)) return 'password_reset';
  return null;
}

export const REVOKE_MESSAGE: Record<RevokeReason, string> = {
  disabled: '账号已停用',
  password_reset: '凭证无效或已过期',
};
