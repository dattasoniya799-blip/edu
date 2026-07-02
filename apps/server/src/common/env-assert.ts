import type { ConfigService } from '@nestjs/config';

/**
 * D2 上线硬化 · 生产环境启动期 fail-fast 校验:
 * - NODE_ENV=production 时,关键环境变量缺失/弱默认 → 启动即抛错终止(assertProductionEnv,main.ts 最早处调用);
 * - JWT/文件签名密钥的取值统一收敛到 getJwtSecret(替代散落各处的 `cfg.get('JWT_SECRET', 'dev-secret-change-me')`),
 *   production 下 helper 自身也拒绝缺失/弱默认(双保险,防止绕过 main.ts 的入口如自定义脚本直接建 AppModule);
 * - 非生产(dev/test)行为完全不变:各项可缺省,JWT_SECRET 回退开发默认值。
 */

/** 开发/测试环境的 JWT 默认密钥;生产严禁使用(assertProductionEnv / getJwtSecret 双保险拦截) */
export const DEV_JWT_SECRET = 'dev-secret-change-me';

/**
 * 生产环境关键环境变量校验。仅 NODE_ENV=production 时生效;任一不满足即抛出
 * 汇总所有问题的中文错误(一次性看全,避免修一个再撞下一个)。
 * 注:main.ts 中调用时 .env 已由 ConfigModule.forRoot(app.module.ts 装饰器求值期)载入 process.env。
 */
export function assertProductionEnv(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV !== 'production') return;

  const problems: string[] = [];

  if (!env.DATABASE_URL) problems.push('DATABASE_URL 未设置(PostgreSQL 连接串)');
  if (!env.REDIS_URL) problems.push('REDIS_URL 未设置(Redis 连接串,BullMQ/会话/限流依赖)');

  if (!env.JWT_SECRET) {
    problems.push('JWT_SECRET 未设置(JWT 签发与文件签名 URL 的 HMAC 密钥)');
  } else if (env.JWT_SECRET === DEV_JWT_SECRET) {
    problems.push(
      `JWT_SECRET 仍为开发默认值 '${DEV_JWT_SECRET}',生产必须改为强随机值(否则 JWT 与签名 URL 可被伪造)`,
    );
  }

  const corsOrigins = (env.CORS_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (corsOrigins.length === 0) {
    problems.push(
      'CORS_ORIGINS 未设置或为空(逗号分隔的前端来源白名单;为空会导致反射任意来源 + credentials)',
    );
  }

  if (!env.UPLOAD_PUBLIC_BASE) {
    problems.push(
      'UPLOAD_PUBLIC_BASE 未显式设置(签名/回看 URL 的对外 base;缺省回退 http://127.0.0.1 生产外部不可达)',
    );
  }

  if (problems.length > 0) {
    throw new Error(
      `生产环境(NODE_ENV=production)关键环境变量校验失败,拒绝启动:\n- ${problems.join('\n- ')}`,
    );
  }
}

/**
 * JWT / 文件签名 HMAC 密钥的唯一取值入口(app.module JwtModule、grading 原稿签名、
 * upload view-url / storage 下载校验统一走这里):
 * - 非生产:未配置时回退开发默认值(dev/test 行为与历史一致);
 * - 生产:缺失或等于开发默认值 → 抛错(与 assertProductionEnv 双保险)。
 */
export function getJwtSecret(
  cfg: ConfigService,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const secret = cfg.get<string>('JWT_SECRET');
  if (env.NODE_ENV === 'production') {
    if (!secret || secret === DEV_JWT_SECRET) {
      throw new Error(
        `JWT_SECRET 未设置或仍为开发默认值 '${DEV_JWT_SECRET}',生产环境拒绝启动(JWT 签发与文件签名 URL 依赖该密钥)`,
      );
    }
    return secret;
  }
  return secret ?? DEV_JWT_SECRET;
}
