import { describe, expect, it } from 'vitest';
import type { ResourceDto } from '@qiming/contracts';
import { TYPE_META, formatResourceMeta, formatSize, formatUsedBy } from '../resource';

const base: ResourceDto = {
  id: 1, type: 'pdf', name: '讲义.pdf', ossKey: 'demo/x.pdf', size: 0,
  meta: {}, usedByLessons: [], kpNodeId: null, kpNodeName: null, createdAt: '2026-06-01T00:00:00.000Z',
};

describe('formatSize', () => {
  it('人类可读分档', () => {
    expect(formatSize(0)).toBe('—');
    expect(formatSize(512)).toBe('512 B');
    expect(formatSize(2048)).toBe('2 KB');
    expect(formatSize(2 * 1024 * 1024)).toBe('2.0 MB');
    expect(formatSize(100 * 1024 * 1024)).toBe('100 MB');
    expect(formatSize(3 * 1024 * 1024 * 1024)).toBe('3.0 GB');
  });
});

describe('TYPE_META', () => {
  it('五种资源类型都有标签/图标/色', () => {
    for (const t of ['ppt', 'pdf', 'video', 'interactive', 'image'] as const) {
      expect(TYPE_META[t].label).toBeTruthy();
      expect(TYPE_META[t].icon).toBeTruthy();
    }
  });
});

describe('formatResourceMeta', () => {
  it('页数 + 打点 + 大小', () => {
    const r: ResourceDto = { ...base, type: 'interactive', size: 2457600, meta: { pages: 24, checkpoints: [3, 8, 12] } };
    expect(formatResourceMeta(r)).toBe('24 页 · 3 个随堂小测 · 2.3 MB');
  });
  it('视频时长', () => {
    const r: ResourceDto = { ...base, type: 'video', size: 104857600, meta: { durationSec: 756 } };
    expect(formatResourceMeta(r)).toBe('12 分 36 秒 · 100 MB');
  });
});

describe('formatUsedBy', () => {
  it('未引用 = 可删', () => {
    expect(formatUsedBy(base)).toEqual({ text: '未引用', referenced: false });
  });
  it('反查引用讲次标题', () => {
    const r: ResourceDto = { ...base, usedByLessons: [{ lessonId: 4, lessonTitle: '第4讲 · 平移' }] };
    expect(formatUsedBy(r)).toEqual({ text: '引用于:第4讲 · 平移', referenced: true });
  });
});
