import { useEffect, useRef, useState } from 'react';

export const RATES = [0.8, 1, 1.25, 1.5];

export function TopBar(props: {
  title: string;
  zoom: number;
  onZoom(dir: -1 | 0 | 1): void;
  playing: boolean;
  canPlay: boolean;
  onPlayPause(): void;
  stepIndex: number;
  stepCount: number;
  canPrev?: boolean;
  canNext?: boolean;
  onPrev(): void;
  onNext(): void;
  rate: number;
  onRate(r: number): void;
  muted: boolean;
  onMute(): void;
  onBack(): void;
  status?: string;
}) {
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenu(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [menu]);

  const shown = Math.min(props.stepCount, Math.max(1, props.stepIndex + 1));

  return (
    <header className="topbar">
      <button className="tb-close" onClick={props.onBack} aria-label="返回">
        ✕
      </button>
      <div className="tb-pill">{props.title}</div>

      <div className="tb-center">
        <div className="tb-group">
          <button onClick={() => props.onZoom(-1)} aria-label="缩小">
            −
          </button>
          <span className="tb-readout" onClick={() => props.onZoom(0)} style={{ cursor: 'pointer' }}>
            {Math.round(props.zoom * 100)}%
          </span>
          <button onClick={() => props.onZoom(1)} aria-label="放大">
            +
          </button>
        </div>

        <div className="tb-group">
          <button onClick={props.onPrev} disabled={!(props.canPrev ?? props.stepIndex > 0)} aria-label="上一步">
            ‹
          </button>
          <span className="tb-readout">
            {shown} / {Math.max(1, props.stepCount)}
          </span>
          <button
            onClick={props.onNext}
            disabled={props.stepCount === 0 || !(props.canNext ?? true)}
            aria-label="下一步"
          >
            ›
          </button>
        </div>

        <button className="tb-play" onClick={props.onPlayPause} disabled={!props.canPlay} aria-label="播放/暂停">
          {props.playing ? '⏸' : '▷'}
        </button>

        <div className="tb-menu" ref={menuRef}>
          <div className="tb-group">
            <button onClick={() => setMenu((v) => !v)} aria-label="设置">
              ⚙
            </button>
            <span className="tb-readout">{props.rate}×</span>
          </div>
          {menu && (
            <div className="tb-menu-panel">
              {RATES.map((r) => (
                <button key={r} className={r === props.rate ? 'is-on' : ''} onClick={() => props.onRate(r)}>
                  语速 {r}×
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="tb-right">
        {props.status && <span className="tb-status">{props.status}</span>}
        <button className="tb-play" onClick={props.onMute} aria-label="静音">
          {props.muted ? '🔇' : '🔊'}
        </button>
      </div>
    </header>
  );
}
