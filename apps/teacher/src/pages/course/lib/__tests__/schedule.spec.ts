/**
 * 讲次排期表单纯函数(设置/调整上课时间,MVP 手动逐讲排课口径)
 */
import { describe, expect, it } from 'vitest';
import type { LessonDto } from '@qiming/contracts';
import { schedulePayload, scheduleFormFrom, validateSchedule, type ScheduleForm } from '../schedule';

const lesson = (patch: Partial<LessonDto> = {}): LessonDto => ({
  id: 1, courseId: 1, seq: 1, title: '第1讲', scheduledStart: null, scheduledEnd: null,
  status: 'draft', prepChecklist: {}, openingConfig: null, sessionId: null,
  ...patch,
});

const form = (patch: Partial<ScheduleForm> = {}): ScheduleForm => ({
  title: '第1讲', date: '2026-07-11', start: '14:00', end: '16:00', ...patch,
});

describe('scheduleFormFrom(讲次 → 表单初值)', () => {
  it('未排期讲次给空初值(date/start/end 均空)', () => {
    expect(scheduleFormFrom(lesson())).toEqual({ title: '第1讲', date: '', start: '', end: '' });
  });

  it('已排期讲次按本地时区拆 date/start/end,可与 schedulePayload 往返', () => {
    const body = schedulePayload(form());
    const f = scheduleFormFrom(lesson({
      title: '一次函数图像', scheduledStart: body.scheduledStart, scheduledEnd: body.scheduledEnd,
    }));
    expect(f).toEqual({ title: '一次函数图像', date: '2026-07-11', start: '14:00', end: '16:00' });
  });
});

describe('validateSchedule(校验:空对象 = 通过)', () => {
  it('合法表单通过', () => {
    expect(validateSchedule(form())).toEqual({});
  });

  it('标题必填且 ≤128 字', () => {
    expect(validateSchedule(form({ title: '  ' }))).toHaveProperty('title');
    expect(validateSchedule(form({ title: 'x'.repeat(129) }))).toHaveProperty('title');
    expect(validateSchedule(form({ title: 'x'.repeat(128) }))).toEqual({});
  });

  it('日期与起止时间必填且格式合法', () => {
    expect(validateSchedule(form({ date: '' }))).toHaveProperty('date');
    expect(validateSchedule(form({ start: '25:00' }))).toHaveProperty('start');
    expect(validateSchedule(form({ end: '9:0' }))).toHaveProperty('end');
  });

  it('结束时间必须晚于开始时间(等于也不行)', () => {
    expect(validateSchedule(form({ start: '16:00', end: '14:00' }))).toHaveProperty('end');
    expect(validateSchedule(form({ start: '14:00', end: '14:00' }))).toHaveProperty('end');
  });

  it('起止格式错误时不做先后比较(不误报 end 先后错误文案)', () => {
    const e = validateSchedule(form({ start: 'zz:zz', end: '08:00' }));
    expect(e.start).toBeTruthy();
    expect(e.end).toBeUndefined();
  });
});

describe('schedulePayload(表单 → PUT body)', () => {
  it('生成同日起止 ISO,且 start < end', () => {
    const body = schedulePayload(form());
    expect(body.title).toBe('第1讲');
    expect(new Date(body.scheduledStart).getTime()).toBeLessThan(new Date(body.scheduledEnd).getTime());
    expect(new Date(body.scheduledEnd).getTime() - new Date(body.scheduledStart).getTime()).toBe(2 * 3600_000);
  });

  it('标题去除首尾空白', () => {
    expect(schedulePayload(form({ title: ' 复习课 ' })).title).toBe('复习课');
  });
});
