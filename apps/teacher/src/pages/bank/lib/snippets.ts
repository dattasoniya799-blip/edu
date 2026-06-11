/** 录题工具条插入片段(与原型 v0.4 t-editor 的 insertTex 完全同款) */
export interface TexSnippet { label: string; tex: string }

export const TEX_SNIPPETS: TexSnippet[] = [
  { label: '分数 a/b', tex: '$\\dfrac{a}{b}$' },
  { label: '√x', tex: '$\\sqrt{x}$' },
  { label: 'x²', tex: '$x^{2}$' },
  { label: '下标', tex: '$x_{1}$' },
  { label: '△ABC', tex: '$\\triangle ABC$' },
  { label: '∠角度', tex: '$\\angle A=90^{\\circ}$' },
  { label: '方程组', tex: '$$\\begin{cases} x+y=5 \\\\ x-y=1 \\end{cases}$$' },
  { label: '化学式', tex: '$\\ce{2H2 + O2 -> 2H2O}$' },
  { label: '物理公式', tex: '$v=v_0+at$' },
];

/** 在光标处(或替换选区)插入片段,返回新文本与新光标位(纯函数,便于单测) */
export function insertSnippet(
  src: string, selStart: number, selEnd: number, snippet: string,
): { text: string; caret: number } {
  const start = Math.max(0, Math.min(selStart, src.length));
  const end = Math.max(start, Math.min(selEnd, src.length));
  const text = src.slice(0, start) + snippet + src.slice(end);
  return { text, caret: start + snippet.length };
}
