/**
 * 课堂热状态 Redis 键(设计文档 7.4 形状)。
 * 共享 Redis 纪律:本任务所有键加 `a6:` 业务前缀(可经 CLS_REDIS_PREFIX 覆盖,
 * 生产切独立 Redis 时置空即回到文档原始键名),teardown 按前缀 SCAN+DEL 自清,
 * 禁止 FLUSHALL/FLUSHDB。
 *
 * [2026-08-22 audit-fix-server · D2] 前缀改为**惰性读取**。原先是模块顶层常量
 * `process.env.CLS_REDIS_PREFIX ?? 'a6:'`,而本文件经 classroom.module 在 app.module 的
 * top-level import 阶段就被求值 —— 早于 `ConfigModule.forRoot()` 灌入 `.env`,于是写进
 * `.env` 的 CLS_REDIS_PREFIX 静默回落 'a6:'(只有真实 shell 环境变量才生效)。
 * 键构造函数每次调用时现读,`.env` 与 shell 两条路径都生效。
 *
 * 注:这里读 `process.env` 而非 ConfigService —— 键构造是纯函数、被 WS 热路径逐帧调用,
 * 不宜改成需要注入的实例方法;ConfigModule 已在启动时把 `.env` 灌进 `process.env`,
 * 只要求值发生在**运行期**(而非 import 期)即可拿到正确值。
 */
export const DEFAULT_CLS_PREFIX = 'a6:';

/** 当前生效的课堂键前缀(运行期求值;显式空串 = 无前缀,回到文档原始键名) */
export const clsPrefix = (): string => process.env.CLS_REDIS_PREFIX ?? DEFAULT_CLS_PREFIX;

/** HASH:status / segment 配置 / 开始时间(7.4 cls:{sid}:meta) */
export const kMeta = (sid: number) => `${clsPrefix()}cls:${sid}:meta`;
/** HASH:segment,q_index,correct,wrong,state,last_heartbeat,ai_ask_count(7.4 cls:{sid}:stu:{uid}) */
export const kStu = (sid: number, uid: number) => `${clsPrefix()}cls:${sid}:stu:${uid}`;
export const kStuPattern = (sid: number) => `${clsPrefix()}cls:${sid}:stu:*`;
/** STREAM:事件流,消费者批量落库 session_events(7.4 cls:{sid}:events) */
export const kEvents = (sid: number) => `${clsPrefix()}cls:${sid}:events`;
/** 消费游标(最后已落库的 stream id;Redis 丢失即从头不丢——流同删,以 PG 为准) */
export const kEventsCursor = (sid: number) => `${clsPrefix()}cls:${sid}:events_cursor`;
/** ZSET:member=uid score=开始停留时间(秒)(7.4 cls:{sid}:stuck) */
export const kStuck = (sid: number) => `${clsPrefix()}cls:${sid}:stuck`;
/** 本会话全部键(结算/teardown 清理用) */
export const kSessionPattern = (sid: number) => `${clsPrefix()}cls:${sid}:*`;
/** 懒建随堂练的互斥锁键 */
export const kInClassLock = (lessonId: number | string, paperId: number | string) =>
  `${clsPrefix()}inclass_lock:${lessonId}:${paperId}`;
