/**
 * jest 全局前置:清掉上一轮 e2e 残留的 access token 吊销键(auth:disabled:* / auth:pwdreset:*)。
 * 背景(2026-09-02 走查 D-1 引入停用即时吊销后暴露):这些键按 uid 记、TTL 2h;e2e 夹具建 org 后
 * 停用某用户却随 dropOrg 直接删库、不走 enable,键留在 Redis;整库重建后 users 序列归零,新夹具的
 * 用户复用到同一 uid 就会被上一轮的停用位误杀(fix4 教师 401)。生产 uid 永不复用,不受影响。
 * 只删 auth:* 两个前缀,不 FLUSH(共享 Redis 纪律);teardown 同样清一遍,避免留给演示环境。
 */
module.exports = async () => {
  const Redis = require('ioredis');
  const redis = new Redis(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379', { maxRetriesPerRequest: 2 });
  try {
    const keys = [...(await redis.keys('auth:disabled:*')), ...(await redis.keys('auth:pwdreset:*'))];
    if (keys.length) await redis.del(...keys);
  } finally {
    await redis.quit().catch(() => undefined);
  }
};
