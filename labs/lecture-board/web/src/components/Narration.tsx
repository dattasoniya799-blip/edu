import { useEffect, useRef } from 'react';

export type NarrationInput =
  | { kind: 'segment'; icon: string; label: string }
  | { kind: 'say'; text: string }
  | { kind: 'note'; icon: string; text: string }
  | { kind: 'error'; text: string };

export type NarrationEntry = NarrationInput & { uid: number };

/** 右栏旁白流:按 step 分段(✎ 列标题),配图 🖼 / 动画 🎞 作为动作行插在流里。 */
export function NarrationPanel({ entries, footer }: { entries: NarrationEntry[]; footer?: string }) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [entries.length]);

  const lastSayUid = [...entries].reverse().find((e) => e.kind === 'say')?.uid;

  return (
    <aside className="narration">
      <div className="narration-head">
        <span>讲解记录</span>
      </div>
      <div className="narration-body">
        {entries.length === 0 && <p className="nr-note">点 ▷ 开讲;讲到哪儿这里就记到哪儿。</p>}
        {entries.map((e) => {
          if (e.kind === 'segment') {
            return (
              <div className="nr-seg" key={e.uid}>
                <span>{e.icon}</span>
                <span>{e.label}</span>
              </div>
            );
          }
          if (e.kind === 'say') {
            return (
              <p className={`nr-say${e.uid === lastSayUid ? ' is-current' : ''}`} key={e.uid}>
                {e.text}
              </p>
            );
          }
          if (e.kind === 'note') {
            return (
              <p className="nr-note" key={e.uid}>
                {e.icon} {e.text}
              </p>
            );
          }
          return (
            <p className="nr-error" key={e.uid}>
              {e.text}
            </p>
          );
        })}
        <div ref={endRef} />
      </div>
      {footer && <div className="narration-foot">{footer}</div>}
    </aside>
  );
}
