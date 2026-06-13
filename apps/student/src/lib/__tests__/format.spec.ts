/** 正确率 0–1 比值 → 整数百分比(C3 #2:修 ×100 显示 bug) */
import { describe, expect, it } from 'vitest';
import { formatCorrectRate } from '../format';

describe('formatCorrectRate', () => {
  it('0.75 → 75%(不再显示 0.75%)', () => {
    expect(formatCorrectRate(0.75)).toBe('75%');
  });
  it('0.78 → 78%(mock 周数据口径)', () => {
    expect(formatCorrectRate(0.78)).toBe('78%');
  });
  it('1 → 100%,0 → 0%', () => {
    expect(formatCorrectRate(1)).toBe('100%');
    expect(formatCorrectRate(0)).toBe('0%');
  });
  it('四舍五入到整数', () => {
    expect(formatCorrectRate(0.666)).toBe('67%');
  });
  it('null/undefined → 占位 —', () => {
    expect(formatCorrectRate(null)).toBe('—');
    expect(formatCorrectRate(undefined)).toBe('—');
  });
});
