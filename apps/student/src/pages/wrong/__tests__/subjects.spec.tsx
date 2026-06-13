/**
 * FIX3 问题5:错题本学科分组/筛选
 * - deriveSubjects / isMultiSubject / filterBySubject 纯函数
 * - WrongItemCard:多学科传 subjectLabel 才显示学科标(单科退化不显示)
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { WrongBookItemDto } from '@qiming/contracts';
import { deriveSubjects, isMultiSubject, filterBySubject, type WrongBookItemView } from '../subjects';
import { WrongItemCard } from '../WrongItemCard';

const base: WrongBookItemDto = {
  id: 1, questionId: 1, type: 'single', stemLatex: '题 $x$', analysisLatex: null,
  wrongCount: 1, correctRedoCount: 0, errorTags: ['错因A'], status: 'open',
  sourceName: '练习', createdAt: '2026-06-07T10:30:00.000Z',
};
const mk = (id: number, subject?: string, errorTags = ['错因A']): WrongBookItemView => ({ ...base, id, subject, errorTags });

describe('学科派生', () => {
  it('去重保序,忽略缺失/空白', () => {
    const items = [mk(1, '数学'), mk(2, '物理'), mk(3, '数学'), mk(4), mk(5, '  ')];
    expect(deriveSubjects(items)).toEqual(['数学', '物理']);
  });

  it('单科(或无学科)→ isMultiSubject=false(退化隐藏筛选)', () => {
    expect(isMultiSubject([mk(1, '数学'), mk(2, '数学')])).toBe(false);
    expect(isMultiSubject([mk(1), mk(2)])).toBe(false);
  });

  it('多科 → isMultiSubject=true', () => {
    expect(isMultiSubject([mk(1, '数学'), mk(2, '物理')])).toBe(true);
  });
});

describe('按学科筛选', () => {
  const items = [mk(1, '数学'), mk(2, '物理'), mk(3, '数学')];
  it('null=全部', () => {
    expect(filterBySubject(items, null)).toHaveLength(3);
  });
  it('选定学科只留该科', () => {
    expect(filterBySubject(items, '数学').map((w) => w.id)).toEqual([1, 3]);
    expect(filterBySubject(items, '物理').map((w) => w.id)).toEqual([2]);
  });
});

describe('WrongItemCard 学科标', () => {
  const noop = () => undefined;
  it('传 subjectLabel 时渲染学科标', () => {
    const html = renderToStaticMarkup(<WrongItemCard item={base} subjectLabel="物理" onRedo={noop} />);
    expect(html).toContain('物理');
  });
  it('单科不传 subjectLabel 时不渲染多余学科标', () => {
    const html = renderToStaticMarkup(<WrongItemCard item={base} onRedo={noop} />);
    expect(html).not.toContain('物理');
  });
});
