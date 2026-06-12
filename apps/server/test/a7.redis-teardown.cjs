/**
 * A7 · jest 全局收尾:先执行 A5 的队列清理,再清 a7: 前缀键(共享 Redis 纪律,测试自清)。
 * 说明:a5/a7 等 spec 经真实 BullMQ 触发预批时,A7 网关会按 org 计量
 * (a7:ai:cost:{orgId}:{yyyy-MM} 等),夹具 org 随用例销毁,这里兜底清掉全部测试残留。
 */
const a5Teardown = require('./a5.queue-teardown.cjs');

module.exports = async () => {
  await a5Teardown();
  const Redis = require('ioredis');
  const redis = new Redis(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379', {
    maxRetriesPerRequest: 2,
  });
  try {
    const keys = await redis.keys('a7:ai:*');
    if (keys.length) await redis.del(...keys);
  } finally {
    await redis.quit().catch(() => undefined);
  }
};
