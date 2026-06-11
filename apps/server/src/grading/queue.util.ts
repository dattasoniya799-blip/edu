import type { ConfigService } from '@nestjs/config';
import type { ConnectionOptions } from 'bullmq';

/**
 * BullMQ 连接参数(A5 队列共用):
 * 由 REDIS_URL 解析;BullMQ 自行管理连接(Worker 的阻塞连接要求
 * maxRetriesPerRequest=null,故不复用 RedisModule 的实例)。
 */
export function bullConnection(cfg: ConfigService): ConnectionOptions {
  const url = new URL(cfg.get<string>('REDIS_URL', 'redis://127.0.0.1:6379'));
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    ...(url.password ? { password: url.password } : {}),
    maxRetriesPerRequest: null,
  };
}

/**
 * 共享 Redis 纪律:本任务全部队列键加 a5: 前缀。
 * BullMQ 队列名禁止含冒号 → 用 prefix 选项实现,实际键形如 a5:pre_grading:*、a5:mastery:*。
 */
export const QUEUE_PREFIX = 'a5';
export const PRE_GRADING_QUEUE = 'pre_grading';
export const MASTERY_QUEUE = 'mastery';
