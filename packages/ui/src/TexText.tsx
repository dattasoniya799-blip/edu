/**
 * TexText · 标准 Markdown + 标准 LaTeX 混排渲染(C2 #6)
 *
 * - 标准 LaTeX:$行内$、$$行间$$,KaTeX 渲染(含 mhchem \ce{});语法错误红色 mono 提示。
 * - 标准 Markdown:**加粗** / *斜体*(及 __ / _ 变体)、`行内代码`、有序/无序列表、软换行 → <br>。
 *
 * 实现要点:先把数学公式抽取为占位符(私有区字符,Markdown/转义均不触碰),
 * 再对其余文本做 Markdown 解析,最后把占位符替换回已渲染的 KaTeX —— 这样公式里的
 * `*` `_` 下标、`\\` 不会被 Markdown 误解析。对外 API(TexText / renderMix)保持兼容。
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

// 数学占位符:Unicode 私有区字符,esc() 与 Markdown 正则都不会匹配
const PH_OPEN = '';
const PH_CLOSE = '';
const ph = (i: number) => `${PH_OPEN}${i}${PH_CLOSE}`;

/** 行内 Markdown(输入须已 HTML 转义):代码 → 加粗 → 斜体 */
function renderInline(escaped: string): string {
  let s = escaped;
  // 行内代码优先(其内部不再解析强调)
  s = s.replace(/`([^`\n]+)`/g, '<code class="qm-md-code">$1</code>');
  // 加粗 **…** / __…__
  s = s.replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/__([^_\n]+?)__/g, '<strong>$1</strong>');
  // 斜体 *…*(剩余单星号)/ _…_(要求词边界,避免误伤普通下划线)
  s = s.replace(/\*([^*\n]+?)\*/g, '<em>$1</em>');
  s = s.replace(/(^|[^\w])_([^_\n]+?)_(?![\w])/g, '$1<em>$2</em>');
  return s;
}

/** 块级 Markdown:有序/无序列表 + 段落(软换行 → <br>,空行 → 段落分隔) */
function renderBlocks(src: string): string {
  const lines = src.split('\n');
  const parts: string[] = [];
  let text: string[] = [];
  const flushText = () => {
    if (text.length) { parts.push(text.join('<br>')); text = []; }
  };
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const ul = /^[ \t]*[-*+][ \t]+(.*)$/.exec(line);
    const ol = /^[ \t]*\d+\.[ \t]+(.*)$/.exec(line);
    if (ul || ol) {
      flushText();
      const ordered = !ul;
      const items: string[] = [];
      while (i < lines.length) {
        const m = ordered
          ? /^[ \t]*\d+\.[ \t]+(.*)$/.exec(lines[i])
          : /^[ \t]*[-*+][ \t]+(.*)$/.exec(lines[i]);
        if (!m) break;
        items.push(`<li>${renderInline(esc(m[1]))}</li>`);
        i++;
      }
      parts.push(
        ordered
          ? `<ol class="qm-md-ol">${items.join('')}</ol>`
          : `<ul class="qm-md-ul">${items.join('')}</ul>`,
      );
      continue;
    }
    if (line.trim() === '') {
      flushText();
      if (parts.length && parts[parts.length - 1] !== '<br>') parts.push('<br>');
      i++;
      continue;
    }
    text.push(renderInline(esc(line)));
    i++;
  }
  flushText();
  return parts.join('');
}

/**
 * 标准 Markdown + LaTeX 混排 → HTML(纯函数,便于单测)。
 * 兼容旧行为:$..$ 行内、$$..$$ 块级、\ce{} 化学式、未闭合 $ 按原文输出、纯文本 HTML 转义。
 */
export function renderMix(src: string): string {
  const tokens: string[] = [];
  let work = '';
  let i = 0;
  while (i < src.length) {
    if (src.startsWith('$$', i)) {
      const j = src.indexOf('$$', i + 2);
      if (j < 0) { work += src.slice(i); break; } // 未闭合 → 原文
      tokens.push(safeTex(src.slice(i + 2, j), true));
      work += ph(tokens.length - 1);
      i = j + 2;
    } else if (src[i] === '$') {
      const j = src.indexOf('$', i + 1);
      if (j < 0) { work += src.slice(i); break; } // 未闭合 → 原文
      tokens.push(safeTex(src.slice(i + 1, j), false));
      work += ph(tokens.length - 1);
      i = j + 1;
    } else {
      let j = src.indexOf('$', i);
      if (j < 0) j = src.length;
      work += src.slice(i, j);
      i = j;
    }
  }
  let html = renderBlocks(work);
  // 占位符还原为已渲染公式(放在 Markdown 之后,避免公式内字符被解析)
  html = html.replace(new RegExp(`${PH_OPEN}(\\d+)${PH_CLOSE}`, 'g'), (_, n) => tokens[Number(n)] ?? '');
  return html;
}

export interface TexTextProps {
  /** 混排源文本(标准 Markdown + $..$ 行内 / $$..$$ 块级 / \ce{} 化学式) */
  src: string;
  className?: string;
}

export function TexText({ src, className = '' }: TexTextProps) {
  const html = useMemo(() => renderMix(src), [src]);
  return (
    <span
      className={`qm-tex text-current [&_.qm-tex-error]:text-red [&_.qm-tex-error]:font-mono [&_.qm-md-ul]:list-disc [&_.qm-md-ul]:pl-5 [&_.qm-md-ol]:list-decimal [&_.qm-md-ol]:pl-5 [&_li]:my-0.5 [&_.qm-md-code]:rounded [&_.qm-md-code]:bg-bg [&_.qm-md-code]:px-1 [&_.qm-md-code]:font-mono [&_.qm-md-code]:text-[0.9em] ${className}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
