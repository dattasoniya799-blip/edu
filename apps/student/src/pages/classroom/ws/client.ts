/**
 * 课堂 WS 客户端封装(事件名/负载形状逐字遵守 @qiming/contracts ws-protocol.ts)
 *
 * - 命名空间 /classroom,握手 auth.token = JWT(A6 口径)
 * - connect → class:join ack 取 ClassSnapshot 渲染;重连后再次 join,用快照无感恢复
 * - 心跳 class:heartbeat 每 10s(可注入,测试用短周期),携带 currentQuestion/idleSec
 * - 断线指数退避重连:自管状态机(ws/reconnect.ts,关闭 socket.io 内建重连以便单测)
 * - 服务端业务异常经 'exception' 事件下发(A6 README 口径,非契约事件,仅日志/提示)
 */
import { io, type Socket } from 'socket.io-client';
import type {
  AnswerResponse, AnswerResult, ClassControl, ParticipantSelfState, S2CEvents, C2SEvents,
} from '@qiming/contracts';
import type { ClassJoinSnapshot } from '../types';
import {
  DEFAULT_BACKOFF, initialConn, reduceConn,
  type BackoffOpts, type WsConnEvent, type WsConnState,
} from './reconnect';

/** A6 业务异常通道(对齐 Nest WsException 行为,不在契约 S2CEvents 内) */
type S2CWithException = S2CEvents & { exception: (p: { status: number; message: string }) => void };

export type ClassSocket = Socket<S2CWithException, C2SEvents>;

export interface ClassWsHandlers {
  /** join ack(首连与每次重连都会触发;resumed=true 表示重连恢复) */
  onSnapshot?(snap: ClassJoinSnapshot, info: { resumed: boolean }): void;
  /** 连接状态变化(渲染「重连中…第 N 次」等) */
  onConn?(state: WsConnState): void;
  onNarration?(text: string): void;
  onAiChunk?(p: { requestId: string; delta: string; done: boolean }): void;
  onControl?(c: ClassControl): void;
  onState?(s: ParticipantSelfState): void;
  onException?(p: { status: number; message: string }): void;
}

export interface ClassWsOptions {
  sessionId: number;
  token: string | null;
  /** 服务地址(默认同源);测试传 http://127.0.0.1:{port} */
  url?: string;
  /** socket.io path(默认 /socket.io) */
  path?: string;
  /** 心跳周期,默认 10s(任务卡);测试注入短周期 */
  heartbeatMs?: number;
  /** join ack 超时(超时按断线处理重试) */
  joinTimeoutMs?: number;
  /** answer ack 超时 */
  ackTimeoutMs?: number;
  backoff?: BackoffOpts;
}

export class ClassroomWsClient {
  readonly socket: ClassSocket;
  private conn: WsConnState = initialConn;
  private readonly backoff: BackoffOpts;
  private readonly heartbeatMs: number;
  private readonly joinTimeoutMs: number;
  private readonly ackTimeoutMs: number;
  private hbTimer: ReturnType<typeof setInterval> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private joinTimer: ReturnType<typeof setTimeout> | null = null;
  private joinedOnce = false;
  private lastActivityAt = Date.now();
  private currentQuestion: number | null = null;

  constructor(private readonly opts: ClassWsOptions, private readonly handlers: ClassWsHandlers = {}) {
    this.backoff = opts.backoff ?? DEFAULT_BACKOFF;
    this.heartbeatMs = opts.heartbeatMs ?? 10_000;
    this.joinTimeoutMs = opts.joinTimeoutMs ?? 8_000;
    this.ackTimeoutMs = opts.ackTimeoutMs ?? 8_000;

    this.socket = io(`${opts.url ?? ''}/classroom`, {
      path: opts.path,
      auth: { token: opts.token ?? '' },
      transports: ['websocket'],
      reconnection: false, // 重连自管(指数退避,可单测)
      autoConnect: false,
    });

    this.socket.on('connect', () => {
      this.transition({ type: 'connected' });
      this.join();
    });
    this.socket.on('connect_error', () => this.onLost());
    this.socket.on('disconnect', (reason) => {
      if (reason !== 'io client disconnect') this.onLost();
    });
    this.socket.on('class:narration', (p) => this.handlers.onNarration?.(p.text));
    this.socket.on('class:ai_chunk', (p) => this.handlers.onAiChunk?.(p));
    this.socket.on('class:state', (p) => this.handlers.onState?.(p));
    this.socket.on('class:control', (c) => this.handlers.onControl?.(c));
    this.socket.on('exception', (p) => this.handlers.onException?.(p));
  }

