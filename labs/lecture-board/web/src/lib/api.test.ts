import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { connectEvents } from './api';
import type { ServerEvent } from '../types';

/**
 * 运行问题复查(2026-09-17)· 连接与恢复:SSE 连接在 lesson 完成后要释放,不能因为用户站在结果页
 * 不走(或者重连到一节早就 failed 的课)就永远开着 —— server 那边的心跳定时器/订阅跟着漏。
 */

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  constructor(public url: string) {
    FakeEventSource.instances.push(this);
  }
  emit(event: ServerEvent) {
    this.onmessage?.({ data: JSON.stringify(event) });
  }
  close() {
    this.closed = true;
  }
}

beforeEach(() => {
  FakeEventSource.instances = [];
  vi.stubGlobal('EventSource', FakeEventSource as unknown as typeof EventSource);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('connectEvents · 到终态后自动关闭 SSE 连接', () => {
  it('收到 complete 事件后自动 close,不用等组件卸载', () => {
    const events: ServerEvent[] = [];
    connectEvents('lesson-1', { onEvent: (e) => events.push(e) });
    const es = FakeEventSource.instances[0];
    expect(es.closed).toBe(false);
    es.emit({ type: 'complete' });
    expect(es.closed).toBe(true);
    expect(events).toEqual([{ type: 'complete' }]);
  });

  it('收到 error 事件(流水线致命错误)后也自动 close', () => {
    connectEvents('lesson-2', { onEvent: () => {} });
    const es = FakeEventSource.instances[0];
    es.emit({ type: 'error', message: '出剧本失败' });
    expect(es.closed).toBe(true);
  });

  it('重连到一节早就 failed 的课:snapshot 里 stage=failed 就直接 close,不用等 complete(从来不会来)', () => {
    connectEvents('lesson-3', { onEvent: () => {} });
    const es = FakeEventSource.instances[0];
    es.emit({
      type: 'snapshot',
      state: { id: 'lesson-3', createdAt: 'x', stage: 'failed', timings: {}, input: { images: [], answer: 'x' }, error: '挂了' }
    });
    expect(es.closed).toBe(true);
  });

  it('snapshot 里 stage=ready(重连到一节早就讲完的课)也直接 close', () => {
    connectEvents('lesson-4', { onEvent: () => {} });
    const es = FakeEventSource.instances[0];
    es.emit({
      type: 'snapshot',
      state: { id: 'lesson-4', createdAt: 'x', stage: 'ready', timings: {}, input: { images: [], answer: 'x' } }
    });
    expect(es.closed).toBe(true);
  });

  it('还在跑的课(stage=recognizing)不会被误关', () => {
    connectEvents('lesson-5', { onEvent: () => {} });
    const es = FakeEventSource.instances[0];
    es.emit({
      type: 'snapshot',
      state: { id: 'lesson-5', createdAt: 'x', stage: 'recognizing', timings: {}, input: { images: [], answer: 'x' } }
    });
    expect(es.closed).toBe(false);
    es.emit({ type: 'stage', stage: 'planning', status: 'start' });
    expect(es.closed).toBe(false);
  });

  it('手动 close() 依然生效(组件卸载路径不受影响)', () => {
    const stream = connectEvents('lesson-6', { onEvent: () => {} });
    const es = FakeEventSource.instances[0];
    stream.close();
    expect(es.closed).toBe(true);
  });
});
