import { describe, expect, it } from 'vitest';
import { animIframeHeight, withBaseCss } from './html-anim';

/**
 * README「已知待改」1:LLM 生成的 HTML 动画画面偏小。
 * web 端能管的两层:iframe 高度按卡宽 16:10 算;srcDoc 注入 `!important` 基础 CSS 撑满 html/body/canvas/svg。
 */
describe('animIframeHeight · 按卡宽 16:10 算高度', () => {
  it('宽 445(README 里的 COL_W)→ 约 278', () => {
    expect(animIframeHeight(445)).toBe(278);
  });
  it('更宽的列按比例更高', () => {
    expect(animIframeHeight(800)).toBeGreaterThan(animIframeHeight(445));
  });
  it('夹在上下限之间,极端值不失控', () => {
    expect(animIframeHeight(10)).toBeGreaterThanOrEqual(160);
    expect(animIframeHeight(5000)).toBeLessThanOrEqual(560);
  });
  it('量不到宽度时退回固定值 280', () => {
    expect(animIframeHeight(0)).toBe(280);
    expect(animIframeHeight(undefined)).toBe(280);
    expect(animIframeHeight(NaN)).toBe(280);
  });
});

describe('withBaseCss · 撑满 html/body/canvas/svg', () => {
  it('有 <head> 时插进 head 里', () => {
    const html = '<!doctype html><html><head><title>x</title></head><body><canvas></canvas></body></html>';
    const out = withBaseCss(html);
    expect(out).toContain('__lecture_base_css');
    expect(out.indexOf('__lecture_base_css')).toBeLessThan(out.indexOf('<canvas'));
    expect(out).toContain('<title>x</title>'); // 原内容不丢
  });
  it('没有 <head> 但有 <html> 时插在 html 开头', () => {
    const html = '<html><body><svg></svg></body></html>';
    const out = withBaseCss(html);
    expect(out).toContain('__lecture_base_css');
    expect(out.indexOf('__lecture_base_css')).toBeLessThan(out.indexOf('<svg>'));
  });
  it('连 <html> 都没有(纯 body 片段)时插在最前面', () => {
    const html = '<canvas id="c"></canvas><script>window.lecture={do(){},unlock(){},reset(){}}</script>';
    const out = withBaseCss(html);
    expect(out.startsWith('<style')).toBe(true);
  });
  it('CSS 里 canvas/svg 是 width:100%!important;height:100%!important(不是 height:auto)', () => {
    const out = withBaseCss('<html><body><canvas></canvas></body></html>');
    expect(out).toMatch(/canvas,svg\{[^}]*height:100%!important/);
  });
  it('空输入原样返回,不报错', () => {
    expect(withBaseCss('')).toBe('');
    expect(withBaseCss(undefined)).toBe('');
    expect(withBaseCss(null)).toBe('');
  });
});
