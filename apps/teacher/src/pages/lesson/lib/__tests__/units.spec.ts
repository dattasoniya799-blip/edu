/**
 * 知识点单元 ↔ lesson_segments 往返(C2 #5)
 */
import { describe, expect, it } from 'vitest';
import type { LessonSegmentDto } from '@qiming/contracts';
import {
  mergeSegments, newUnit, openingFromLesson, openingToConfig, outsideSegments,
  segmentsToUnits, unitWarnings, unitsDuration, unitsToSegments, type KpUnit,
} from '../units';

const seg = (p: Partial<LessonSegmentDto> & Pick<LessonSegmentDto, 'type'>): LessonSegmentDto => ({
  seq: 0, durationMin: 30, config: {}, resourceId: null, paperId: null,
  kpNodeId: null, kpNodeName: null, unitSeq: null, ...p,
});

describe('segmentsToUnits', () => {
  it('按 unitSeq 分组还原单元;同 unitSeq 三段合一,kpNode 取组内', () => {
    const segs: LessonSegmentDto[] = [
      seg({ id: 1, type: 'lecture', resourceId: 7, kpNodeId: 102, kpNodeName: '图象', unitSeq: 1 }),
      seg({ id: 2, type: 'practice', paperId: 9, kpNodeId: 102, kpNodeName: '图象', unitSeq: 1 }),
      seg({ id: 3, type: 'summary', kpNodeId: 102, kpNodeName: '图象', unitSeq: 1 }),
      seg({ id: 4, type: 'lecture', resourceId: 8, kpNodeId: 104, kpNodeName: '平移', unitSeq: 2 }),
    ];
    const units = segmentsToUnits(segs);
    expect(units).toHaveLength(2);
    expect(units[0].kpNodeId).toBe(102);
    expect(units[0].lecture.resourceId).toBe(7);
    expect(units[0].practice.paperId).toBe(9);
    expect(units[1].kpNodeId).toBe(104);
    expect(units[1].lecture.resourceId).toBe(8);
  });

  it('旧无 unitSeq 段各自独立成单元(不丢数据)', () => {
    const units = segmentsToUnits([seg({ type: 'lecture' }), seg({ type: 'practice' })]);
    expect(units).toHaveLength(2);
  });

  it('warmup/homework/break 不进入单元模型', () => {
    const units = segmentsToUnits([seg({ type: 'warmup' }), seg({ type: 'homework' }), seg({ type: 'lecture', unitSeq: 1 })]);
    expect(units).toHaveLength(1);
  });
});

