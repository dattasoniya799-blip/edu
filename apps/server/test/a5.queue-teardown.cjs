/**
 * A5 · jest 全局收尾:清理本任务的 BullMQ 队列键(a5: 前缀纪律)。
 * 任意 spec 启动 AppModule 都会创建队列 meta 键,故在套件结束时统一清除。
 */
module.exports = async () => {
  const Redis = require('ioredis');
  const redis = new Redis(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379', {
    maxRetriesPerRequest: 2,
  });
  try {
    // C3-back:队列前缀随 BULLMQ_PREFIX(本工作区=c3),自清对应键,默认 a5 不变
    const prefix = process.env.BULLMQ_PREFIX || 'a5';
    const keys = [
      ...(await redis.keys(`${prefix}:pre_grading:*`)),
      ...(await redis.keys(`${prefix}:mastery:*`)),
    ];
    if (keys.length) await redis.del(...keys);
  } finally {
    await redis.quit().catch(() => undefined);
  }
};
