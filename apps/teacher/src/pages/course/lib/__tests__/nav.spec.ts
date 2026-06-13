/**
 * 工作台两入口落点区分(C2 #8)
 */
import { describe, expect, it } from 'vitest';
import type { LessonDto } from '@qiming/contracts';
import { courseArrangeTo, courseListTo, nextArrangeLessonId } from '../nav';

const lesson = (id: number, status: LessonDto['status']): LessonDto => ({
  id, courseId: 1, seq: id, title: `第${id}讲`, scheduledStart: null, scheduledEnd: null,
  status, prepChecklist: {}, openingConfig: null,
});

describe('课程入口落点', () => {
  it('「讲次列表」与「编排课堂」去往不同位置', () => {
    expect(courseListTo(7)).toBe('/courses?courseId=7');
    expect(courseArrangeTo(7)).toBe('/courses?courseId=7&go=arrange');
    expect(courseListTo(7)).not.toBe(courseArrangeTo(7));
  });

  it('编排落点解析「下一讲」= 首个未结课讲次', () => {
    expect(nextArrangeLessonId([lesson(1, 'finished'), lesson(2, 'ready'), lesson(3, 'draft')])).toBe(2);
    expect(nextArrangeLessonId([lesson(1, 'finished')])).toBeNull();
    expect(nextArrangeLessonId([])).toBeNull();
  });
});
