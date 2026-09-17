/** 首页课程库/示例题网格用的纯函数(相对时间、阶段文案、学科标签、筛选)—— 不碰 DOM,方便单测。 */
import type { LessonListItem } from './api';
import type { LessonStage, Subject } from '../types';

export const SUBJECT_LABEL: Record<Subject, string> = {
  math: '数学',
  physics: '物理',
  chemistry: '化学',
};

export function subjectLabel(subject?: Subject): string {
  return subject ? SUBJECT_LABEL[subject] : '未分类';
}

const STAGE_LABEL: Record<LessonStage, string> = {
  uploaded: '已上传',
  recognizing: '识题中',
  planning: '规划中',
  scripting: '出剧本中',
  assets: '生成素材中',
  ready: '就绪',
  failed: '生成失败',
};

export function stageLabel(stage: LessonStage): string {
  return STAGE_LABEL[stage];
}

const STAGE_ORDER: LessonStage[] = ['uploaded', 'recognizing', 'planning', 'scripting', 'assets', 'ready'];

/** 生成中卡片的进度条百分比(粗粒度:按阶段序号,不追阶段内部耗时)。 */
export function stageProgress(stage: LessonStage): number {
  if (stage === 'failed') return 100;
  const i = STAGE_ORDER.indexOf(stage);
  return i < 0 ? 0 : Math.round((i / (STAGE_ORDER.length - 1)) * 100);
}

/** 卡片状态分组,决定小圆点颜色:ready 绿 / failed 红 / 其余(生成中)蓝。 */
export function stageKind(stage: LessonStage): 'ready' | 'failed' | 'pending' {
  if (stage === 'ready') return 'ready';
  if (stage === 'failed') return 'failed';
  return 'pending';
}

/** 课程是否还没定型(轮询要一直盯着这些,直到变成 ready/failed)。 */
export function isPending(item: Pick<LessonListItem, 'stage'>): boolean {
  return item.stage !== 'ready' && item.stage !== 'failed';
}

const UNITS: Array<[number, string]> = [
  [60_000, '刚刚'],
  [3_600_000, '分钟前'],
  [86_400_000, '小时前'],
  [30 * 86_400_000, '天前'],
];

/** ISO 时间 → 「3 小时前」这类相对时间;超过 30 天直接给日期。 */
export function formatRelativeTime(iso: string, now: number = Date.now()): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '';
  const diff = now - then;
  if (diff < UNITS[0][0]) return '刚刚';
  if (diff < UNITS[1][0]) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < UNITS[2][0]) return `${Math.floor(diff / 3_600_000)} 小时前`;
  if (diff < UNITS[3][0]) return `${Math.floor(diff / 86_400_000)} 天前`;
  const d = new Date(then);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export type SubjectFilter = Subject | 'all';

/** 首页课程库的筛选:学科 tab + 关键词(标题/摘要/id 任一命中,大小写不敏感)。 */
export function filterLessons(items: LessonListItem[], subject: SubjectFilter, query: string): LessonListItem[] {
  const q = query.trim().toLowerCase();
  return items.filter((item) => {
    if (subject !== 'all' && item.subject !== subject) return false;
    if (!q) return true;
    const haystack = `${item.title ?? ''} ${item.summary ?? ''} ${item.id}`.toLowerCase();
    return haystack.includes(q);
  });
}
