/**
 * AI 助教侧栏(原型 .tutor):紫头部 + 气泡 + 快捷 chips + 输入
 * class:ai_ask → class:ai_chunk 流式逐字渲染(streaming 时打字光标)
 */
import { useEffect, useRef, useState } from 'react';
import { TexText } from '@qiming/ui';
import type { ChatMsg } from './machine';

const CHIPS = ['给我一点提示', '知识点没学懂', '举个类似例子'];

export interface TutorPanelProps {
  chat: ChatMsg[];
  /** 引导模式标识(orgSettings.ai.qaGuideOnly / mode.guideOnly) */
  guideOnly: boolean;
  onAsk(text: string): void;
}

export function TutorPanel({ chat, guideOnly, onAsk }: TutorPanelProps) {
  const [input, setInput] = useState('');
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight });
  }, [chat]);

  const send = () => {
    const t = input.trim();
    if (!t) return;
    onAsk(t);
    setInput('');
  };

  return (
    <div className="overflow-hidden rounded-lg border border-line bg-card shadow-card">
      <div className="flex items-center gap-2 bg-gradient-to-r from-violet to-primary px-3.5 py-2.5 text-[13px] font-bold text-card">
        <span aria-hidden className="flex h-6 w-6 items-center justify-center rounded-pill bg-card/25 text-xs">✦</span>
        AI 助教 · 小启
        {guideOnly && <span className="ml-auto text-[11px] font-normal opacity-85">引导模式</span>}
      </div>

      <div ref={bodyRef} className="flex max-h-[260px] min-h-[120px] flex-col gap-2 overflow-auto p-3" data-testid="tutor-body">
        {chat.length === 0 && (
          <div className="max-w-[92%] self-start rounded-[12px] rounded-bl-[4px] bg-violet-soft px-3 py-2 text-[12.5px] leading-6 text-ink">
            卡住了随时问我,我不直接给答案,但会带你想思路 😉
          </div>
        )}
        {chat.map((m, i) => (
          <div key={i} data-role={m.role}
            className={`max-w-[92%] rounded-[12px] px-3 py-2 text-[12.5px] leading-6 ${
              m.role === 'user'
                ? 'self-end rounded-br-[4px] bg-primary text-card'
                : 'self-start rounded-bl-[4px] bg-violet-soft text-ink'
            }`}>
            <TexText src={m.text} />
            {m.streaming && <span aria-hidden className="ml-0.5 inline-block w-[7px] animate-pulse border-b-2 border-violet">&nbsp;</span>}
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-1.5 px-3 pb-2">
        {CHIPS.map((c) => (
          <button key={c} type="button" onClick={() => onAsk(c)}
            className="min-h-touch rounded-pill border border-line bg-bg px-3 text-xs text-ink-2 transition-all hover:border-violet hover:text-violet">
            {c}
          </button>
        ))}
      </div>

      <div className="flex gap-1.5 border-t border-line p-2.5">
        <input
          value={input}
          placeholder="向小启提问…"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') send(); }}
          className="min-h-touch w-full min-w-0 flex-1 rounded-[10px] border-[1.5px] border-line bg-card px-3 text-[13px] outline-none transition-all focus:border-violet"
        />
        <button type="button" onClick={send} aria-label="发送"
          className="min-h-touch shrink-0 rounded-[10px] bg-violet px-3.5 text-sm text-card transition-all hover:opacity-90">
          ➤
        </button>
      </div>
    </div>
  );
}
