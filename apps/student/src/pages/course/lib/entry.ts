/**
 * 学生进课堂判定(C2 #9):去掉「未到时间不可进」的前端拦截 ——
 * 只要讲次已发布(ready / in_progress)即可进;未发布(draft)与已结课(finished)不可进。
 * 纯函数便于单测。
 */
import type { LessonDto } from '@qiming/contracts';

/** 已发布且仍在进行 → 可进课堂 */
export function canEnterClassroom(lesson: Pick<LessonDto, 'status'>): boolean {
  return lesson.status === 'ready' || lesson.status === 'in_progress';
}

/** 进课堂按钮文案 */
export function enterClassLabel(lesson: Pick<LessonDto, 'status'>): string {
  return lesson.status === 'in_progress' ? '课堂进行中 · 进入' : '进入课堂';
}
