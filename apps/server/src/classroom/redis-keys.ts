/**
 * 课堂热状态 Redis 键(设计文档 7.4 形状)。
 * 共享 Redis 纪律:本任务所有键加 `a6:` 业务前缀(可经 CLS_REDIS_PREFIX 覆盖,
 * 生产切独立 Redis 时置空即回到文档原始键名),teardown 按前缀 SCAN+DEL 自清,
 * 禁止 FLUSHALL/FLUSHDB。
 */
export const CLS_PREFIX = process.env.CLS_REDIS_PREFIX ?? 'a6:';

/** HASH:status / segment 配置 / 开始时间(7.4 cls:{sid}:meta) */
export const kMeta = (sid: number) => `${CLS_PREFIX}cls:${sid}:meta`;
/** HASH:segment,q_index,correct,wrong,state,last_heartbeat,ai_ask_count(7.4 cls:{sid}:stu:{uid}) */
export const kStu = (sid: number, uid: number) => `${CLS_PREFIX}cls:${sid}:stu:${uid}`;
export const kStuPattern = (sid: number) => `${CLS_PREFIX}cls:${sid}:stu:*`;
/** STREAM:事件流,消费者批量落库 session_events(7.4 cls:{sid}:events) */
export const kEvents = (sid: number) => `${CLS_PREFIX}cls:${sid}:events`;
/** 消费游标(最后已落库的 stream id;Redis 丢失即从头不丢——流同删,以 PG 为准) */
export const kEventsCursor = (sid: number) => `${CLS_PREFIX}cls:${sid}:events_cursor`;
/** ZSET:member=uid score=开始停留时间(秒)(7.4 cls:{sid}:stuck) */
export const kStuck = (sid: number) => `${CLS_PREFIX}cls:${sid}:stuck`;
/** 本会话全部键(结算/teardown 清理用) */
export const kSessionPattern = (sid: number) => `${CLS_PREFIX}cls:${sid}:*`;