describe('unitsToSegments', () => {
  it('每单元产出 lecture/practice/summary 三段,带同一 unitSeq + kpNodeId,seq 连续', () => {
    const u: KpUnit = { ...newUnit(1), kpNodeId: 102, kpNodeName: '图象' };
    u.lecture.resourceId = 7; u.practice.paperId = 9;
    const segs = unitsToSegments([u, { ...newUnit(2), kpNodeId: 104, kpNodeName: '平移' }]);
    expect(segs.map((s) => s.type)).toEqual(['lecture', 'practice', 'summary', 'lecture', 'practice', 'summary']);
    expect(segs.map((s) => s.seq)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(segs.slice(0, 3).every((s) => s.unitSeq === 1 && s.kpNodeId === 102)).toBe(true);
    expect(segs.slice(3).every((s) => s.unitSeq === 2 && s.kpNodeId === 104)).toBe(true);
    // 槽位归属:resource 只在 lecture,paper 只在 practice
    expect(segs[0].resourceId).toBe(7);
    expect(segs[1].paperId).toBe(9);
    expect(segs[0].paperId).toBeNull();
    expect(segs[1].resourceId).toBeNull();
  });

  it('往返:units → segments → units 保持结构', () => {
    const u1: KpUnit = { ...newUnit(1), kpNodeId: 102, kpNodeName: '图象' };
    u1.lecture.resourceId = 7; u1.practice.paperId = 9; u1.lecture.durationMin = 35;
    const u2: KpUnit = { ...newUnit(2), kpNodeId: 104, kpNodeName: '平移' };
    const back = segmentsToUnits(unitsToSegments([u1, u2]));
    expect(back).toHaveLength(2);
    expect(back[0].kpNodeId).toBe(102);
    expect(back[0].lecture.resourceId).toBe(7);
    expect(back[0].lecture.durationMin).toBe(35);
    expect(back[0].practice.paperId).toBe(9);
    expect(back[1].kpNodeId).toBe(104);
    expect(unitsDuration([u1, u2])).toBe(35 + 30 + 20 + 30 + 30 + 20);
  });
});

describe('unitWarnings / opening', () => {
  it('缺知识点/课件/练习卷 → 软提示', () => {
    expect(unitWarnings(newUnit(1))).toEqual(['未选择知识点', '讲解未挂课件', '随堂练未挂题目/卷']);
    const full: KpUnit = { ...newUnit(1), kpNodeId: 1, kpNodeName: 'x' };
    full.lecture.resourceId = 1; full.practice.paperId = 1;
    expect(unitWarnings(full)).toEqual([]);
  });

  it('openingConfig 读写往返', () => {
    expect(openingFromLesson({ openingConfig: null })).toEqual({ enabled: false, text: '', resourceId: null });
    const o = openingFromLesson({ openingConfig: { enabled: true, text: '开场', resourceId: 5 } });
    expect(o).toEqual({ enabled: true, text: '开场', resourceId: 5 });
    expect(openingToConfig(o)).toEqual({ enabled: true, text: '开场', resourceId: 5 });
    expect(openingToConfig({ enabled: false, text: 'x', resourceId: 1 })).toBeNull();
  });
});

describe('单元外段保留(C3 #P0-2 关键 bug:保存不丢 warmup/homework/break)', () => {
  it('outsideSegments 仅取非单元三段(warmup/homework/break_time)', () => {
    const segs = [
      seg({ type: 'warmup' }), seg({ type: 'lecture', unitSeq: 1 }), seg({ type: 'practice', unitSeq: 1 }),
      seg({ type: 'summary', unitSeq: 1 }), seg({ type: 'homework', paperId: 9 }), seg({ type: 'break_time' }),
    ];
    expect(outsideSegments(segs).map((s) => s.type)).toEqual(['warmup', 'homework', 'break_time']);
  });

  it('mergeSegments:单元段在前、单元外段在后,seq 连续重排', () => {
    const u: KpUnit = { ...newUnit(1), kpNodeId: 102, kpNodeName: '图象' };
    const unitSegs = unitsToSegments([u]);
    const outside = [seg({ type: 'homework', paperId: 9 }), seg({ type: 'warmup' })];
    const merged = mergeSegments(unitSegs, outside);
    expect(merged.map((s) => s.type)).toEqual(['lecture', 'practice', 'summary', 'homework', 'warmup']);
    expect(merged.map((s) => s.seq)).toEqual([1, 2, 3, 4, 5]);
    expect(merged.find((s) => s.type === 'homework')!.paperId).toBe(9);
  });

  it('回归:读 → 取单元外段 → 合并写回,homework 卷不丢', () => {
    const loaded = [
      seg({ type: 'lecture', resourceId: 7, unitSeq: 1, kpNodeId: 102, kpNodeName: '图象' }),
      seg({ type: 'practice', paperId: 8, unitSeq: 1, kpNodeId: 102, kpNodeName: '图象' }),
      seg({ type: 'summary', unitSeq: 1, kpNodeId: 102, kpNodeName: '图象' }),
      seg({ type: 'homework', paperId: 9 }),
    ];
    const units = segmentsToUnits(loaded);
    const outside = outsideSegments(loaded);
    const writeBack = mergeSegments(unitsToSegments(units), outside);
    // 旧实现只写 unitsToSegments(units) → 丢 homework;合并后必须保留
    expect(writeBack.some((s) => s.type === 'homework' && s.paperId === 9)).toBe(true);
  });
});
