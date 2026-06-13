/**
 * 课程入口落点(C2 #8):工作台「讲次列表」与「编排课堂」应去往不同位置 —— 纯函数便于单测。
 *  - 讲次列表 = 看某课所有讲次时间线
 *  - 编排课堂 = 直接进入该课「下一讲」的编排页(经讲次时间线中转解析 lessonId)
 */
import type { LessonDto } from '@qiming/contracts';

/** 讲次时间线 */
export function courseListTo(courseId: number): string {
  return `/courses?courseId=${courseId}`;
}

/** 编排落点:带 go=arrange,讲次页据此自动跳到下一讲编排 */
export function courseArrangeTo(courseId: number): string {
  return `/courses?courseId=${courseId}&go=arrange`;
}

/** 下一讲(可编排)= 按 seq 第一个未结课讲次;无则 null */
export function nextArrangeLessonId(lessons: LessonDto[]): number | null {
  return lessons.find((l) => l.status === 'draft' || l.status === 'ready')?.id ?? null;
}
