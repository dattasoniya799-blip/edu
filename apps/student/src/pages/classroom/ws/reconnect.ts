/**
 * WS 重连状态机(纯函数,vitest 单测覆盖)
 *
 * idle ──open──▶ connecting ──connected──▶ joining ──joined──▶ live
 *                    │                        │                  │
 *                    └────────lost────────────┴───────lost───────┘
 *                                   ▼
 *                waiting(指数退避 nextDelay) ──retry──▶ connecting
 * 任意状态 ──close──▶ closed(终态,主动退出课堂)
 *
 * attempt 在 joined 时清零;lost 时用当前 attempt 计算退避并 +1。
 */

export interface BackoffOpts {
  /** 首次重试延迟 */
  baseMs: number;
  /** 退避倍率 */
  factor: number;
  /** 延迟上限 */
  maxMs: number;
}

export const DEFAULT_BACKOFF: BackoffOpts = { baseMs: 1000, factor: 2, maxMs: 15000 };

/** 第 attempt 次(从 0 起)重试前的等待时长:base·factor^attempt,封顶 max */
export function nextDelay(attempt: number, o: BackoffOpts = DEFAULT_BACKOFF): number {
  return Math.min(o.baseMs * o.factor ** Math.max(0, attempt), o.maxMs);
}

export type WsPhase = 'idle' | 'connecting' | 'joining' | 'live' | 'waiting' | 'closed';

export interface WsConnState {
  phase: WsPhase;
  /** 连续失败次数(joined 清零) */
  attempt: number;
  /** waiting 态的重试延迟;其余态为 null */
  delayMs: number | null;
}

export type WsConnEvent =
  | { type: 'open' }       // 发起(首连或重试触发的)connect
  | { type: 'connected' }  // 传输层握手成功 → 去 join
  | { type: 'joined' }     // join ack 拿到 snapshot
  | { type: 'lost' }       // 断线 / 握手失败 / join 超时
  | { type: 'retry' }      // 退避计时器到点
  | { type: 'close' };     // 主动关闭(退出课堂 / 下课)

export const initialConn: WsConnState = { phase: 'idle', attempt: 0, delayMs: null };

export function reduceConn(s: WsConnState, e: WsConnEvent, backoff: BackoffOpts = DEFAULT_BACKOFF): WsConnState {
  if (s.phase === 'closed') return s; // 终态
  switch (e.type) {
    case 'close':
      return { phase: 'closed', attempt: s.attempt, delayMs: null };
    case 'open':
      if (s.phase === 'idle' || s.phase === 'waiting') return { ...s, phase: 'connecting', delayMs: null };
      return s;
    case 'connected':
      return s.phase === 'connecting' ? { ...s, phase: 'joining' } : s;
    case 'joined':
      return s.phase === 'joining' ? { phase: 'live', attempt: 0, delayMs: null } : s;
    case 'lost':
      if (s.phase === 'connecting' || s.phase === 'joining' || s.phase === 'live') {
        return { phase: 'waiting', attempt: s.attempt + 1, delayMs: nextDelay(s.attempt, backoff) };
      }
      return s;
    case 'retry':
      return s.phase === 'waiting' ? { ...s, phase: 'connecting', delayMs: null } : s;
  }
}
