/**
 * 题卡(展示组件,无副作用):题干/选项/填空/解答题拍照占位 + 即时判分反馈
 * 数学内容一律 <TexText/>;全部可点目标 ≥44px(min-h-touch,touch44.spec 断言)
 */
import { useId } from 'react';
import type { AnswerResponse } from '@qiming/contracts';
import { Tag, TexText } from '@qiming/ui';
import type { ItemState } from './machine';
import type { AttemptQuestionView } from './types';

export const TYPE_LABEL: Record<string, string> = { single: '单选题', multi: '多选题', blank: '填空题', solution: '解答题' };

export interface QuestionPanelProps {
  q: AttemptQuestionView;
  item: ItemState;
  /** 未确认的草稿作答 */
  draft: AnswerResponse | null;
  onDraft: (r: AnswerResponse | null) => void;
  /** 订正/错题重做卷 → 显示「原错题」标 */
  redoKind?: boolean;
}

export function QuestionPanel({ q, item, draft, onDraft, redoKind }: QuestionPanelProps) {
  const locked = item.response != null;
  return (
    <div className="rounded-lg border border-line bg-card p-5 shadow-card">
      <div className="mb-3 flex items-center gap-1.5">
        <Tag tone={q.type === 'solution' ? 'green' : 'primary'}>{TYPE_LABEL[q.type] ?? q.type}</Tag>
        {redoKind && <Tag tone="red">原错题</Tag>}
        {item.flagged && <Tag tone="orange">⚑ 已标记</Tag>}
        <span className="ml-auto text-xs tabular-nums text-ink-3">本题 {q.score} 分</span>
      </div>
      <div className="text-[15px] leading-8 text-ink">
        <TexText src={q.stemLatex} />
      </div>

      <div className="mt-4">
        {(q.type === 'single' || q.type === 'multi') && (
          <OptionList q={q} item={item} draft={draft} onDraft={onDraft} locked={locked} />
        )}
        {q.type === 'blank' && <BlankInputs q={q} item={item} draft={draft} onDraft={onDraft} locked={locked} />}
        {q.type === 'solution' && <SolutionPad item={item} draft={draft} onDraft={onDraft} locked={locked} />}
      </div>

      <FeedbackPanel item={item} />
    </div>
  );
}

