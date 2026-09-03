/**
 * 监控数据源抽象(可替换接入层)
 * 页面只依赖 MonitorSource 接口;事件载荷类型 = ws-protocol.ts 的 S2TEvents。
 *
 * - mock 模式(VITE_USE_MOCK === 'true'):createMockMonitorSource —— 每 5s 推一帧
 *   monitor:roster(+状态跃迁时 monitor:alert),帧由 src/mocks/monitorStream.ts 确定性生成。
 * - 真实模式(VITE_USE_MOCK === 'false'):createRealMonitorSource —— socket.io 接入后端
 *   /classroom 网关(apps/server ClassroomGateway,只读对照):
 *     1) 握手 auth.token = JWT(教师令牌,对齐 JwtAuthGuard 口径);
 *     2) connect 后以本课教师身份 emit 'class:join' { sessionId } —— 后端校验仅本课授课教师,
 *        通过后把该 socket 加入监控房 session:{id}:teacher 并立即推一帧 roster(markDirty);
 *        监控房没有专门订阅事件,class:join(教师身份)即自动进监控房(见 classroom.service.ts join);
 *     3) on('monitor:roster' | 'monitor:alert') 直接透传给页面 handlers(载荷形状逐字 = S2TEvents);
 *     4) stop = () => socket.disconnect();断线由 socket.io 内建重连恢复,connect 再次触发自动重入监控房。
 *   页面 reducer(lib/roster)与 UI 零改动。
 */
import { io, type Socket } from 'socket.io-client';
import type { C2SEvents, ClassControl, ClassSnapshot, S2TEvents } from '@qiming/contracts';
import { mockAlertsAt, mockRosterFrame } from '../../mocks/monitorStream';
import type { AlertEvent, RosterEvent } from './lib/roster';

/**
 * A6 业务异常通道(对齐 Nest WsException 行为,不在契约 S2TEvents 内;join 被拒/越权经此下发);
 * class:control 是 S2C 广播,教师若在会话房间也会收到(2026-09-02 控场同步)。
 */
type S2TWithException = S2TEvents & {
  exception: (p: { status: number | string; message: string }) => void;
  'class:control': (c: ClassControl) => void;
};

export interface MonitorHandlers {
  onRoster: (e: RosterEvent) => void;
  onAlert: (e: AlertEvent) => void;
  /** class:join 的 ack 快照(会话状态 / 环节表);2026-09-02 起用它判定「已连上」,不再只等首帧 roster */
  onSnapshot?: (snap: ClassSnapshot) => void;
  /** 服务端广播的控场动作(自己发的也会回来),用于同步 paused / ended 态 */
  onControl?: (c: ClassControl) => void;
  /** 服务端拒绝(如非本课教师、课堂已结束) */
  onException?: (message: string) => void;
}

export interface MonitorSource {
  /** 开始订阅;返回停止函数(组件卸载时调用) */
  connect: (h: MonitorHandlers) => () => void;
  /**
   * [2026-09-02 走查 B-1] 教师控场:暂停 / 继续 / 强制切环节 / 下课。
   * 协议 C2SEvents['class:control'] 与服务端状态机早已齐全,此前监控页只监听、从未发出,课堂永远结束不了。
   */
  control: (c: ClassControl) => void;
}

export interface MonitorSourceOptions {
  /**
   * 真实模式 class:join 的目标 ClassSession id(教师以本课教师身份进监控房)。
   * 取自契约 LessonDto.sessionId(GET /lessons/:id;[2026-06-14 B6 课堂]补充的当前讲次最新未结束
   * ClassSession id)。监控路由以 lessonId 为参,页面用拿到的 sessionId 连 WS;sessionId 为 null
   * (无在开会话)时页面不连、给出"课堂未开始"提示。
   */
  sessionId: number;
  /** 握手 JWT(auth.token);取自 teacher auth/token */
  token: string | null;
  /** 服务地址(默认同源,经 vite /socket.io 代理到后端;ws 升级);测试可注入 http://127.0.0.1:{port} */
  url?: string;
  /** socket.io path(默认 /socket.io) */
  path?: string;
  /** mock 帧节流(默认 5s,同真实服务端);仅 mock 模式生效 */
  intervalMs?: number;
}

/** mock 源:立即推第 0 帧,此后每 intervalMs(默认 5s,同真实服务端节流)推下一帧 */
export function createMockMonitorSource(intervalMs = 5000): MonitorSource {
  let handlers: MonitorHandlers | null = null;
  return {
    connect(h) {
      handlers = h;
      let tick = 0;
      const emit = () => {
        h.onRoster(mockRosterFrame(tick));
        for (const a of mockAlertsAt(tick)) h.onAlert(a);
        tick += 1;
      };
      emit();
      const timer = setInterval(emit, intervalMs);
      return () => { clearInterval(timer); handlers = null; };
    },
    // mock:控场直接回显(无服务端),页面状态机与真实模式同一条路
    control(c) { handlers?.onControl?.(c); },
  };
}

/** 真实源:socket.io 接入 /classroom 网关,教师 class:join 进监控房,透传 monitor:roster/alert */
export function createRealMonitorSource(opts: MonitorSourceOptions): MonitorSource {
  let socket: Socket<S2TWithException, C2SEvents> | null = null;
  return {
    connect(h) {
      socket = io(`${opts.url ?? ''}/classroom`, {
        path: opts.path,
        auth: { token: opts.token ?? '' },
        transports: ['websocket'],
      });
      const s = socket;
      // 教师身份 class:join → 后端自动入监控房并推首帧 roster;ack 快照给页面(会话状态 / 环节表);
      // 重连后 connect 再次触发,自动重入
      const joinMonitor = (): void => {
        s.emit('class:join', { sessionId: opts.sessionId }, (snap) => { if (snap) h.onSnapshot?.(snap); });
      };
      s.on('connect', joinMonitor);
      s.on('monitor:roster', h.onRoster);
      s.on('monitor:alert', h.onAlert);
      s.on('class:control', (c) => h.onControl?.(c));
      s.on('exception', (p) => {
        // eslint-disable-next-line no-console
        console.warn('[monitor] 服务端异常:', p?.message);
        h.onException?.(String(p?.message ?? '服务端异常'));
      });
      s.on('connect_error', (err) => {
        // eslint-disable-next-line no-console
        console.warn('[monitor] 连接失败:', err.message);
      });
      return () => { s.disconnect(); if (socket === s) socket = null; };
    },
    control(c) { socket?.emit('class:control', c); },
  };
}

/** 工厂:按运行模式选择数据源(页面唯一入口) */
export function createMonitorSource(opts: MonitorSourceOptions): MonitorSource {
  return import.meta.env.VITE_USE_MOCK === 'true'
    ? createMockMonitorSource(opts.intervalMs)
    : createRealMonitorSource(opts);
}
