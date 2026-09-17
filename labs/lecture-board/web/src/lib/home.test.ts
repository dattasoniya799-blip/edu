import { describe, expect, it } from 'vitest';
import type { LessonListItem } from './api';
import { filterLessons, formatRelativeTime, isPending, stageKind, stageLabel, stageProgress, subjectLabel } from './home';

describe('subjectLabel', () => {
  it('三科都有中文标签', () => {
    expect(subjectLabel('math')).toBe('数学');
    expect(subjectLabel('physics')).toBe('物理');
    expect(subjectLabel('chemistry')).toBe('化学');
  });

  it('undefined(还没出剧本)给「未分类」', () => {
    expect(subjectLabel(undefined)).toBe('未分类');
  });
});

describe('stageLabel / stageKind / stageProgress', () => {
  it('ready 是绿、100%', () => {
    expect(stageKind('ready')).toBe('ready');
    expect(stageProgress('ready')).toBe(100);
    expect(stageLabel('ready')).toBe('就绪');
  });

  it('failed 是红', () => {
    expect(stageKind('failed')).toBe('failed');
    expect(stageLabel('failed')).toBe('生成失败');
  });

  it('中间阶段是 pending,进度递增', () => {
    expect(stageKind('recognizing')).toBe('pending');
    expect(stageKind('scripting')).toBe('pending');
    expect(stageProgress('uploaded')).toBeLessThan(stageProgress('recognizing'));
    expect(stageProgress('recognizing')).toBeLessThan(stageProgress('planning'));
    expect(stageProgress('planning')).toBeLessThan(stageProgress('scripting'));
    expect(stageProgress('scripting')).toBeLessThan(stageProgress('assets'));
    expect(stageProgress('assets')).toBeLessThan(stageProgress('ready'));
  });
});

describe('isPending', () => {
  it('只有 ready/failed 不算 pending', () => {
    expect(isPending({ stage: 'ready' })).toBe(false);
    expect(isPending({ stage: 'failed' })).toBe(false);
    expect(isPending({ stage: 'recognizing' })).toBe(true);
    expect(isPending({ stage: 'uploaded' })).toBe(true);
  });
});

describe('formatRelativeTime', () => {
  const NOW = Date.parse('2026-09-17T12:00:00.000Z');

  it('一分钟以内:刚刚', () => {
    expect(formatRelativeTime(new Date(NOW - 10_000).toISOString(), NOW)).toBe('刚刚');
  });

  it('几分钟前', () => {
    expect(formatRelativeTime(new Date(NOW - 5 * 60_000).toISOString(), NOW)).toBe('5 分钟前');
  });

  it('几小时前', () => {
    expect(formatRelativeTime(new Date(NOW - 3 * 3_600_000).toISOString(), NOW)).toBe('3 小时前');
  });

  it('几天前', () => {
    expect(formatRelativeTime(new Date(NOW - 2 * 86_400_000).toISOString(), NOW)).toBe('2 天前');
  });

  it('超过 30 天给日期', () => {
    expect(formatRelativeTime(new Date(NOW - 40 * 86_400_000).toISOString(), NOW)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('非法时间给空串', () => {
    expect(formatRelativeTime('not-a-date', NOW)).toBe('');
  });
});

describe('filterLessons', () => {
  const items: LessonListItem[] = [
    { id: 'a', createdAt: '2026-09-17T10:00:00Z', stage: 'ready', title: '浮力潜艇', subject: 'physics', summary: '压强与浮力' },
    { id: 'b', createdAt: '2026-09-17T09:00:00Z', stage: 'ready', title: '圆与圆周角', subject: 'math', summary: '圆周角定理' },
    { id: 'c', createdAt: '2026-09-17T08:00:00Z', stage: 'recognizing', subject: undefined, title: undefined, summary: undefined },
  ];

  it('subject=all 且无关键词:原样返回', () => {
    expect(filterLessons(items, 'all', '')).toHaveLength(3);
  });

  it('按学科过滤', () => {
    expect(filterLessons(items, 'physics', '').map((i) => i.id)).toEqual(['a']);
    expect(filterLessons(items, 'math', '').map((i) => i.id)).toEqual(['b']);
  });

  it('生成中(subject 未定)在具体学科 tab 下不出现', () => {
    expect(filterLessons(items, 'physics', '').some((i) => i.id === 'c')).toBe(false);
    expect(filterLessons(items, 'all', '').some((i) => i.id === 'c')).toBe(true);
  });

  it('关键词匹配标题/摘要,大小写不敏感', () => {
    expect(filterLessons(items, 'all', '浮力').map((i) => i.id)).toEqual(['a']);
    expect(filterLessons(items, 'all', '圆周角').map((i) => i.id)).toEqual(['b']);
  });

  it('关键词也能命中 id', () => {
    expect(filterLessons(items, 'all', 'c').map((i) => i.id)).toEqual(['c']);
  });

  it('学科 + 关键词同时生效', () => {
    expect(filterLessons(items, 'physics', '圆').map((i) => i.id)).toEqual([]);
  });
});
