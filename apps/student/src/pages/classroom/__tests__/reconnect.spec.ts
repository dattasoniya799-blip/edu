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

describe('重连上限(failed)与手动重试', () => {
  it('默认上限 8:第 9 次连续失败 → failed(不再进入退避)', () => {
    let s = step(initialConn, ['open', 'connected', 'joined']);
    for (let i = 0; i < 8; i++) {
      s = reduceConn(s, { type: 'lost' });
      expect(s.phase).toBe('waiting'); // 前 8 次失败仍自动重试
      s = reduceConn(s, { type: 'retry' });
    }
    s = reduceConn(s, { type: 'lost' });
    expect(s).toEqual({ phase: 'failed', attempt: 9, delayMs: null });
  });

  it('maxAttempts 可注入:2 次重试后第 3 次失败 → failed', () => {
    const o = { baseMs: 10, factor: 2, maxMs: 40, maxAttempts: 2 };
    let s = step(initialConn, ['open']);
    s = reduceConn(s, { type: 'lost' }, o);
    s = reduceConn(s, { type: 'retry' }, o);
    s = reduceConn(s, { type: 'lost' }, o);
    s = reduceConn(s, { type: 'retry' }, o);
    s = reduceConn(s, { type: 'lost' }, o);
    expect(s).toMatchObject({ phase: 'failed', attempt: 3 });
  });

  it('failed 吸收 lost/retry/connected/joined;open(手动重试)→ connecting 且 attempt 清零', () => {
    const failed = { phase: 'failed', attempt: 9, delayMs: null } as const;
    for (const type of ['lost', 'retry', 'connected', 'joined', 'rejected'] as const) {
      expect(reduceConn(failed, { type })).toEqual(failed);
    }
    expect(reduceConn(failed, { type: 'open' })).toEqual({ phase: 'connecting', attempt: 0, delayMs: null });
    expect(reduceConn(failed, { type: 'close' }).phase).toBe('closed');
  });
});

describe('join 业务拒绝(rejected)', () => {
  it('仅 joining 阶段的 rejected 生效(join 被拒);live 期间业务异常不断开', () => {
    const joining = step(initialConn, ['open', 'connected']);
    expect(reduceConn(joining, { type: 'rejected' })).toEqual({ phase: 'rejected', attempt: 0, delayMs: null });
    const live = step(initialConn, ['open', 'connected', 'joined']);
    expect(reduceConn(live, { type: 'rejected' })).toBe(live);
    const waiting = step(initialConn, ['open', 'lost']);
    expect(reduceConn(waiting, { type: 'rejected' })).toBe(waiting);
  });

  it('rejected 为业务拒绝终态:不重连(与 join 超时的退避路径分离),仅 close 可离开', () => {
    let s = reduceConn(step(initialConn, ['open', 'connected']), { type: 'rejected' });
    for (const type of ['open', 'connected', 'joined', 'lost', 'retry', 'rejected'] as const) {
      s = reduceConn(s, { type });
      expect(s.phase).toBe('rejected');
    }
    expect(reduceConn(s, { type: 'close' }).phase).toBe('closed');
  });
});
