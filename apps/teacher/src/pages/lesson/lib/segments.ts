/**
 * 编排页纯逻辑:环节上下移 / 检查清单(口径=A4 lesson.service.computeChecklist)/ 缺失项文案
 * 全部为纯函数,vitest 覆盖(验收项「发布校验提示」)
 */
import type { LessonSegmentDto, SegmentType } from '@qiming/contracts';

/** prep_checklist 五键(A4 服务端口径,顺序即展示顺序) */
export const CHECKLIST_KEYS = ['warmup', 'lecture', 'practice', 'summary', 'homework'] as const;
export type ChecklistKey = (typeof CHECKLIST_KEYS)[number];

export const SEGMENT_LABEL: Record<SegmentType, string> = {
  warmup: '开场回顾',
  lecture: '课件讲解',
  practice: '随堂练',
  summary: '小结巩固',
  homework: '课后作业',
  break_time: '休息',
};

export const CHECKLIST_LABEL: Record<ChecklistKey, string> = {
  warmup: '开场回顾',
  lecture: '课件讲解',
  practice: '随堂练',
  summary: '小结巩固',
  homework: '课后作业',
};

/** 上下移按钮替代拖拽:返回新数组并重排 seq(越界/无效返回原数组引用) */
export function moveSegment(list: LessonSegmentDto[], index: number, dir: -1 | 1): LessonSegmentDto[] {
  const target = index + dir;
  if (index < 0 || index >= list.length || target < 0 || target >= list.length) return list;
  const next = [...list];
  [next[index], next[target]] = [next[target], next[index]];
  return reseq(next);
}

/** 删除环节并重排 seq */
export function removeSegment(list: LessonSegmentDto[], index: number): LessonSegmentDto[] {
  return reseq(list.filter((_, i) => i !== index));
}

/** seq 始终 = 数组顺序(A4:题序/环节序以数组顺序为准) */
export function reseq(list: LessonSegmentDto[]): LessonSegmentDto[] {
  return list.map((s, i) => (s.seq === i + 1 ? s : { ...s, seq: i + 1 }));
}

/** 总时长(分钟) */
export function totalDuration(list: LessonSegmentDto[]): number {
  return list.reduce((sum, s) => sum + (Number.isFinite(s.durationMin) ? s.durationMin : 0), 0);
}

/**
 * 检查清单(镜像 A4 lesson.service#computeChecklist):
 * warmup/lecture/summary = 环节存在;practice/homework = 环节存在且所挂 paper 全部 published
 */
export function computeChecklist(
  segments: Pick<LessonSegmentDto, 'type' | 'paperId'>[],
  paperStatusById: Map<number, string>,
): Record<ChecklistKey, boolean> {
  const has = (t: SegmentType) => segments.some((s) => s.type === t);
  const paperReady = (t: SegmentType) => {
    const list = segments.filter((s) => s.type === t);
    return list.length > 0 && list.every((s) => s.paperId != null && paperStatusById.get(s.paperId) === 'published');
  };
  return {
    warmup: has('warmup'),
    lecture: has('lecture'),
    practice: paperReady('practice'),
    summary: has('summary'),
    homework: paperReady('homework'),
  };
}

/** 4201 detail → 缺失项中文清单(A4:detail = prep_checklist 键数组;兼容 {missing:[…]} 包装) */
export function missingLabels(detail: unknown): string[] {
  const arr = Array.isArray(detail)
    ? detail
    : detail && typeof detail === 'object' && Array.isArray((detail as { missing?: unknown }).missing)
      ? ((detail as { missing: unknown[] }).missing)
      : [];
  return arr
    .filter((k): k is ChecklistKey => typeof k === 'string' && k in CHECKLIST_LABEL)
    .map((k) => CHECKLIST_LABEL[k]);
}

/** 业务错误(createClient 抛 ApiError:含 code/detail)的安全提取 */
export function bizError(e: unknown): { code: number; message: string; detail?: unknown } | null {
  if (e instanceof Error && typeof (e as { code?: unknown }).code === 'number') {
    return { code: (e as unknown as { code: number }).code, message: e.message, detail: (e as { detail?: unknown }).detail };
  }
  return null;
}

/** 新环节缺省值(添加环节用) */
export function newSegment(type: SegmentType, seq: number): LessonSegmentDto {
  const config: Record<string, unknown> =
    type === 'warmup' ? { source: 'auto_wrong', count: 3 }
      : type === 'practice' ? { ai_guide: true, stuck_alert_min: 3 }
        : {};
  const durationMin = { warmup: 10, lecture: 30, practice: 30, summary: 20, homework: 0, break_time: 10 }[type];
  return { seq, type, durationMin, config, resourceId: null, paperId: null };
}
