import { describe, expect, it } from 'vitest';
import type { ParticipantMonitor } from '@qiming/contracts';
import { mockAlertsAt, mockRosterFrame, MOCK_QUESTION_TOTAL } from '../../../../mocks/monitorStream';
import { deriveStats, mergeRoster, pushAlerts, sameParticipant } from '../roster';

const p = (id: number, patch: Partial<ParticipantMonitor> = {}): ParticipantMonitor => ({
  studentId: id, studentName: `学生${id}`, segment: 3, currentQuestion: 2,
  answeredCount: 1, correctCount: 1, state: 'normal', stuckSec: 0, aiAskCount: 0, online: true,
  ...patch,
});

describe('mergeRoster(roster 流 reducer:增量合并不闪烁)', () => {
  it('全员无变化 → 返回 prev 本身(整页零重渲)', () => {
    const prev = [p(1), p(2)];
    expect(mergeRoster(prev, [p(1), p(2)])).toBe(prev);
  });
  it('单人变化 → 仅该人换新引用,其余沿用旧引用', () => {
    const prev = [p(1), p(2), p(3)];
    const next = mergeRoster(prev, [p(1), p(2, { answeredCount: 2 }), p(3)]);
    expect(next).not.toBe(prev);
    expect(next[0]).toBe(prev[0]);
    expect(next[1]).not.toBe(prev[1]);
    expect(next[1].answeredCount).toBe(2);
    expect(next[2]).toBe(prev[2]);
  });
  it('新增/减少人数与顺序变化都产生新数组', () => {
    const prev = [p(1), p(2)];
    expect(mergeRoster(prev, [p(1)])).toHaveLength(1);
    const reordered = mergeRoster(prev, [p(2), p(1)]);
    expect(reordered.map((x) => x.studentId)).toEqual([2, 1]);
    expect(reordered[0]).toBe(prev[1]); // 引用仍复用
  });
  it('sameParticipant 覆盖全部字段', () => {
    expect(sameParticipant(p(1), p(1))).toBe(true);
    for (const patch of [
      { segment: 4 }, { currentQuestion: null }, { answeredCount: 9 }, { correctCount: 0 },
      { state: 'stuck' as const }, { stuckSec: 200 }, { aiAskCount: 3 }, { online: false },
    ]) {
      expect(sameParticipant(p(1), p(1, patch))).toBe(false);
    }
  });
});

describe('deriveStats(顶部统计)', () => {
  it('正确率/卡住/举手/AI 次数/在堂人数', () => {
    const list = [
      p(1, { answeredCount: 4, correctCount: 4, aiAskCount: 1 }),
      p(2, { answeredCount: 2, correctCount: 1, state: 'stuck', stuckSec: 240, studentName: '许诺' }),
      p(3, { answeredCount: 2, correctCount: 1, state: 'hand_up' }),
      p(4, { answeredCount: 0, correctCount: 0, state: 'offline', online: false, aiAskCount: 2 }),
    ];
    const s = deriveStats(list);
    expect(s.total).toBe(4);
    expect(s.online).toBe(3);
    expect(s.correctRate).toBe(75); // 6/8
    expect(s.stuckCount).toBe(1);
    expect(s.stuckNames).toEqual(['许诺']);
    expect(s.handUpCount).toBe(1);
    expect(s.aiAskTotal).toBe(3);
    expect(s.majoritySegment).toBe(3);
  });
  it('空名单/零作答的兜底', () => {
    const s = deriveStats([]);
    expect(s.correctRate).toBeNull();
    expect(s.majoritySegment).toBeNull();
  });
});

describe('pushAlerts(告警侧栏)', () => {
  it('新告警在最前;超出 max 截断;key 唯一', () => {
    let list = pushAlerts([], [{ studentId: 8, studentName: '许诺', type: 'stuck', detail: 'x' }], 1000);
    list = pushAlerts(list, [{ studentId: 10, studentName: '刘思琪', type: 'hand_up', detail: 'y' }], 2000);
    expect(list[0].alert.studentName).toBe('刘思琪');
    expect(list[1].alert.studentName).toBe('许诺');
    expect(new Set(list.map((a) => a.key)).size).toBe(2);
    const capped = pushAlerts(list, [{ studentId: 5, studentName: '周子航', type: 'stuck', detail: 'z' }], 3000, 2);
    expect(capped).toHaveLength(2);
    expect(capped[0].alert.studentName).toBe('周子航');
  });
  it('无事件时返回原引用', () => {
    const prev = pushAlerts([], [{ studentId: 8, studentName: '许诺', type: 'stuck', detail: 'x' }], 1000);
    expect(pushAlerts(prev, [], 2000)).toBe(prev);
  });
});

describe('mock monitor:roster 流(形状=ws-protocol.ts,逐字段)', () => {
  const EXPECTED_KEYS = [
    'studentId', 'studentName', 'segment', 'currentQuestion', 'answeredCount',
    'correctCount', 'state', 'stuckSec', 'aiAskCount', 'online',
  ].sort();

  it('每帧 12 人,字段与 ParticipantMonitor 完全一致(不多不少)', () => {
    for (const tick of [0, 2, 5, 10]) {
      const frame = mockRosterFrame(tick);
      expect(Object.keys(frame)).toEqual(['participants']);
      expect(frame.participants).toHaveLength(12);
      for (const part of frame.participants) {
        expect(Object.keys(part).sort()).toEqual(EXPECTED_KEYS);
        expect(part.correctCount).toBeLessThanOrEqual(part.answeredCount);
        expect(part.answeredCount).toBeLessThanOrEqual(MOCK_QUESTION_TOTAL);
        if (part.currentQuestion != null) expect(part.currentQuestion).toBe(part.answeredCount + 1);
      }
    }
  });
  it('确定性:同 tick 帧内容一致;剧本状态按 tick 跃迁并产生 alert', () => {
    expect(mockRosterFrame(4)).toEqual(mockRosterFrame(4));
    const at0 = mockRosterFrame(0).participants;
    expect(at0.every((x) => x.state === 'normal')).toBe(true);
    const at4 = mockRosterFrame(4).participants;
    expect(at4.filter((x) => x.state === 'stuck')).toHaveLength(2);
    expect(at4.find((x) => x.studentName === '许诺')?.stuckSec).toBeGreaterThanOrEqual(180);
    const alert2 = mockAlertsAt(2);
    expect(alert2).toHaveLength(1);
    expect(Object.keys(alert2[0]).sort()).toEqual(['detail', 'studentId', 'studentName', 'type'].sort());
    expect(alert2[0].type).toBe('stuck');
    expect(mockAlertsAt(0)).toEqual([]);
    expect(mockAlertsAt(3)[0]?.type).toBe('hand_up');
  });
});
