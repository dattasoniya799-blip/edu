/**
 * 资源库纯展示口径(FIX2 问题3:补齐分工缝隙页面)
 * 仅做 ResourceDto → 展示文案/图标的映射,无副作用,便于单测。
 */
import type { ResourceDto, ResourceType } from '@qiming/contracts';
import type { TagTone } from '@qiming/ui';

export interface TypeMeta { label: string; icon: string; tone: TagTone }

/** 资源类型 → 标签文案 / 封面图标 / 语义色(色值仍由 Tag/令牌产出,这里只给 tone) */
export const TYPE_META: Record<ResourceType, TypeMeta> = {
  ppt: { label: 'PPT', icon: 'ƒ(x)', tone: 'primary' },
  pdf: { label: 'PDF', icon: '≡', tone: 'red' },
  video: { label: '视频', icon: '▷', tone: 'orange' },
  interactive: { label: '互动', icon: '▶', tone: 'violet' },
  image: { label: '图片', icon: '◑', tone: 'green' },
};

/** 上传过滤(原型口径:课件/讲义/视频/图片) */
export const ACCEPT_RESOURCE = '.ppt,.pptx,.pdf,.mp4,.png,.jpg,.jpeg,application/pdf,video/mp4,image/png,image/jpeg';

/** 文件大小 → 人类可读(tabular-nums 友好) */
export function formatSize(bytes: number): string {
  if (!bytes || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(0)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(mb < 10 ? 1 : 0)} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
}

/** meta(页数/时长/打点数)→ 简短描述 */
export function formatResourceMeta(r: ResourceDto): string {
  const m = r.meta as { pages?: number; durationSec?: number; checkpoints?: unknown[] };
  const parts: string[] = [];
  if (typeof m.pages === 'number') parts.push(`${m.pages} 页`);
  if (typeof m.durationSec === 'number') {
    const min = Math.floor(m.durationSec / 60);
    const sec = m.durationSec % 60;
    parts.push(`${min} 分 ${String(sec).padStart(2, '0')} 秒`);
  }
  if (Array.isArray(m.checkpoints) && m.checkpoints.length > 0) parts.push(`${m.checkpoints.length} 个随堂小测`);
  parts.push(formatSize(r.size));
  return parts.join(' · ');
}

/** 被引用讲次反查 → 文案;空 = 未引用(可删) */
export function formatUsedBy(r: ResourceDto): { text: string; referenced: boolean } {
  if (r.usedByLessons.length === 0) return { text: '未引用', referenced: false };
  return { text: `引用于:${r.usedByLessons.map((l) => l.lessonTitle).join('、')}`, referenced: true };
}
