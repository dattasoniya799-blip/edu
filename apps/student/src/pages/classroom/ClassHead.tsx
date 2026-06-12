/**
 * 课堂深色头部(原型 classHead):退出 + 课次标题 + 可点步进器 + 已上课计时
 * 深色底 = token ink(#1E2A44,原型 .class-head 同源色);辅助文字用 card 色加透明度派生
 */
import { useEffect, useState } from 'react';
import type { ClassSnapshot } from '@qiming/contracts';

const STEP_LABELS: Record<string, string> = {
  warmup: '开场回顾', lecture: '课件讲解', practice: '随堂练', summary: '小结巩固',
  homework: '课后作业', break_time: '休息',
};
const CIRCLED = ['①', '②', '③', '④', '⑤', '⑥'];

export interface ClassHeadProps {
  title: string;
  segments: ClassSnapshot['session']['segments'];
  /** 当前环节 seq */
  seg: number;
  /** join 时刻的 elapsedSec(本地继续走表) */
  elapsedSec: number;
  /** 重连提示(>0 显示) */
  reconnectAttempt: number;
  onStep(seq: number): void;
  onExit(): void;
}

function fmt(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function ClassHead({ title, segments, seg, elapsedSec, reconnectAttempt, onStep, onExit }: ClassHeadProps) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="flex h-[52px] shrink-0 items-center gap-3.5 bg-ink px-4 text-card">
      <button type="button" onClick={onExit}
        className="min-h-touch rounded-[9px] px-2.5 text-[12.5px] text-card/70 transition-all hover:bg-card/10">
        ← 退出课堂
      </button>
      <span className="truncate text-[13.5px] font-bold">{title}</span>
      <div className="ml-2 flex gap-1.5" role="tablist" aria-label="课堂环节">
        {segments.map((s, i) => {
          const stateCls = s.seq === seg
            ? 'bg-primary font-bold text-card'
            : s.seq < seg
              ? 'bg-card/10 text-green'
              : 'bg-card/10 text-card/50 hover:text-card/80';
          return (
            <button key={s.seq} type="button" role="tab" aria-selected={s.seq === seg}
              onClick={() => onStep(s.seq)}
              className={`min-h-touch flex items-center gap-1 rounded-pill px-3 text-[11.5px] transition-all ${stateCls}`}>
              {s.seq < seg ? '✓' : CIRCLED[i] ?? s.seq} {STEP_LABELS[s.type] ?? s.type}
            </button>
          );
        })}
      </div>
      <span className="ml-auto shrink-0 text-xs tabular-nums text-card/60">
        {reconnectAttempt > 0
          ? <span className="text-orange">⟳ 网络中断,重连中(第 {reconnectAttempt} 次)…</span>
          : <>已上课 {fmt(elapsedSec + tick)}</>}
      </span>
    </div>
  );
}
