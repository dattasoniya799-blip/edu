/**
 * 已选题列表 + 逐题分值编辑(讲次版「课后作业组卷」与独立版「试卷库组卷」共用)。
 * 只渲染卡片正文(空态/题行);外层标题与「当前总分」由各页自己控制。
 */
import type { QuestionDto } from '@qiming/contracts';
import { Button, EmptyState, TexText } from '@qiming/ui';
import { QUESTION_TYPE_LABEL, type PaperItem } from '../lib/paper';
import { DiffDots } from './DiffDots';

interface SelectedQuestionListProps {
  items: PaperItem[];
  /** id → 题目详情(题库已拉取),用于回填题干/题型/难度 */
  qById: Map<number, QuestionDto>;
  onScoreChange: (questionId: number, score: number) => void;
  onRemove: (questionId: number) => void;
  /** 空态 CTA / 标题区都用它打开题库选题弹窗 */
  onPick: () => void;
}

export function SelectedQuestionList({ items, qById, onScoreChange, onRemove, onPick }: SelectedQuestionListProps) {
  if (items.length === 0) {
    return (
      <EmptyState
        icon="▤"
        text="还没有选题"
        hint="从题库挑选题目组成本卷"
        action={<Button variant="primary" onClick={onPick}>从题库选题</Button>}
      />
    );
  }
  return (
    <>
      {items.map((it, i) => {
        const q = qById.get(it.questionId);
        return (
          <div key={it.questionId} className="flex items-start gap-3.5 border-b border-line px-5 py-4 last:border-none">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-pill bg-primary-soft text-[13px] font-bold tabular-nums text-primary">
              {i + 1}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[13.5px] leading-[1.8]">
                {q ? <TexText src={q.stemLatex} /> : <span className="text-ink-3">题目 #{it.questionId}</span>}
              </div>
              {q && (
                <div className="mt-1.5 flex flex-wrap items-center gap-3 text-xs text-ink-3">
                  <span>{QUESTION_TYPE_LABEL[q.type]}</span>
                  {q.tags.find((t) => t.graphType === 'curriculum_knowledge') && (
                    <span>{q.tags.find((t) => t.graphType === 'curriculum_knowledge')!.name}</span>
                  )}
                  <span className="inline-flex items-center gap-1.5">难度 <DiffDots level={q.difficulty} /></span>
                  {q.stats.correctRate != null && <span className="tabular-nums">历史正确率 {q.stats.correctRate}%</span>}
                </div>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-1.5 text-[12.5px] text-ink-2">
              <input
                type="number" min={1} max={100}
                className="w-14 rounded-[8px] border-[1.5px] border-line px-2 py-1 text-center text-[13px] tabular-nums focus:border-primary focus:outline-none"
                value={it.score}
                onChange={(e) => onScoreChange(it.questionId, Number(e.target.value))}
                aria-label={`第 ${i + 1} 题分值`}
              />
              分
            </div>
            <button type="button" className="shrink-0 text-[13px] font-medium text-red hover:underline" onClick={() => onRemove(it.questionId)}>
              移除
            </button>
          </div>
        );
      })}
    </>
  );
}
