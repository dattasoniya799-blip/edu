/**
 * 题目插图渲染(方案 A,2026-06-13 批准):按 anchor 把图落到 题干/选项/解析/参考答案/评分要点。
 * - selectFigures:锚点过滤 + ref 精确匹配 + 缺省 anchor 当题干 + position 排序
 * - QuestionFigures:无图不渲染容器;ossKey 可解析为 URL 时出 <img>,否则占位框
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { QuestionFigure } from '@qiming/contracts';
import { QuestionFigures, selectFigures, hasFigureAt } from '../QuestionFigure';

const figs: QuestionFigure[] = [
  { ossKey: 'k/analysis.png', position: 4, anchor: { target: 'analysis' } },
  { ossKey: 'k/optB.png', position: 3, anchor: { target: 'option', ref: 'B' } },
  { ossKey: 'k/optA.png', position: 2, anchor: { target: 'option', ref: 'A' } },
  { ossKey: 'k/stem-2.png', position: 5 }, // 缺省 anchor → 题干
  { ossKey: 'k/stem-1.png', position: 1, anchor: { target: 'stem' } },
];

describe('selectFigures · anchor 归属', () => {
  it('缺省 anchor 视为题干,并按 position 升序', () => {
    expect(selectFigures(figs, 'stem').map((f) => f.ossKey)).toEqual(['k/stem-1.png', 'k/stem-2.png']);
  });
  it('选项按 ref 精确匹配', () => {
    expect(selectFigures(figs, 'option', 'A').map((f) => f.ossKey)).toEqual(['k/optA.png']);
    expect(selectFigures(figs, 'option', 'B').map((f) => f.ossKey)).toEqual(['k/optB.png']);
    expect(selectFigures(figs, 'option', 'C')).toHaveLength(0);
  });
  it('解析锚点', () => {
    expect(selectFigures(figs, 'analysis').map((f) => f.ossKey)).toEqual(['k/analysis.png']);
  });
  it('未传 ref → 该锚点下全部', () => {
    expect(selectFigures(figs, 'option')).toHaveLength(2);
  });
  it('hasFigureAt 与空输入容错', () => {
    expect(hasFigureAt(figs, 'stem')).toBe(true);
    expect(hasFigureAt(figs, 'reference')).toBe(false);
    expect(selectFigures(undefined, 'stem')).toHaveLength(0);
  });
});

describe('QuestionFigures · 渲染', () => {
  it('无图 → 不渲染容器(null)', () => {
    expect(renderToStaticMarkup(<QuestionFigures figures={figs} target="reference" />)).toBe('');
  });
  it('ossKey 非 URL → 占位框(含 data-figure-target)', () => {
    const html = renderToStaticMarkup(<QuestionFigures figures={figs} target="stem" />);
    expect(html).toContain('data-figure-target="stem"');
    expect(html).toContain('⛶');
    expect(html).not.toContain('<img');
  });
  it('ossKey 为可加载 URL → 出 <img>', () => {
    const url: QuestionFigure[] = [{ ossKey: 'https://oss.example.com/a.png', position: 1, anchor: { target: 'stem' } }];
    const html = renderToStaticMarkup(<QuestionFigures figures={url} target="stem" />);
    expect(html).toContain('<img');
    expect(html).toContain('https://oss.example.com/a.png');
  });
  it('自定义 resolveSrc 注入签名 URL', () => {
    const html = renderToStaticMarkup(
      <QuestionFigures figures={figs} target="option" anchorRef="A" resolveSrc={(k) => `https://cdn/${k}`} />,
    );
    expect(html).toContain('https://cdn/k/optA.png');
  });
});
