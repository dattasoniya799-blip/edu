import katex from 'katex';
import { useMemo } from 'react';

/** 板书 formula 行:tex 交给 KaTeX 排版(speech 归 TTS,两条轨不混)。 */
export function Tex({ tex, display = false }: { tex: string; display?: boolean }) {
  const html = useMemo(() => {
    try {
      return katex.renderToString(tex, { throwOnError: false, displayMode: display, output: 'html' });
    } catch {
      return `<code>${tex}</code>`;
    }
  }, [tex, display]);
  return <span dangerouslySetInnerHTML={{ __html: html }} />;
}
