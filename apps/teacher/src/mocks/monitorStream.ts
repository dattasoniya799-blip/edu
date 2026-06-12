/**
 * 监控页 mock 数据流(monitor:roster / monitor:alert)
 * 事件形状逐字段 = packages/contracts/src/ws-protocol.ts 的 S2TEvents 载荷(类型直接取自契约)。
 * 帧按 tick 确定性生成(无随机数):同一 tick 永远同一帧,便于单测与走查。
 * 剧本(seed 口径 12 名学生,环节③ 随堂练 5 题):
 *   tick2 许诺卡住(tick8 恢复) · tick3 刘思琪举手 · tick4 周子航卡住 · tick5 李一诺离线
 */
import type { ParticipantMonitor, ParticipantState } from '@qiming/contracts';
import type { AlertEvent, RosterEvent } from '../pages/monitor/lib/roster';
import { STUDENT_NAMES } from './data';

/** 随堂练题数(seed:第 4 讲随堂练 5 题) */
export const MOCK_QUESTION_TOTAL = 5;
const SEGMENT_SEQ = 3;

const IDX = Object.fromEntries(STUDENT_NAMES.map((n, i) => [n, i])) as Record<string, number>;
const STUCK_A = IDX['许诺'];      // tick2 卡住,tick8 恢复
const STUCK_B = IDX['周子航'];    // tick4 卡住
const HAND_UP = IDX['刘思琪'];    // tick3 举手
const OFFLINE = IDX['李一诺'];    // tick5 离线

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function participantAt(i: number, tick: number): ParticipantMonitor {
  // 基线进度:各自节奏推进,3 个 tick 进 1 题
  let answeredCount = clamp(Math.floor((tick + (i % 4)) / 3), 0, MOCK_QUESTION_TOTAL);
  let state: ParticipantState = 'normal';
  let stuckSec = 0;
  let online = true;

  if (i === STUCK_A) {
    if (tick >= 2 && tick < 8) {
      state = 'stuck';
      answeredCount = 2;
      stuckSec = 180 + (tick - 2) * 5;
    } else if (tick >= 8) {
      answeredCount = clamp(2 + Math.floor((tick - 8) / 3), 0, MOCK_QUESTION_TOTAL);
    } else {
      answeredCount = clamp(tick, 0, 2);
    }
  }
  if (i === STUCK_B && tick >= 4) {
    state = 'stuck';
    answeredCount = 2;
    stuckSec = 180 + (tick - 4) * 5;
  }
  if (i === HAND_UP && tick >= 3) state = 'hand_up';
  if (i === OFFLINE && tick >= 5) {
    state = 'offline';
    online = false;
    answeredCount = clamp(Math.floor((5 + (i % 4)) / 3), 0, MOCK_QUESTION_TOTAL);
  }

  // 确定性错题:每 3 人中 1 人答到第 3 题起错 1 题;卡住的许诺错 1 题
  const wrong = (i % 3 === 2 && answeredCount >= 3) || (i === STUCK_A && answeredCount >= 2 && tick < 8) ? 1 : 0;
  const done = answeredCount >= MOCK_QUESTION_TOTAL;
  return {
    studentId: 4 + i,
    studentName: STUDENT_NAMES[i],
    segment: SEGMENT_SEQ,
    currentQuestion: done ? null : answeredCount + 1,
    answeredCount,
    correctCount: answeredCount - wrong,
    state,
    stuckSec,
    aiAskCount: clamp(Math.floor((tick + i) / 5), 0, 6) + (i === IDX['王浩然'] ? Math.min(3, Math.floor(tick / 3)) : 0),
    online,
  };
}

/** 第 tick 帧的 monitor:roster 载荷({ participants: ParticipantMonitor[] }) */
export function mockRosterFrame(tick: number): RosterEvent {
  return { participants: STUDENT_NAMES.map((_, i) => participantAt(i, tick)) };
}

/** 第 tick 帧伴随的 monitor:alert 事件(状态跃迁时各发一条) */
export function mockAlertsAt(tick: number): AlertEvent[] {
  const out: AlertEvent[] = [];
  if (tick === 2) out.push({ studentId: 4 + STUCK_A, studentName: STUDENT_NAMES[STUCK_A], type: 'stuck', detail: '第 3 题停留超过 3 分钟' });
  if (tick === 3) out.push({ studentId: 4 + HAND_UP, studentName: STUDENT_NAMES[HAND_UP], type: 'hand_up', detail: '请求老师当面讲解' });
  if (tick === 4) out.push({ studentId: 4 + STUCK_B, studentName: STUDENT_NAMES[STUCK_B], type: 'stuck', detail: '第 3 题停留超过 3 分钟' });
  return out;
}
