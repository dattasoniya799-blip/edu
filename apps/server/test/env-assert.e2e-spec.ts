/**
 * D2 · 生产环境 fail-fast 校验(src/common/env-assert.ts)的单元级用例。
 * 不依赖 DB/Redis/HTTP;命名沿用 *.e2e-spec.ts 仅为纳入现有 jest-e2e 门禁(testMatch 约束)。
 * 覆盖:
 * - production 缺任一关键变量 → 抛(且错误信息点名该变量);
 * - production JWT_SECRET 为开发弱默认 → 抛;多项缺失 → 一次汇总;
 * - 非 production(dev/test/未设置)全缺 → 不抛(行为与历史一致);
 * - getJwtSecret:非生产回退默认值;生产缺失/弱默认 → 抛,配置强密钥 → 原样返回。
 */
import type { ConfigService } from '@nestjs/config';
import { DEV_JWT_SECRET, assertProductionEnv, getJwtSecret } from '../src/common/env-assert';

/** production 下全部合规的 env 基线(逐项剔除制造缺失场景) */
const okProdEnv = (): NodeJS.ProcessEnv => ({
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://user:pass@db:5432/qiming',
  REDIS_URL: 'redis://redis:6379',
  JWT_SECRET: 'a-strong-random-secret-0123456789abcdef',
  CORS_ORIGINS: 'https://app.example.com,https://admin.example.com',
  UPLOAD_PUBLIC_BASE: 'https://files.example.com',
});

/** 最小 ConfigService 桩:仅实现 get(key)(env-assert 只用到这一形状) */
const stubCfg = (vals: Record<string, string | undefined>): ConfigService =>
  ({ get: (key: string) => vals[key] }) as unknown as ConfigService;

describe('assertProductionEnv(D2 生产 fail-fast)', () => {
  it('production 且全部配置合规 → 不抛', () => {
    expect(() => assertProductionEnv(okProdEnv())).not.toThrow();
  });

  it.each(['DATABASE_URL', 'REDIS_URL', 'JWT_SECRET', 'CORS_ORIGINS', 'UPLOAD_PUBLIC_BASE'] as const)(
    'production 缺 %s → 抛且错误信息点名该变量',
    (key) => {
      const env = okProdEnv();
      delete env[key];
      expect(() => assertProductionEnv(env)).toThrow(key);
      expect(() => assertProductionEnv(env)).toThrow(/生产环境.*拒绝启动/s);
    },
  );

  it('production JWT_SECRET 等于开发弱默认 → 抛', () => {
    const env = { ...okProdEnv(), JWT_SECRET: DEV_JWT_SECRET };
    expect(() => assertProductionEnv(env)).toThrow(DEV_JWT_SECRET);
    expect(() => assertProductionEnv(env)).toThrow(/JWT_SECRET/);
  });

  it('production CORS_ORIGINS 仅空白/逗号(白名单实际为空)→ 抛', () => {
    expect(() => assertProductionEnv({ ...okProdEnv(), CORS_ORIGINS: ' , ,' })).toThrow(
      /CORS_ORIGINS/,
    );
  });

  it('production 多项缺失 → 一次性汇总全部问题', () => {
    const env: NodeJS.ProcessEnv = { NODE_ENV: 'production' };
    let message = '';
    try {
      assertProductionEnv(env);
    } catch (e) {
      message = (e as Error).message;
    }
    for (const key of ['DATABASE_URL', 'REDIS_URL', 'JWT_SECRET', 'CORS_ORIGINS', 'UPLOAD_PUBLIC_BASE'])
      expect(message).toContain(key);
  });

  it.each(['development', 'test', undefined])(
    'NODE_ENV=%s(非 production)全缺 → 不抛(dev/test 行为不变)',
    (nodeEnv) => {
      const env: NodeJS.ProcessEnv = {};
      if (nodeEnv !== undefined) env.NODE_ENV = nodeEnv;
      expect(() => assertProductionEnv(env)).not.toThrow();
    },
  );
});

describe('getJwtSecret(JWT/签名密钥统一入口)', () => {
  it('非生产未配置 → 回退开发默认值(历史行为)', () => {
    expect(getJwtSecret(stubCfg({}), { NODE_ENV: 'test' })).toBe(DEV_JWT_SECRET);
    expect(getJwtSecret(stubCfg({}), {})).toBe(DEV_JWT_SECRET);
  });

  it('非生产已配置 → 原样返回', () => {
    expect(getJwtSecret(stubCfg({ JWT_SECRET: 'abc' }), { NODE_ENV: 'development' })).toBe('abc');
  });

  it('production 未配置 → 抛(双保险,不走 main.ts 也拦得住)', () => {
    expect(() => getJwtSecret(stubCfg({}), { NODE_ENV: 'production' })).toThrow(/JWT_SECRET/);
  });

  it('production 等于开发弱默认 → 抛', () => {
    expect(() =>
      getJwtSecret(stubCfg({ JWT_SECRET: DEV_JWT_SECRET }), { NODE_ENV: 'production' }),
    ).toThrow(DEV_JWT_SECRET);
  });

  it('production 配置强密钥 → 原样返回', () => {
    expect(getJwtSecret(stubCfg({ JWT_SECRET: 'strong-secret' }), { NODE_ENV: 'production' })).toBe(
      'strong-secret',
    );
  });
});