  get connState(): WsConnState { return this.conn; }

  connect(): void {
    if (this.conn.phase !== 'idle') return;
    this.transition({ type: 'open' });
    this.socket.connect();
  }

  /** 主动退出(下课/离开课堂):不再重连 */
  close(): void {
    this.transition({ type: 'close' });
    this.stopHeartbeat();
    this.clearTimers();
    this.socket.disconnect();
  }

  // ---------------- C2S(事件名/负载逐字契约) ----------------

  /** 切环节(可点步进器) */
  segment(segmentSeq: number): void {
    this.markActivity();
    this.socket.emit('class:segment', { segmentSeq });
  }

  /** 随堂作答(等价 REST 的 WS 通道,ack = AnswerResult) */
  answer(questionId: number, response: AnswerResponse): Promise<AnswerResult> {
    this.markActivity(questionId);
    return new Promise<AnswerResult>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) { settled = true; reject(new Error('作答提交超时,请检查网络后重试')); }
      }, this.ackTimeoutMs);
      this.socket.emit('class:answer', { questionId, response }, (r) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(r);
      });
    });
  }

  /** AI 答疑(回复以 class:ai_chunk 流式下发) */
  aiAsk(message: string, questionId: number | null): void {
    this.markActivity();
    this.socket.emit('class:ai_ask', { questionId, message });
  }

  handUp(): void {
    this.markActivity();
    this.socket.emit('class:hand_up', {});
  }

  /** 作答/翻题/提问时调用:重置 idle 计时,并同步心跳的 currentQuestion */
  markActivity(currentQuestion?: number | null): void {
    this.lastActivityAt = Date.now();
    if (currentQuestion !== undefined) this.currentQuestion = currentQuestion;
  }

  /** 当前空闲秒数(心跳负载;服务端据此驱动 stuck 检测) */
  idleSec(): number {
    return Math.max(0, Math.floor((Date.now() - this.lastActivityAt) / 1000));
  }

  // ---------------- 内部:join / 心跳 / 重连 ----------------

  private join(): void {
    this.clearJoinTimer();
    // A6:join 被拒时 ack 不回包 → 超时按断线处理(继续退避重试)
    this.joinTimer = setTimeout(() => this.onLost(), this.joinTimeoutMs);
    this.socket.emit('class:join', { sessionId: this.opts.sessionId }, (snap) => {
      this.clearJoinTimer();
      if (this.conn.phase !== 'joining') return; // 迟到的 ack(已超时进入退避/已关闭)不处理
      this.transition({ type: 'joined' });
      const resumed = this.joinedOnce;
      this.joinedOnce = true;
      this.startHeartbeat();
      this.handlers.onSnapshot?.(snap as ClassJoinSnapshot, { resumed });
    });
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.hbTimer = setInterval(() => {
      if (this.socket.connected) {
        this.socket.emit('class:heartbeat', { currentQuestion: this.currentQuestion, idleSec: this.idleSec() });
      }
    }, this.heartbeatMs);
  }

  private stopHeartbeat(): void {
    if (this.hbTimer != null) { clearInterval(this.hbTimer); this.hbTimer = null; }
  }

  private onLost(): void {
    this.stopHeartbeat();
    this.clearJoinTimer();
    if (this.conn.phase === 'closed' || this.conn.phase === 'waiting') return;
    this.transition({ type: 'lost' });
    const delay = this.conn.delayMs ?? 0;
    this.retryTimer = setTimeout(() => {
      if (this.conn.phase !== 'waiting') return;
      this.transition({ type: 'retry' });
      this.socket.connect();
    }, delay);
  }

  private transition(e: WsConnEvent): void {
    const next = reduceConn(this.conn, e, this.backoff);
    if (next === this.conn) return;
    this.conn = next;
    this.handlers.onConn?.(next);
  }

  private clearJoinTimer(): void {
    if (this.joinTimer != null) { clearTimeout(this.joinTimer); this.joinTimer = null; }
  }

  private clearTimers(): void {
    this.clearJoinTimer();
    if (this.retryTimer != null) { clearTimeout(this.retryTimer); this.retryTimer = null; }
  }
}
