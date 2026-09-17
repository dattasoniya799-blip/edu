/** 图卡:pending → 骨架;scene → <img>;diagram → Mermaid 即时渲染。 */
import { useEffect, useRef, useState } from 'react';
import type { Figure } from '../../types';

export function FigureCard({ figure }: { figure: Figure | undefined }) {
  if (!figure) return null;
  return (
    <>
      {figure.kind === 'diagram' ? <MermaidBody figure={figure} /> : <SceneBody figure={figure} />}
      {figure.caption && <div className="figure-caption">{figure.caption}</div>}
    </>
  );
}

function SceneBody({ figure }: { figure: Figure }) {
  const [loaded, setLoaded] = useState(false);
  if (figure.status === 'failed') {
    return <div className="figure-failed">配图没出来:{figure.error ?? '生成失败'}(不影响讲解)</div>;
  }
  if (!figure.src) {
    return (
      <>
        <div className="figure-skeleton" style={{ height: 200 }} />
        <div className="figure-caption">配图生成中…</div>
      </>
    );
  }
  return (
    <>
      {!loaded && <div className="figure-skeleton" style={{ height: 200 }} />}
      <img
        src={figure.src}
        alt={figure.caption ?? ''}
        onLoad={() => setLoaded(true)}
        style={{ display: loaded ? 'block' : 'none', width: '100%', borderRadius: 8 }}
      />
    </>
  );
}

function MermaidBody({ figure }: { figure: Figure }) {
  const ref = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const source = figure.mermaid;
    if (!source) return;
    let cancelled = false;
    void (async () => {
      try {
        const mermaid = (await import('mermaid')).default;
        mermaid.initialize({ startOnLoad: false, theme: 'neutral', fontFamily: 'Excalifont, Xiaolai, sans-serif' });
        const { svg } = await mermaid.render(`mmd-${Math.random().toString(36).slice(2)}`, source);
        if (!cancelled && ref.current) ref.current.innerHTML = svg;
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [figure.mermaid]);

  if (!figure.mermaid) return <div className="figure-failed">diagram 缺 mermaid 源码</div>;
  if (failed) return <pre style={{ fontSize: 12, overflowX: 'auto' }}>{figure.mermaid}</pre>;
  return <div ref={ref} style={{ display: 'flex', justifyContent: 'center' }} />;
}
