/**
 * 监控数据源抽象(可替换接入层)
 * 页面只依赖 MonitorSource 接口;事件载荷类型 = ws-protocol.ts 的 S2TEvents。
 *
 * - mock 模式(VITE_USE_MOCK !== 'false'):createMockMonitorSource —— 每 5s 推一帧
 *   monitor:roster(+状态跃迁时 monitor:alert),帧由 src/mocks/monitorStream.ts 确定性生成。
 * - A6 联调:实现同接口的 socket.io 源即可整体替换 ——
 *     io('/classroom', { auth: { token } }) 后
 *     socket.on('monitor:roster', h.onRoster); socket.on('monitor:alert', h.onAlert);
 *     返回的 stop = () => socket.disconnect()。页面与 reducer 零改动。
 */
import { mockAlertsAt, mockRosterFrame } from '../../mocks/monitorStream';
import type { AlertEvent, RosterEvent } from './lib/roster';

export interface MonitorHandlers {
  onRoster: (e: RosterEvent) => void;
  onAlert: (e: AlertEvent) => void;
}

export interface MonitorSource {
  /** 开始订阅;返回停止函数(组件卸载时调用) */
  connect: (h: MonitorHandlers) => () => void;
}

/** mock 源:立即推第 0 帧,此后每 intervalMs(默认 5s,同真实服务端节流)推下一帧 */
export function createMockMonitorSource(intervalMs = 5000): MonitorSource {
  return {
    connect(h) {
      let tick = 0;
      const emit = () => {
        h.onRoster(mockRosterFrame(tick));
        for (const a of mockAlertsAt(tick)) h.onAlert(a);
        tick += 1;
      };
      emit();
      const timer = setInterval(emit, intervalMs);
      return () => clearInterval(timer);
    },
  };
}

/** 真实源占位:A6 交付 /classroom 命名空间后按头部注释实现并在此返回 */
function createRealMonitorSource(): MonitorSource {
  return {
    connect() {
      // eslint-disable-next-line no-console
      console.warn('[monitor] 真实 WebSocket 源待 A6 联调接入(socket.io /classroom · monitor:roster/monitor:alert)');
      return () => {};
    },
  };
}

/** 工厂:按运行模式选择数据源(页面唯一入口) */
export function createMonitorSource(): MonitorSource {
  return import.meta.env.VITE_USE_MOCK !== 'false' ? createMockMonitorSource() : createRealMonitorSource();
}
