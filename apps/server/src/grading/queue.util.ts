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

/** BULLMQ_PREFIX 未配置时的队列键前缀 */
export const DEFAULT_QUEUE_PREFIX = 'a5';

/**
 * 共享 Redis 纪律:本任务全部队列键加 a5: 前缀。
 * BullMQ 队列名禁止含冒号 → 用 prefix 选项实现,实际键形如 a5:pre_grading:*、a5:mastery:*。
 *
 * [2026-06-12 整合修复] 支持环境变量覆盖:多工作区并行测试共享 Redis 时,同名队列会被他库
 * worker 抢任务(A8/A7 均踩坑)。各工作区设 BULLMQ_PREFIX=<独立值> 即隔离;默认行为不变。
 *
 * [2026-08-22 audit-fix-server · D2] 改为**惰性读取**。原先是模块顶层的
 * `process.env.BULLMQ_PREFIX ?? 'a5'`,而本文件经 grading/mastery/courseware 三个 module
 * 在 app.module 的 top-level import 阶段就被求值 —— 早于 `ConfigModule.forRoot()` 灌入
 * `.env`,于是写进 `.env` 的 BULLMQ_PREFIX 静默失效(只有真实 shell 环境变量才生效),
 * 而这个变量存在的全部理由就是部署隔离。现在经 ConfigService 在队列构造时读取。
 */
export function queuePrefix(cfg: ConfigService): string {
  return (cfg.get<string>('BULLMQ_PREFIX', '') || '').trim() || DEFAULT_QUEUE_PREFIX;
}

export const PRE_GRADING_QUEUE = 'pre_grading';
export const MASTERY_QUEUE = 'mastery';
