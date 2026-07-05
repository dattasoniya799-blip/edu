/**
 * 交卷结果 / 看解析(展示组件):得分汇总 + 逐题判定 + 正确答案与解析(TexText)
 */
import { AnalysisView, QuestionFigures, Tag, TexText } from '@qiming/ui';
import type { AnswerResponse, AssignmentDto, QuestionAnswer } from '@qiming/contracts';
import { resolveFigureSrc } from '../../api';
import { TYPE_LABEL } from './QuestionPanel';
import type { AttemptWithQuestions } from './types';

function renderMyAnswer(r: AnswerResponse | null): { text: string; isPhoto?: boolean } {
  if (r == null) return { text: '未作答' };
  if ('choice' in r) return { text: r.choice };
  if ('choices' in r) return { text: r.choices.join(',') };
  if ('texts' in r) return { text: r.texts.join('; ') };
  if ('photoOssKey' in r) return { text: `照片作答:${r.photoOssKey.split('/').pop() ?? ''}`, isPhoto: true };
  return { text: r.text };
}

/** 契约 QuestionAnswer(对象)→ 可混排展示串(交卷/已判后下发) */
function formatCorrectAnswer(a: QuestionAnswer): string {
  if ('choice' in a) return a.choice;
  if ('choices' in a) return [...a.choices].sort().join(',');
  if ('texts' in a) return a.texts.join('; ');
  return a.referenceLatex;
}

export function ResultView({ attempt, assignment }: { attempt: AttemptWithQuestions; assignment: AssignmentDto | null }) {
  const graded = attempt.status === 'graded';
  const total = assignment?.totalScore ?? attempt.questions.reduce((s, q) => s + q.score, 0);
  const byQid = new Map(attempt.answers.map((a) => [a.questionId, a]));
  const rightCount = attempt.answers.filter((a) => a.isCorrect === true).length;
  const objectiveCount = attempt.questions.filter((q) => q.type !== 'solution').length;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-4 rounded-lg border border-line bg-card p-5 shadow-card">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-green-soft text-xl text-green" aria-hidden>
          {graded ? '✓' : '✦'}
        </div>
        <div className="min-w-0 flex-1">
          <b className="block text-[15px]">{graded ? '已完成并出分' : '已交卷,解答题等待批改'}</b>
          <span className="text-[12.5px] text-ink-2">
            客观题 {rightCount}/{objectiveCount} 对
            {!graded && ' · 解答题 AI 预批后由老师复核,出分后可在「我的课程」查看'}
            {assignment && !assignment.scoreCounted && ' · 本卷为订正/重练,成绩不计分,但已更新掌握度与错题状态'}
          </span>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-[26px] font-extrabold tabular-nums text-primary">
            {graded ? attempt.score : attempt.objectiveScore}
            <span className="text-[13px] font-semibold text-ink-3"> / {total}</span>
          </div>
          <div className="text-xs text-ink-3">{graded ? '本卷得分' : '客观题得分'}</div>
        </div>
      </div>

      {attempt.questions.map((q) => {
        const a = byQid.get(q.questionId);
        const my = renderMyAnswer(a?.response ?? null);
        const tone = a?.isCorrect === true ? 'green' : a?.isCorrect === false ? 'red' : 'violet';
        const verdict = a?.isCorrect === true ? '✓ 正确' : a?.isCorrect === false ? '✕ 错误' : '待批改';
        return (
          <div key={q.questionId} className="rounded-lg border border-line bg-card p-5 shadow-card">
            <div className="mb-2.5 flex items-center gap-1.5">
              <span className="text-[13px] font-bold tabular-nums text-ink-3">第 {q.seq} 题</span>
              <Tag tone={q.type === 'solution' ? 'green' : 'primary'}>{TYPE_LABEL[q.type] ?? q.type}</Tag>
              <Tag tone={tone}>{verdict}</Tag>
              <span className="ml-auto text-xs tabular-nums text-ink-3">
                {a?.score != null ? `${a.score} / ${q.score} 分` : `${q.score} 分`}
              </span>
            </div>
            <div className="text-sm leading-7 text-ink"><TexText src={q.stemLatex} /></div>
            <QuestionFigures figures={q.figures} target="stem" resolveSrc={resolveFigureSrc} />
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[13px]">
              <span className={a?.isCorrect === false ? 'text-red' : 'text-ink-2'}>
                我的答案:{my.isPhoto ? my.text : <TexText src={my.text} />}
              </span>
              {q.correctAnswer != null && q.type !== 'solution' && (
                <span className="text-green">
                  正确答案:<TexText src={formatCorrectAnswer(q.correctAnswer)} />
                  <QuestionFigures figures={q.figures} target="reference" compact resolveSrc={resolveFigureSrc} />
                </span>
              )}
            </div>
            {a?.teacherComment && (
              <div className="mt-3 rounded-md bg-primary-soft p-3.5 text-[13px] leading-7 text-ink-2">
                <b className="text-ink">老师点评</b>
                <div className="mt-1"><TexText src={a.teacherComment} /></div>
              </div>
            )}
            <AnalysisView
              className="mt-3"
              brief={q.analysisBriefLatex}
              normal={q.analysisLatex}
              detail={q.analysisDetailLatex}
              extra={<QuestionFigures figures={q.figures} target="analysis" resolveSrc={resolveFigureSrc} />}
            />
          </div>
        );
      })}
    </div>
  );
}
