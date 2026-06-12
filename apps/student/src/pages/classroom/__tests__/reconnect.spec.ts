/**
 * WS 重连状态机单测(任务卡验收:WS 重连状态机关键逻辑 vitest 单测)
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BACKOFF, initialConn, nextDelay, reduceConn, type WsConnState,
} from '../ws/reconnect';

const step = (s: WsConnState, types: Parameters<typeof reduceConn>[1]['type'][]) =>
  types.reduce((acc, type) => reduceConn(acc, { type }), s);

describe('指数退避 nextDelay', () => {
  it('base·factor^attempt,封顶 max(默认 1s/2s/4s/8s/15s/15s…)', () => {
    const delays = [0, 1, 2, 3, 4, 5, 9].map((n) => nextDelay(n));
    expect(delays).toEqual([1000, 2000, 4000, 8000, 15000, 15000, 15000]);
  });
  it('可注入测试参数', () => {
    const o = { baseMs: 50, factor: 3, maxMs: 200 };
    expect([0, 1, 2, 3].map((n) => nextDelay(n, o))).toEqual([50, 150, 200, 200]);
  });
});

describe('重连状态机 reduceConn', () => {
  it('正常链路:idle→connecting→joining→live;joined 清零 attempt', () => {
    let s = step(initialConn, ['open', 'connected']);
    expect(s.phase).toBe('joining');
    s = reduceConn({ ...s, attempt: 3 }, { type: 'joined' });
    expect(s).toEqual({ phase: 'live', attempt: 0, delayMs: null });
  });

  it('断线:live→waiting 带指数退避延迟,attempt 递增;retry→connecting', () => {
    let s = step(initialConn, ['open', 'connected', 'joined']);
    const seen: number[] = [];
    for (let i = 0; i < 6; i++) {
      s = reduceConn(s, { type: 'lost' });
      expect(s.phase).toBe('waiting');
      seen.push(s.delayMs!);
      s = reduceConn(s, { type: 'retry' });
      expect(s.phase).toBe('connecting');
      expect(s.delayMs).toBeNull();
    }
    expect(seen).toEqual([1000, 2000, 4000, 8000, 15000, 15000]); // 指数退避 + 封顶
    expect(s.attempt).toBe(6);
  });

  it('重连成功后退避归零:joined → 再断线从 base 重新起步', () => {
    let s = step(initialConn, ['open', 'connected', 'joined', 'lost', 'retry', 'lost', 'retry', 'connected', 'joined']);
    expect(s).toMatchObject({ phase: 'live', attempt: 0 });
    s = reduceConn(s, { type: 'lost' });
    expect(s.delayMs).toBe(DEFAULT_BACKOFF.baseMs);
  });

  it('connecting/joining 阶段失败同样进入退避(握手失败/join 超时)', () => {
    let s = step(initialConn, ['open', 'lost']);
    expect(s).toMatchObject({ phase: 'waiting', attempt: 1, delayMs: 1000 });
    s = step(s, ['retry', 'connected', 'lost']);
    expect(s).toMatchObject({ phase: 'waiting', attempt: 2, delayMs: 2000 });
  });

  it('close 为终态:此后任何事件不再变更(不会幽灵重连)', () => {
    let s = step(initialConn, ['open', 'connected', 'joined', 'close']);
    expect(s.phase).toBe('closed');
    for (const type of ['open', 'connected', 'joined', 'lost', 'retry'] as const) {
      s = reduceConn(s, { type });
      expect(s.phase).toBe('closed');
    }
  });

  it('waiting 期间重复 lost 不叠加计数(计时器单飞)', () => {
    let s = step(initialConn, ['open', 'connected', 'joined', 'lost']);
    const once = s;
    s = reduceConn(s, { type: 'lost' });
    expect(s).toEqual(once);
  });
});
