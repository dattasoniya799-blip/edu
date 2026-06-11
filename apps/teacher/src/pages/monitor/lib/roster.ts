/**
 * 监控页纯逻辑:roster 流 reducer(增量合并,保引用 → React 不整页重渲、不闪烁)
 * + 顶部统计派生 + 告警侧栏队列。全部纯函数,vitest 覆盖(验收项「roster 流 reducer」)
 */
import type { ParticipantMonitor, S2TEvents } from '@qiming/contracts';

/** monitor:roster / monitor:alert 事件载荷(形状直接取自 ws-protocol.ts,禁止重复定义) */
export type RosterEvent = Parameters<S2TEvents['monitor:roster']>[0];
export type AlertEvent = Parameters<S2TEvents['monitor:alert']>[0];

/** 两个参与者快照逐字段相等(ParticipantMonitor 为扁平结构) */
export function sameParticipant(a: ParticipantMonitor, b: ParticipantMonitor): boolean {
  return (
    a.studentId === b.studentId
    && a.studentName === b.studentName
    && a.segment === b.segment
    && a.currentQuestion === b.currentQuestion
    && a.answeredCount === b.answeredCount
    && a.correctCount === b.correctCount
    && a.state === b.state
    && a.stuckSec === b.stuckSec
    && a.aiAskCount === b.aiAskCount
    && a.online === b.online
  );
}

/**
 * 增量合并:未变化的参与者沿用旧对象引用(memo 卡片不重渲);
 * 全员无变化时返回 prev 本身(整页零重渲)。
 */
export function mergeRoster(prev: ParticipantMonitor[], incoming: ParticipantMonitor[]): ParticipantMonitor[] {
  const prevById = new Map(prev.map((p) => [p.studentId, p]));
  let changed = prev.length !== incoming.length;
  const next = incoming.map((p, i) => {
    const old = prevById.get(p.studentId);
    if (old && sameParticipant(old, p)) {
      if (prev[i] !== old) changed = true; // 顺序变化也算变化
      return old;
    }
    changed = true;
    return p;
  });
  return changed ? next : prev;
}

export interface RosterStats {
  online: number;
  total: number;
  /** 全班实时正确率(无作答时 null) */
  correctRate: number | null;
  stuckCount: number;
  stuckNames: string[];
  handUpCount: number;
  aiAskTotal: number;
  /** 多数人所在环节 seq(空名单 null) */
  majoritySegment: number | null;
}

/** 顶部四卡统计派生 */
export function deriveStats(list: ParticipantMonitor[]): RosterStats {
  const answered = list.reduce((s, p) => s + p.answeredCount, 0);
  const correct = list.reduce((s, p) => s + p.correctCount, 0);
  const segCount = new Map<number, number>();
  for (const p of list) segCount.set(p.segment, (segCount.get(p.segment) ?? 0) + 1);
  let majoritySegment: number | null = null;
  let max = 0;
  for (const [seg, n] of segCount) if (n > max) { max = n; majoritySegment = seg; }
  const stuck = list.filter((p) => p.state === 'stuck');
  return {
    online: list.filter((p) => p.online).length,
    total: list.length,
    correctRate: answered > 0 ? Math.round((correct / answered) * 100) : null,
    stuckCount: stuck.length,
    stuckNames: stuck.map((p) => p.studentName),
    handUpCount: list.filter((p) => p.state === 'hand_up').length,
    aiAskTotal: list.reduce((s, p) => s + p.aiAskCount, 0),
    majoritySegment,
  };
}

export interface AlertEntry {
  key: string;
  /** 收到时刻(epoch ms) */
  at: number;
  alert: AlertEvent;
}

/** 告警入栈:新→旧排列,超出 max 截断(默认 30) */
export function pushAlerts(prev: AlertEntry[], events: AlertEvent[], at: number, max = 30): AlertEntry[] {
  if (events.length === 0) return prev;
  const fresh = events.map((alert, i) => ({ key: `${at}-${alert.studentId}-${alert.type}-${i}`, at, alert }));
  return [...fresh.reverse(), ...prev].slice(0, max);
}
