import { describe, expect, it } from 'vitest';
import { TEX_SNIPPETS, insertSnippet } from '../snippets';

describe('insertSnippet(快捷插入)', () => {
  it('在光标处插入并把光标移到片段末尾', () => {
    const r = insertSnippet('已知,求解。', 3, 3, '$x^{2}$');
    expect(r.text).toBe('已知,$x^{2}$求解。');
    expect(r.caret).toBe(3 + '$x^{2}$'.length);
  });

  it('有选区时替换选区', () => {
    const r = insertSnippet('abcdef', 1, 4, '$y$');
    expect(r.text).toBe('a$y$ef');
    expect(r.caret).toBe(4);
  });

  it('空文本/越界位置安全收敛', () => {
    expect(insertSnippet('', 5, 9, 'X')).toEqual({ text: 'X', caret: 1 });
    expect(insertSnippet('ab', -1, 99, 'X')).toEqual({ text: 'X', caret: 1 });
  });

  it('工具条片段与原型 v0.4 一致(9 个,含方程组/化学式/物理公式)', () => {
    expect(TEX_SNIPPETS).toHaveLength(9);
    expect(TEX_SNIPPETS.map((s) => s.tex)).toContain('$$\\begin{cases} x+y=5 \\\\ x-y=1 \\end{cases}$$');
    expect(TEX_SNIPPETS.map((s) => s.tex)).toContain('$\\ce{2H2 + O2 -> 2H2O}$');
    expect(TEX_SNIPPETS.map((s) => s.tex)).toContain('$v=v_0+at$');
  });
});
