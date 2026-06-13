/**
 * AnalysisView · 三种解析展示(C2 #7)
 *  - 纯逻辑:可用档位顺序 / 默认正常 / 回退首个可用 / 全空
 *  - 静态渲染:默认显示正常解析、三档出切换条、单档无切换、全空不渲染
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { AnalysisView, availableAnalyses, resolveActiveAnalysis } from '../AnalysisView';

describe('availableAnalyses', () => {
  it('全空 → []', () => {
    expect(availableAnalyses({})).toEqual([]);
    expect(availableAnalyses({ brief: '', normal: '  ', detail: null })).toEqual([]);
  });
  it('保持 简单→正常→详细 顺序,空档剔除', () => {
    expect(availableAnalyses({ brief: 'a', detail: 'c' }).map((v) => v.key)).toEqual(['brief', 'detail']);
    expect(availableAnalyses({ brief: 'a', normal: 'b', detail: 'c' }).map((v) => v.label))
      .toEqual(['简单解析', '正常解析', '详细解析']);
  });
});

describe('resolveActiveAnalysis', () => {
  const all = availableAnalyses({ brief: 'a', normal: 'b', detail: 'c' });
  it('选中态可用 → 用选中态', () => {
    expect(resolveActiveAnalysis(all, 'detail')).toBe('detail');
  });
  it('选中态不可用 → 回退正常', () => {
    expect(resolveActiveAnalysis(availableAnalyses({ brief: 'a', normal: 'b' }), 'detail')).toBe('normal');
  });
  it('无正常档 → 回退首个可用', () => {
    expect(resolveActiveAnalysis(availableAnalyses({ brief: 'a', detail: 'c' }), 'normal')).toBe('brief');
  });
  it('全空 → null', () => {
    expect(resolveActiveAnalysis([], 'normal')).toBeNull();
  });
});

describe('AnalysisView 渲染', () => {
  it('全空 → 不渲染', () => {
    expect(renderToStaticMarkup(<AnalysisView />)).toBe('');
  });
  it('仅正常 → 显示内容、无切换 tab', () => {
    const html = renderToStaticMarkup(<AnalysisView normal="正常解析XYZ" />);
    expect(html).toContain('正常解析XYZ');
    expect(html).not.toContain('role="tab"');
  });
  it('三档齐全 → 默认正常、出现三个切换 tab', () => {
    const html = renderToStaticMarkup(<AnalysisView brief="简A" normal="正B" detail="详C" />);
    expect(html).toContain('role="tab"');
    expect(html).toContain('简单解析');
    expect(html).toContain('详细解析');
    expect(html).toContain('正B'); // 默认正常档内容
    expect(html).toContain('aria-selected="true"');
  });
});
