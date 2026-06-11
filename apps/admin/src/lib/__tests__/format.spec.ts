import { describe, expect, it } from 'vitest';
import { formatDateCn, formatDay, formatDayShort, formatDurationHM, formatMoney, formatWan, greeting } from '../format';

describe('formatDurationHM', () => {
  it('0/负数 → —', () => {
    expect(formatDurationHM(0)).toBe('—');
    expect(formatDurationHM(-5)).toBe('—');
  });
  it('不足 1 小时只显示分钟', () => {
    expect(formatDurationHM(1800)).toBe('30 min');
  });
  it('小时 + 补零分钟(原型口径 6 h 42 min)', () => {
    expect(formatDurationHM(6 * 3600 + 42 * 60)).toBe('6 h 42 min');
    expect(formatDurationHM(8 * 3600 + 3 * 60)).toBe('8 h 03 min');
  });
});

describe('formatWan / formatMoney', () => {
  it('token → 万,最多 1 位小数', () => {
    expect(formatWan(1842000)).toBe('184.2');
    expect(formatWan(80000)).toBe('8');
  });
  it('金额带千分位', () => {
    expect(formatMoney(1842)).toBe('¥1,842');
  });
});

describe('日期格式', () => {
  it('formatDateCn → 「6 月 13 日(周六)」', () => {
    // 无时区后缀 → 按本地时间解析,避免用例受 TZ 影响
    expect(formatDateCn('2026-06-13T12:00:00')).toBe('6 月 13 日(周六)');
  });
  it('非法输入 → —', () => {
    expect(formatDateCn('not-a-date')).toBe('—');
    expect(formatDay('not-a-date')).toBe('—');
  });
  it('formatDayShort 去前导零', () => {
    expect(formatDayShort('2026-06-05')).toBe('6.5');
    expect(formatDayShort('2026-11-30')).toBe('11.30');
  });
});

describe('greeting', () => {
  it('按小时分段', () => {
    expect(greeting(8)).toBe('早上好');
    expect(greeting(14)).toBe('下午好');
    expect(greeting(20)).toBe('晚上好');
    expect(greeting(3)).toBe('夜深了');
  });
});
