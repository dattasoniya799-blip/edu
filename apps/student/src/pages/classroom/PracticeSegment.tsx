/**
 * 环节③ 随堂练 + ③b 大题(原型 s-class / s-bigq):
 * 复用 B5 答题组件(QuestionPanel/AnswerCard,不改其行为)+ AI 助教侧栏;
 * 作答走 WS class:answer;大题(解答题)拍照上传 → AI 预批结果卡(AnswerResult.narration 按行渲染)。
 * 题面缺失(契约 B6-1 未落地)→ 降级占位。
 */
import { useState } from 'react';
import type { AnswerResponse } from '@qiming/contracts';
import { Button, EmptyState, ProgressBar, Tag, TexText, useToast } from '@qiming/ui';
import { AnswerCard } from '../homework/AnswerCard';
import { TutorPanel } from './TutorPanel';
import { answeredCount } from '../homework/machine';
import { QuestionPanel } from '../homework/QuestionPanel';
import type { ClassState } from './machine';

export interface PracticeSegmentProps {
  state: ClassState;
  onAnswer(questionId: number, response: AnswerResponse): Promise<void>;
  onGoto(index: number): void;
  onFlag(questionId: number): void;
  onAsk(text: string): void;
  onTouch(questionId?: number | null): void;
  /** 完成随堂练 → 小结 */
  onDone(): void;
}

/** AI 预批结果卡(原型 .ai-grade):narration 按行渲染,✓ 绿 / ✕ 红 */
export function PreGradeCard({ narration, onDone }: { narration: string; onDone(): void }) {
  const lines = narration.split('\n').filter(Boolean);
  return (
    <div className="mt-3.5 rounded-md border-[1.5px] border-green bg-green-soft/60 p-4 text-[13px] leading-7">
      {lines.map((line, i) => (
        <div key={i} className={i === 0 ? 'mb-1 font-extrabold text-green' : line.startsWith('✕') ? 'text-red' : line.startsWith('✓') ? 'text-green' : 'text-ink-2'}>
          <TexText src={line} />
        </div>
      ))}
      <div className="mt-2 flex justify-end">
        <Button variant="primary" className="min-h-touch" onClick={onDone}>完成随堂练,进入小结 →</Button>
      </div>
    </div>
  );
}

export function PracticeSegment({ state, onAnswer, onGoto, onFlag, onAsk, onTouch, onDone }: PracticeSegmentProps) {
  const { toast } = useToast();
  const [drafts, setDrafts] = useState<Record<number, AnswerResponse | null>>({});
  const [submitting, setSubmitting] = useState(false);

  const { quiz, questions } = state;
  if (questions.length === 0 || quiz.items.length === 0) {
    return (
      <div className="mx-auto max-w-[860px] rounded-lg border border-line bg-card p-10 shadow-card">
        <EmptyState icon="✎" text="随堂练题面暂不可用" hint="题面下发依赖契约 B6-1(沿用 B5-1 学生视图);可先听讲或进入小结" />
        <div className="mt-4 flex justify-center">
          <Button variant="primary" className="min-h-touch" onClick={onDone}>进入小结 →</Button>
        </div>
      </div>
    );
  }

  const idx = quiz.current;
  const q = questions[idx];
  const item = quiz.items[idx];
  const draft = drafts[q.questionId] ?? null;
  const confirmed = item.response != null;
  const answered = answeredCount(quiz);
  const allDone = answered === quiz.items.length;
  const isBigQ = q.type === 'solution';
  const practiceMin = state.session?.segments.find((s) => s.type === 'practice')?.durationMin;

  const confirm = async () => {
    if (!draft || submitting) return;
    setSubmitting(true);
    try {
      await onAnswer(q.questionId, draft);
      setDrafts((d) => ({ ...d, [q.questionId]: null }));
    } catch (e) {
      toast(e instanceof Error ? e.message : '提交失败,请重试');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="grid grid-cols-[1fr_300px] items-start gap-4">
      <div>
        {/* 进度条(原型 quiz-prog) */}
        <div className="mb-3.5 flex items-center gap-3.5 rounded-lg border border-line bg-card px-4 py-3 shadow-card">
          <b className="shrink-0 text-[13.5px] tabular-nums">随堂练 · 第 {idx + 1} / {quiz.items.length} 题</b>
          <ProgressBar className="flex-1" tone="primary" value={(answered / quiz.items.length) * 100} />
          <span className="shrink-0 text-xs text-ink-3">
            已答 {answered} 题{practiceMin != null && ` · 本环节约 ${practiceMin} 分钟`}
          </span>
          {isBigQ && <Tag tone="green" className="shrink-0">压轴大题</Tag>}
        </div>

        <QuestionPanel q={q} item={item} draft={draft}
          onDraft={(r) => { setDrafts((d) => ({ ...d, [q.questionId]: r })); onTouch(q.questionId); }} />

        {/* 大题:提交后展示 AI 预批结果卡 */}
        {isBigQ && confirmed && state.preGrade[q.questionId] && (
          <PreGradeCard narration={state.preGrade[q.questionId]} onDone={onDone} />
        )}

        <div className="mt-3.5 flex items-center gap-2.5">
          <Button className={`min-h-touch ${item.flagged ? '!border-orange !text-orange' : ''}`} onClick={() => onFlag(q.questionId)}>
            ⚑ {item.flagged ? '取消标记' : '标记'}
          </Button>
          <Button className="min-h-touch" disabled={idx === 0} onClick={() => onGoto(idx - 1)}>← 上一题</Button>
          <div className="flex-1" />
          {!confirmed ? (
            <Button variant="primary" className="min-h-touch min-w-[150px]" disabled={!draft || submitting} onClick={confirm}>
              {submitting ? '提交中…' : isBigQ ? '提交作答' : '确认答案'}
            </Button>
          ) : idx < quiz.items.length - 1 ? (
            <Button variant="primary" className="min-h-touch min-w-[150px]" onClick={() => onGoto(idx + 1)}>
              下一题 →
            </Button>
          ) : (
            <Button variant="primary" className="min-h-touch min-w-[180px]" onClick={onDone}>
              {allDone ? '完成随堂练,进入小结 →' : '先去小结(可随时回来)→'}
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-4">
        <AnswerCard quiz={quiz} onGoto={onGoto} />
        <TutorPanel chat={state.chat} guideOnly={state.session?.mode.guideOnly ?? true} onAsk={onAsk} />
      </div>
    </div>
  );
}
