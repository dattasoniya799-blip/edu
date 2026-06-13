/**
 * FIX3 问题4:公式按键面板 + 公式输入框
 * - insertSnippet 纯函数:光标标记/选区包裹/越界钳制
 * - FormulaKeypad:每个键 ≥44px(min-h-touch + min-w-[44px]),公式键经 KaTeX 渲染
 * - MathInput:输入框与「公式」开关均 ≥44px;有值时渲染预览(.katex)
 * 注:packages/ui vitest 为 node 环境(无 jsdom),沿用 TexText.spec 在 HTML 串上断言。
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FormulaKeypad, insertSnippet, KEYPAD_GROUPS, CARET_MARK } from '../FormulaKeypad';
import { MathInput } from '../MathInput';

const noop = () => undefined;

/** 抽出所有 <button> 的 class 属性值(node 环境无 DOM,直接解析 SSR 串) */
function buttonClasses(html: string): string[] {
  return [...html.matchAll(/<button\b[^>]*\bclass="([^"]*)"/g)].map((m) => m[1]);
}

describe('insertSnippet', () => {
  it('在光标处插入,无标记则光标落到末尾', () => {
    const r = insertSnippet('ab', 1, 1, 'XY');
    expect(r.value).toBe('aXYb');
    expect(r.caret).toBe(3);
  });

  it('标记 ‸ 决定光标落点(分数模板光标进入第一个 {})', () => {
    const r = insertSnippet('', 0, 0, '\\frac{‸}{}');
    expect(r.value).toBe('\\frac{}{}');
    expect(r.caret).toBe('\\frac{'.length);
    expect(r.value).not.toContain(CARET_MARK);
  });

  it('存在选区时把选中文本包进标记处(选「12」按 √ → \\sqrt{12})', () => {
    const r = insertSnippet('a12b', 1, 3, '\\sqrt{‸}');
    expect(r.value).toBe('a\\sqrt{12}b');
    expect(r.caret).toBe('a\\sqrt{12'.length);
  });

  it('越界选区被钳制,不抛错', () => {
    const r = insertSnippet('x', 99, 99, '+');
    expect(r.value).toBe('x+');
    expect(r.caret).toBe(2);
  });
});

describe('FormulaKeypad 触控 ≥44px', () => {
  const html = renderToStaticMarkup(<FormulaKeypad onInsert={noop} />);
  const classes = buttonClasses(html);

  it('键数与分组数据一致(≥20)', () => {
    const total = KEYPAD_GROUPS.reduce((n, g) => n + g.keys.length, 0);
    expect(classes.length).toBe(total);
    expect(total).toBeGreaterThanOrEqual(20);
  });

  it('每个键 min-h-touch 且 min-w-[44px]', () => {
    for (const c of classes) {
      expect(c).toMatch(/\bmin-h-touch\b/);
      expect(c).toMatch(/min-w-\[44px\]/);
    }
  });

  it('公式键渲染出 KaTeX(分数/根号等)', () => {
    expect((html.match(/class="katex"/g) ?? []).length).toBeGreaterThanOrEqual(10);
  });
});

describe('MathInput', () => {
  it('输入框与「公式」开关均 ≥44px', () => {
    const html = renderToStaticMarkup(<MathInput value="" onChange={noop} ariaLabel="第 1 空" />);
    const inputClass = /<input\b[^>]*\bclass="([^"]*)"/.exec(html)?.[1] ?? '';
    expect(inputClass).toMatch(/\bmin-h-touch\b/);
    for (const c of buttonClasses(html)) expect(c).toMatch(/\bmin-h-touch\b/);
    expect(html).toContain('公式');
  });

  it('有值时渲染实时预览(KaTeX)', () => {
    const html = renderToStaticMarkup(<MathInput value="\\frac{1}{2}" onChange={noop} />);
    expect(html).toContain('class="katex"');
    expect(html).toContain('预览');
  });

  it('locked(disabled)时不渲染「公式」开关', () => {
    const html = renderToStaticMarkup(<MathInput value="y=2x+1" onChange={noop} disabled />);
    expect(buttonClasses(html).length).toBe(0);
  });
});
