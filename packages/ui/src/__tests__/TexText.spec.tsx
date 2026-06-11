/**
 * TexText / renderMix · 25 条公式用例(样例取自原型 v0.4 实际出现的公式)
 * 约定:
 *  - 渲染成功 → 输出含 class="katex"(行内)或 katex-display(块级),且不残留原始 $ 定界符
 *  - 语法错误 → 红色 mono 提示 [公式语法错误](与原型 safeTex 一致)
 *  - 纯文本 → HTML 转义,\n → <br>
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { renderMix, TexText } from '../TexText';

const okInline = (html: string) => {
  expect(html).toContain('class="katex"');
  expect(html).not.toContain('[公式语法错误]');
};

describe('renderMix · 25 条公式用例', () => {
  // ---- 行内公式(原型题干/选项样例) ----
  it('01 幂:$x^{2}$', () => okInline(renderMix('$x^{2}$')));
  it('02 分式:$\\dfrac{a}{b}$', () => okInline(renderMix('$\\dfrac{a}{b}$')));
  it('03 根式:$\\sqrt{x}$', () => okInline(renderMix('$\\sqrt{x}$')));
  it('04 角度:$\\angle A=90^{\\circ}$', () => okInline(renderMix('$\\angle A=90^{\\circ}$')));
  it('05 三角形:$\\triangle ABC$', () => okInline(renderMix('$\\triangle ABC$')));
  it('06 物理公式:$v=v_0+at$', () => okInline(renderMix('$v=v_0+at$')));
  it('07 单位:$a=4\\,\\text{m/s}^2$', () => okInline(renderMix('$a=4\\,\\text{m/s}^2$')));
  it('08 负分数:$k=\\dfrac{-6}{2}=-3$', () => okInline(renderMix('$k=\\dfrac{-6}{2}=-3$')));
  it('09 一次函数:$y=2x+1$', () => okInline(renderMix('$y=2x+1$')));
  it('10 坐标:$(0,\\ b)$', () => okInline(renderMix('$(0,\\ b)$')));
  it('11 下标:$x_{1}$', () => okInline(renderMix('$x_{1}$')));
  it('12 行内方程组:$\\begin{cases} k+b=3 \\\\ -k+b=-1 \\end{cases}$', () =>
    okInline(renderMix('$\\begin{cases} k+b=3 \\\\ -k+b=-1 \\end{cases}$')));

  // ---- mhchem 化学式 ----
  it('13 化学式:$\\ce{Cl2}$', () => okInline(renderMix('$\\ce{Cl2}$')));
  it('14 化学方程式:$\\ce{2H2 + O2 -> 2H2O}$', () => okInline(renderMix('$\\ce{2H2 + O2 -> 2H2O}$')));
  it('15 加热条件+气体符号:$\\ce{MnO2 + 4HCl ->[\\Delta] MnCl2 + Cl2 ^ + 2H2O}$', () =>
    okInline(renderMix('$\\ce{MnO2 + 4HCl ->[\\Delta] MnCl2 + Cl2 ^ + 2H2O}$')));
  it('16 摩尔混排:$1\\,\\text{mol}\\ \\ce{Cl2}$', () => okInline(renderMix('$1\\,\\text{mol}\\ \\ce{Cl2}$')));

  // ---- 块级公式 ----
  it('17 块级方程组:$$\\begin{cases} x+y=5 \\\\ x-y=1 \\end{cases}$$', () => {
    const html = renderMix('$$\\begin{cases} x+y=5 \\\\ x-y=1 \\end{cases}$$');
    expect(html).toContain('katex-display');
    expect(html).not.toContain('[公式语法错误]');
  });
  it('18 块级方程组:$$\\begin{cases} y=2x+1 \\\\ y=-x+4 \\end{cases}$$', () => {
    const html = renderMix('$$\\begin{cases} y=2x+1 \\\\ y=-x+4 \\end{cases}$$');
    expect(html).toContain('katex-display');
  });

  // ---- 文本/公式混排 ----
  it('19 题干混排(原型 seed 题干)', () => {
    const html = renderMix('将直线 $y=2x+1$ 向下平移 $3$ 个单位长度后,所得直线的解析式为(  )');
    expect(html).toContain('将直线');
    expect(html).toContain('class="katex"');
    expect(html).toContain('个单位长度后');
  });
  it('20 多公式混排:$A(1,3)$ 与 $B(-1,-1)$', () => {
    const html = renderMix('经过点 $A(1,3)$ 与点 $B(-1,-1)$');
    expect(html.match(/class="katex"/g)?.length).toBeGreaterThanOrEqual(2);
  });
  it('21 换行转 <br>', () => {
    const html = renderMix('第一行\n第二行 $x=2$');
    expect(html).toContain('第一行<br>第二行');
    expect(html).toContain('class="katex"');
  });

  // ---- 错误与边界(与原型行为一致) ----
  it('22 语法错误 → 红色 mono 提示', () => {
    const html = renderMix('$\\frac{1}{$');
    expect(html).toContain('[公式语法错误]');
    expect(html).toContain('qm-tex-error');
    expect(html).not.toContain('class="katex"');
  });
  it('23 未闭合 $ → 按原文转义输出', () => {
    const html = renderMix('价格为 $9.9');
    expect(html).toBe('价格为 $9.9');
  });
  it('24 未闭合 $$ → 按原文转义输出', () => {
    const html = renderMix('$$x+1');
    expect(html).toBe('$$x+1');
  });
  it('25 纯文本 HTML 转义(防注入)', () => {
    const html = renderMix('a<b & c>d <script>alert(1)</script>');
    expect(html).toContain('a&lt;b &amp; c&gt;d');
    expect(html).not.toContain('<script>');
  });
});

describe('TexText 组件', () => {
  it('渲染公式且错误提示挂红色类', () => {
    const ok = renderToStaticMarkup(<TexText src="掌握 $y=kx+b$ 即可" />);
    expect(ok).toContain('class="katex"');
    const bad = renderToStaticMarkup(<TexText src="$\\frac{$" />);
    expect(bad).toContain('[公式语法错误]');
    expect(bad).toContain('.qm-tex-error]:text-red');
  });
});