// ---------------- 选项 ----------------
function OptionList({ q, item, draft, onDraft, locked }: QuestionPanelProps & { locked: boolean }) {
  const fromResp = (r: AnswerResponse | null): string[] =>
    r == null ? [] : 'choice' in r ? [r.choice] : 'choices' in r ? r.choices : [];
  const chosen = fromResp(locked ? item.response : draft);
  const fb = item.feedback;
  // 判定后:答对 → 所选绿;答错 → 所选红 + 正确项绿(correctAnswer 为选项字母,多选逗号分隔)
  const correct = fb?.judged ? (fb.isCorrect ? chosen : (fb.correctAnswer ?? '').split(',')) : null;

  const pick = (label: string) => {
    if (q.type === 'single') return onDraft({ choice: label });
    const next = chosen.includes(label) ? chosen.filter((l) => l !== label) : [...chosen, label].sort();
    onDraft(next.length ? { choices: next } : null);
  };

  return (
    <div className="flex flex-col gap-2.5" role="listbox" aria-label="选项">
      {q.options.map((o) => {
        const state = correct != null
          ? correct.includes(o.label) ? 'correct' : chosen.includes(o.label) ? 'wrong' : 'idle'
          : chosen.includes(o.label) ? 'chosen' : 'idle';
        const frame = {
          idle: 'border-line bg-card hover:border-ink-3',
          chosen: 'border-primary bg-primary-soft',
          correct: 'border-green bg-green-soft',
          wrong: 'border-red bg-red-soft',
        }[state];
        const badge = {
          idle: 'border-line bg-bg text-ink-2',
          chosen: 'border-primary bg-primary text-card',
          correct: 'border-green bg-green text-card',
          wrong: 'border-red bg-red text-card',
        }[state];
        return (
          <button
            key={o.label}
            type="button"
            disabled={locked}
            aria-pressed={chosen.includes(o.label)}
            onClick={() => pick(o.label)}
            className={`min-h-touch flex w-full items-center gap-3 rounded-md border-[1.5px] px-4 py-2.5 text-left text-sm transition-all disabled:cursor-default ${frame}`}
          >
            <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-pill border text-xs font-bold ${badge}`}>
              {o.label}
            </span>
            <TexText src={o.contentLatex} />
          </button>
        );
      })}
    </div>
  );
}

// ---------------- 填空 ----------------
function BlankInputs({ q, item, draft, onDraft, locked }: QuestionPanelProps & { locked: boolean }) {
  const blanks = Math.max(1, (q.stemLatex.match(/_{3,}|＿{2,}/g) ?? []).length);
  const texts = locked
    ? item.response && 'texts' in item.response ? item.response.texts : []
    : draft && 'texts' in draft ? draft.texts : [];
  return (
    <div className="flex flex-col gap-2.5">
      {Array.from({ length: blanks }, (_, i) => (
        <label key={i} className="flex min-h-touch items-center gap-2.5">
          <span className="shrink-0 text-xs text-ink-3">第 {i + 1} 空</span>
          <input
            value={texts[i] ?? ''}
            disabled={locked}
            placeholder="输入答案,如 y=2x+1(空格与全角不影响判分)"
            onChange={(e) => {
              const next = Array.from({ length: blanks }, (_, j) => (j === i ? e.target.value : texts[j] ?? ''));
              onDraft(next.some((t) => t.trim() !== '') ? { texts: next } : null);
            }}
            className="min-h-touch w-full max-w-[420px] rounded-[10px] border-[1.5px] border-line bg-card px-3.5 text-sm text-ink outline-none transition-all focus:border-primary disabled:bg-bg"
          />
        </label>
      ))}
    </div>
  );
}

// ---------------- 解答题:拍照上传占位(MVP 裁剪:手写板标「即将上线」) ----------------
function SolutionPad({ item, draft, onDraft, locked }: Pick<QuestionPanelProps, 'item' | 'draft' | 'onDraft'> & { locked: boolean }) {
  const inputId = useId();
  const photoKey = locked
    ? item.response && 'photoOssKey' in item.response ? item.response.photoOssKey : null
    : draft && 'photoOssKey' in draft ? draft.photoOssKey : null;
  return (
    <div className="rounded-md border border-line bg-bg/60 p-4">
      <div className="mb-3 flex gap-2">
        <span className="min-h-touch inline-flex items-center rounded-pill bg-primary px-4 text-[13px] font-semibold text-card">📷 拍照上传</span>
        <button
          type="button"
          disabled
          className="min-h-touch inline-flex items-center rounded-pill border border-line bg-card px-4 text-[13px] text-ink-3"
          title="手写板 v1.1 上线"
        >
          ✍ 手写作答 · 即将上线
        </button>
      </div>
      {!locked && (
        <>
          <input
            id={inputId}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onDraft({ photoOssKey: `mock/uploads/${Date.now()}-${f.name}` });
            }}
          />
          <label
            htmlFor={inputId}
            className="min-h-touch flex cursor-pointer flex-col items-center justify-center gap-1 rounded-md border-[1.5px] border-dashed border-line bg-card py-6 text-center transition-all hover:border-primary"
          >
            <span className="text-xl text-ink-3">📷</span>
            <span className="text-[13px] text-ink-2">{photoKey ? '重新拍摄' : '拍摄纸质作答并上传'}</span>
            <span className="text-xs text-ink-3">在纸上写完整过程 → 拍照,AI 预批后由老师复核给分</span>
          </label>
        </>
      )}
      {photoKey && (
        <div className="mt-3 flex min-h-touch items-center gap-2 rounded-md border border-line bg-card px-3.5 text-[13px] text-ink-2">
          <span aria-hidden>🖼</span>
          <span className="truncate">已选择作答照片:{photoKey.split('/').pop()}</span>
          {locked && <Tag tone="violet" className="ml-auto shrink-0">待 AI 预批</Tag>}
        </div>
      )}
    </div>
  );
}

// ---------------- 即时判分反馈 ----------------
function FeedbackPanel({ item }: { item: ItemState }) {
  const fb = item.feedback;
  if (!fb) return null;
  if (!fb.judged) {
    return (
      <div className="mt-4 rounded-md bg-violet-soft px-4 py-3 text-[13px] leading-6 text-violet">
        ✓ 解答已提交:AI 预批后由老师复核,最终得分以老师复核为准。
      </div>
    );
  }
  if (fb.restored) {
    return (
      <div className="mt-4 rounded-md bg-bg px-4 py-3 text-[13px] leading-6 text-ink-2">
        {fb.isCorrect ? '✓ 本题已作答(正确)' : '✕ 本题已作答(错误)'} · 续答恢复,完整解析交卷后可看
      </div>
    );
  }
  if (fb.isCorrect) {
    return <div className="mt-4 rounded-md bg-green-soft px-4 py-3 text-[13px] font-semibold leading-6 text-green">✓ 回答正确</div>;
  }
  return (
    <div className="mt-4 rounded-md bg-red-soft px-4 py-3 text-[13px] leading-7">
      <b className="text-red">✕ 回答错误</b>
      {fb.correctAnswer != null && (
        <span className="ml-2 text-ink">
          正确答案:<TexText src={fb.correctAnswer} />
        </span>
      )}
      {fb.analysisLatex && (
        <div className="mt-1 text-ink-2">
          <b className="mr-1 text-ink">解析</b>
          <TexText src={fb.analysisLatex} />
        </div>
      )}
    </div>
  );
}
