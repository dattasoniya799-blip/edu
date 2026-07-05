/**
 * WS 重连状态机(纯函数,vitest 单测覆盖)
 *
 * idle ──open──▶ connecting ──connected──▶ joining ──joined──▶ live
 *                    │                        │  │               │
 *                    └────────lost────────────┴──┼──────lost─────┘
 *                                   ▼            └──rejected──▶ rejected(业务拒绝终态,仅 close 可离开)
 *                waiting(指数退避 nextDelay) ──retry──▶ connecting
 * lost 时若连续失败已超 maxAttempts ──▶ failed(不再自动重试)──open(手动重试,attempt 清零)──▶ connecting
 * 任意状态 ──close──▶ closed(终态,主动退出课堂)
 *
 * attempt 在 joined 时清零;lost 时用当前 attempt 计算退避并 +1。
 * join ack 超时(断线,走 lost 退避)与业务拒绝(exception,走 rejected 终态)是两条独立路径。
 */

export interface BackoffOpts {
  /** 首次重试延迟 */
  baseMs: number;
  /** 退避倍率 */
  factor: number;
  /** 延迟上限 */
  maxMs: number;
  /** 最大连续自动重试次数(超限 → failed,等待手动重试);缺省 8 */
  maxAttempts?: number;
}

export const DEFAULT_BACKOFF: BackoffOpts = { baseMs: 1000, factor: 2, maxMs: 15000, maxAttempts: 8 };

/** BackoffOpts.maxAttempts 缺省值 */
export const DEFAULT_MAX_ATTEMPTS = 8;

/** 第 attempt 次(从 0 起)重试前的等待时长:base·factor^attempt,封顶 max */
export function nextDelay(attempt: number, o: BackoffOpts = DEFAULT_BACKOFF): number {
  return Math.min(o.baseMs * o.factor ** Math.max(0, attempt), o.maxMs);
}

export type WsPhase = 'idle' | 'connecting' | 'joining' | 'live' | 'waiting' | 'rejected' | 'failed' | 'closed';

export interface WsConnState {
  phase: WsPhase;
  /** 连续失败次数(joined 清零) */
  attempt: number;
  /** waiting 态的重试延迟;其余态为 null */
  delayMs: number | null;
}

export type WsConnEvent =
  | { type: 'open' }       // 发起 connect(首连 / 重试 / failed 态手动重试)
  | { type: 'connected' }  // 传输层握手成功 → 去 join
  | { type: 'joined' }     // join ack 拿到 snapshot
  | { type: 'lost' }       // 断线 / 握手失败 / join 超时
  | { type: 'retry' }      // 退避计时器到点
  | { type: 'rejected' }   // join 被服务端业务拒绝(exception:课堂已结束/不是本课学生等)
  | { type: 'close' };     // 主动关闭(退出课堂 / 下课)

export const initialConn: WsConnState = { phase: 'idle', attempt: 0, delayMs: null };

export function reduceConn(s: WsConnState, e: WsConnEvent, backoff: BackoffOpts = DEFAULT_BACKOFF): WsConnState {
  if (s.phase === 'closed') return s; // 终态
  if (s.phase === 'rejected' && e.type !== 'close') return s; // 业务拒绝终态:不重连,只能退出
  switch (e.type) {
    case 'close':
      return { phase: 'closed', attempt: s.attempt, delayMs: null };
    case 'open':
      if (s.phase === 'idle' || s.phase === 'waiting') return { ...s, phase: 'connecting', delayMs: null };
      if (s.phase === 'failed') return { phase: 'connecting', attempt: 0, delayMs: null }; // 手动重试:退避从头起步
      return s;
    case 'connected':
      return s.phase === 'connecting' ? { ...s, phase: 'joining' } : s;
    case 'joined':
      return s.phase === 'joining' ? { phase: 'live', attempt: 0, delayMs: null } : s;
    case 'rejected':
      // 仅 joining 阶段的 exception 视为 join 业务拒绝;live 期间的业务异常不断开连接
      return s.phase === 'joining' ? { phase: 'rejected', attempt: s.attempt, delayMs: null } : s;
    case 'lost':
      if (s.phase === 'connecting' || s.phase === 'joining' || s.phase === 'live') {
        const attempt = s.attempt + 1;
        if (attempt > (backoff.maxAttempts ?? DEFAULT_MAX_ATTEMPTS)) {
          return { phase: 'failed', attempt, delayMs: null }; // 超限:停止自动重试,等手动
        }
        return { phase: 'waiting', attempt, delayMs: nextDelay(s.attempt, backoff) };
      }
      return s;
    case 'retry':
      return s.phase === 'waiting' ? { ...s, phase: 'connecting', delayMs: null } : s;
  }
}
