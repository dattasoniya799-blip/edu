/**
 * TexText · KaTeX/mhchem 混排渲染
 * 逐字移植原型 v0.4 的 renderMix:$..$ 行内、$$..$$ 块级、\ce{} 化学式;
 * 公式语法错误时显示红色 mono 提示(与原型 safeTex 行为一致)。
 */
import { useMemo } from 'react';
import katex from 'katex';
import 'katex/contrib/mhchem';
import 'katex/dist/katex.min.css';

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function safeTex(t: string, disp: boolean): string {
  try {
    return katex.renderToString(t, { displayMode: disp, throwOnError: true });
  } catch {
    // 颜色用语义类(tex-error),由组件内联到 design-tokens 的 red —— 不写裸色值
    return `<span class="qm-tex-error" style="font-size:12px">[公式语法错误] ${esc(t)}</span>`;
  }
}

/** 与原型 renderMix 等价的纯函数(便于单测) */
export function renderMix(src: string): string {
  let out = '';
  let i = 0;
  while (i < src.length) {
    if (src.startsWith('$$', i)) {
      const j = src.indexOf('$$', i + 2);
      if (j < 0) { out += esc(src.slice(i)); break; }
      out += safeTex(src.slice(i + 2, j), true);
      i = j + 2;
    } else if (src[i] === '$') {
      const j = src.indexOf('$', i + 1);
      if (j < 0) { out += esc(src.slice(i)); break; }
      out += safeTex(src.slice(i + 1, j), false);
      i = j + 1;
    } else {
      let j = src.indexOf('$', i);
      if (j < 0) j = src.length;
      out += esc(src.slice(i, j)).replace(/\n/g, '<br>');
      i = j;
    }
  }
  return out;
}

export interface TexTextProps {
  /** 混排源文本($..$ 行内、$$..$$ 块级、\ce{} 化学式) */
  src: string;
  className?: string;
}

export function TexText({ src, className = '' }: TexTextProps) {
  const html = useMemo(() => renderMix(src), [src]);
  return (
    <span
      className={`qm-tex text-current [&_.qm-tex-error]:text-red [&_.qm-tex-error]:font-mono ${className}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
