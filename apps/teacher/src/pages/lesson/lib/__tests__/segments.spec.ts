import { describe, expect, it } from 'vitest';
import type { LessonSegmentDto } from '@qiming/contracts';
import {
  CHECKLIST_KEYS, bizError, computeChecklist, missingLabels,
  moveSegment, newSegment, removeSegment, reseq, totalDuration,
} from '../segments';

const seg = (type: LessonSegmentDto['type'], seq: number, paperId: number | null = null): LessonSegmentDto =>
  ({ seq, type, durationMin: 10, config: {}, resourceId: null, paperId });

const FULL: LessonSegmentDto[] = [
  seg('warmup', 1), seg('lecture', 2), seg('practice', 3, 1), seg('summary', 4), seg('homework', 5, 2),
];
const PUBLISHED = new Map([[1, 'published'], [2, 'published']]);

describe('moveSegment(上下移按钮)', () => {
  it('下移交换相邻环节并重排 seq', () => {
    const next = moveSegment(FULL, 0, 1);
    expect(next.map((s) => s.type)).toEqual(['lecture', 'warmup', 'practice', 'summary', 'homework']);
    expect(next.map((s) => s.seq)).toEqual([1, 2, 3, 4, 5]);
  });
  it('上移第 2 个等价于下移第 1 个', () => {
    expect(moveSegment(FULL, 1, -1).map((s) => s.type)).toEqual(moveSegment(FULL, 0, 1).map((s) => s.type));
  });
  it('越界不动并返回原引用(首个上移/末个下移)', () => {
    expect(moveSegment(FULL, 0, -1)).toBe(FULL);
    expect(moveSegment(FULL, FULL.length - 1, 1)).toBe(FULL);
  });
  it('removeSegment 删除并重排 seq', () => {
    const next = removeSegment(FULL, 1);
    expect(next.map((s) => s.type)).toEqual(['warmup', 'practice', 'summary', 'homework']);
    expect(next.map((s) => s.seq)).toEqual([1, 2, 3, 4]);
  });
});

describe('computeChecklist(口径=A4 服务端)', () => {
  it('五类齐备且 practice/homework 挂 published 卷 → 全绿', () => {
    expect(computeChecklist(FULL, PUBLISHED)).toEqual({
      warmup: true, lecture: true, practice: true, summary: true, homework: true,
    });
  });
  it('缺 homework 环节 → homework=false', () => {
    const noHw = FULL.filter((s) => s.type !== 'homework');
    expect(computeChecklist(noHw, PUBLISHED).homework).toBe(false);
  });
  it('homework 环节存在但未挂卷 → false;挂 draft 卷 → false', () => {
    const noPaper = FULL.map((s) => (s.type === 'homework' ? { ...s, paperId: null } : s));
    expect(computeChecklist(noPaper, PUBLISHED).homework).toBe(false);
    const draftPaper = new Map([[1, 'published'], [2, 'draft']]);
    expect(computeChecklist(FULL, draftPaper).homework).toBe(false);
  });
  it('warmup/lecture/summary 只要求环节存在', () => {
    const c = computeChecklist([seg('warmup', 1)], new Map());
    expect(c.warmup).toBe(true);
    expect(c.lecture).toBe(false);
    expect(c.summary).toBe(false);
  });
});

describe('missingLabels(4201 发布校验提示)', () => {
  it('detail=键数组(A4 真实形状)→ 中文清单', () => {
    expect(missingLabels(['homework'])).toEqual(['课后作业']);
    expect(missingLabels(['practice', 'homework'])).toEqual(['随堂练', '课后作业']);
  });
  it('兼容 {missing:[…]} 包装;未知键被忽略', () => {
    expect(missingLabels({ missing: ['homework', 'bogus'] })).toEqual(['课后作业']);
  });
  it('非法 detail → 空数组', () => {
    expect(missingLabels(undefined)).toEqual([]);
    expect(missingLabels('homework')).toEqual([]);
  });
  it('CHECKLIST_KEYS 全键可映射', () => {
    expect(missingLabels([...CHECKLIST_KEYS])).toHaveLength(CHECKLIST_KEYS.length);
  });
});

describe('bizError / totalDuration / reseq / newSegment', () => {
  it('bizError 提取 ApiError 形状的 code/detail', () => {
    const e = Object.assign(new Error('备课检查未通过'), { code: 4201, detail: ['homework'] });
    expect(bizError(e)).toEqual({ code: 4201, message: '备课检查未通过', detail: ['homework'] });
    expect(bizError(new Error('普通错误'))).toBeNull();
    expect(bizError('not-an-error')).toBeNull();
  });
  it('totalDuration 求和(非法值按 0)', () => {
    expect(totalDuration(FULL)).toBe(50);
    expect(totalDuration([{ ...FULL[0], durationMin: Number.NaN }])).toBe(0);
  });
  it('reseq 已有序时保持元素引用', () => {
    expect(reseq(FULL)[0]).toBe(FULL[0]);
  });
  it('newSegment 给 practice 带 AI 缺省配置', () => {
    const s = newSegment('practice', 3);
    expect(s.config).toEqual({ ai_guide: true, stuck_alert_min: 3 });
    expect(s.seq).toBe(3);
  });
});
