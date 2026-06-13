/**
 * 编排页纯逻辑:环节上下移 / 发布门槛检查(放宽口径)/ 缺失项文案
 * 全部为纯函数,vitest 覆盖(验收项「发布校验提示」)
 *
 * 放宽发布(IMPL2 #3):自由增删环节,不再强制四类齐全。
 * 发布唯一硬门槛 = 已存在的 practice / homework 环节必须挂「已发布」试卷;
 * 其余环节(warmup/lecture/summary)缺失不再拦截。
 */
import type { LessonSegmentDto, SegmentType } from '@qiming/contracts';

/** 发布门槛键(仅这两类挂卷会拦截发布;顺序即展示顺序) */
export const CHECKLIST_KEYS = ['practice', 'homework'] as const;
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
  practice: '随堂练',
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
 * 发布门槛(放宽口径):仅校验已存在的 practice / homework 环节挂卷是否就绪。
 * 该类型环节不存在 → 该键为 true(不拦截);存在 → 其所有挂卷必须 published。
 * warmup/lecture/summary 不再纳入门槛(自由编排)。
 */
export function computeChecklist(
  segments: Pick<LessonSegmentDto, 'type' | 'paperId'>[],
  paperStatusById: Map<number, string>,
): Record<ChecklistKey, boolean> {
  const paperReady = (t: SegmentType) => {
    const list = segments.filter((s) => s.type === t);
    return list.every((s) => s.paperId != null && paperStatusById.get(s.paperId) === 'published');
  };
  return {
    practice: paperReady('practice'),
    homework: paperReady('homework'),
  };
}

/** 发布门槛中「存在但未就绪」的环节键(供编排页提示用) */
export function pendingPaperKeys(
  segments: Pick<LessonSegmentDto, 'type' | 'paperId'>[],
  paperStatusById: Map<number, string>,
): ChecklistKey[] {
  const checklist = computeChecklist(segments, paperStatusById);
  return CHECKLIST_KEYS.filter((k) => segments.some((s) => s.type === k) && !checklist[k]);
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
  return { seq, type, durationMin, config, resourceId: null, paperId: null, kpNodeId: null, kpNodeName: null, unitSeq: null };
}
