/**
 * 答题卡(展示组件):已答绿 / 当前主色 / 已标记橙 / 未答灰,与原型图例一致
 * 格子 ≥44px(min-h-touch + min-w-[44px],touch44.spec 断言)
 */
import { slotTone, type QuizState } from './machine';

export interface AnswerCardProps {
  quiz: QuizState;
  onGoto: (index: number) => void;
}

export function AnswerCard({ quiz, onGoto }: AnswerCardProps) {
  const toneCls = {
    current: 'border-primary bg-primary text-card shadow-btn-sm',
    flagged: 'border-orange bg-orange-soft text-orange',
    answered: 'border-green bg-green-soft text-green',
    todo: 'border-line bg-bg text-ink-3',
  } as const;
  return (
    <div className="rounded-lg border border-line bg-card p-4 shadow-card">
      <h4 className="mb-3 text-[13.5px] font-bold text-ink">答题卡</h4>
      <div className="flex flex-wrap gap-2">
        {quiz.items.map((it, i) => (
          <button
            key={it.questionId}
            type="button"
            aria-label={`第 ${i + 1} 题`}
            onClick={() => onGoto(i)}
            className={`min-h-touch min-w-[44px] rounded-[10px] border-[1.5px] text-[13.5px] font-bold tabular-nums transition-all ${toneCls[slotTone(quiz, i)]}`}
          >
            {i + 1}
          </button>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink-3">
        <span className="flex items-center gap-1"><i className="h-2 w-2 rounded-pill bg-green" />已答</span>
        <span className="flex items-center gap-1"><i className="h-2 w-2 rounded-pill bg-primary" />当前</span>
        <span className="flex items-center gap-1"><i className="h-2 w-2 rounded-pill bg-orange" />已标记</span>
      </div>
    </div>
  );
}
