/**
 * 课后答题器(作业/订正/错题重做共用,原型 s-homework 段)
 * 进度条 + 答题卡 + 单选/填空/拍照交互 + 即时判分反馈 + 断点续答(?attempt= → GET 快照恢复)
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { AnswerResponse, AssignmentDto } from '@qiming/contracts';
import { Button, Modal, ProgressBar, Skeleton, useToast } from '@qiming/ui';
import { api, uploadAnswerPhoto } from '../../api';
import { AnswerCard } from './AnswerCard';
import { allAnswered, answeredCount } from './machine';
import { QuestionPanel } from './QuestionPanel';
import { ResultView } from './ResultView';
import { useAttempt } from './useAttempt';

const KIND_LABEL: Record<string, string> = {
  homework: '课后作业', in_class: '随堂练', correction: '订正', wrong_redo: '错题重做', consolidation: '巩固练',
};

export function HomeworkPage() {
  const { assignmentId: idStr } = useParams();
  const assignmentId = Number(idStr);
  const [sp, setSp] = useSearchParams();
  const attemptInUrl = sp.get('attempt') ? Number(sp.get('attempt')) : null;
  const navigate = useNavigate();
  const { toast } = useToast();

  const [assignment, setAssignment] = useState<AssignmentDto | null>(null);
  const [drafts, setDrafts] = useState<Record<number, AnswerResponse | null>>({});
  const [confirmOpen, setConfirmOpen] = useState(false);

  const at = useAttempt(assignmentId, attemptInUrl, (id) => {
    // 把 attemptId 固定进 URL:刷新后从 /student/attempts/{id} 恢复(断点续答)
    if (sp.get('attempt') !== String(id)) setSp({ attempt: String(id) }, { replace: true });
  });

  useEffect(() => {
    api.get('/student/assignments', { query: { status: 'all' } })
      .then((r) => setAssignment((r.data as AssignmentDto[]).find((a) => a.id === assignmentId) ?? null))
      .catch(() => setAssignment(null));
  }, [assignmentId]);

  const resumedToastShown = useMemo(() => ({ done: false }), [assignmentId]);
  useEffect(() => {
    if (at.phase === 'answering' && at.resumed && !resumedToastShown.done) {
      resumedToastShown.done = true;
      toast(`已从上次中断处继续(已答 ${answeredCount(at.quiz)}/${at.quiz.items.length} 题)`);
    }
  }, [at.phase, at.resumed, at.quiz, resumedToastShown, toast]);

  const redoKind = assignment?.kind === 'correction' || assignment?.kind === 'wrong_redo';
  const title = assignment ? `${assignment.paperName}` : '作业作答';

  // ---------- 头部 ----------
  const head = (
    <div className="mb-5 flex items-end justify-between gap-4">
      <div>
        <h2 className="text-[21px] font-extrabold">{title}</h2>
        <p className="mt-1 text-[13px] text-ink-2">
          {assignment ? `${KIND_LABEL[assignment.kind] ?? assignment.kind} · 共 ${assignment.questionCount} 题 · ${assignment.totalScore} 分` : '课后答题与课堂同款界面'}
          {assignment && !assignment.scoreCounted && ' · 不计分'}
        </p>
      </div>
      <Button className="min-h-touch shrink-0" onClick={() => navigate('/')}>← 返回今日</Button>
    </div>
  );

  if (at.phase === 'loading') {
    return (
      <div className="mx-auto max-w-[1080px]">
        {head}
        <div className="grid grid-cols-[1fr_280px] gap-4">
          <Skeleton className="h-72" />
          <Skeleton className="h-48" />
        </div>
      </div>
    );
  }

  // 加载失败 / 作业不存在
  if (at.phase === 'error' || !at.attempt) {
    return (
      <div className="mx-auto max-w-[1080px]">
        {head}
        <div className="rounded-lg border border-line bg-card p-10 text-center shadow-card">
          <div className="text-[13.5px] text-ink-3">{at.error ?? '作业不存在或已失效'}</div>
          <Button variant="primary" className="min-h-touch mt-4" onClick={() => navigate('/')}>回到今日</Button>
        </div>
      </div>
    );
  }

  // 题面由契约保证(AttemptDto.questions);为空仅作优雅空态,不再走「字段缺失降级」
  if (at.attempt.questions.length === 0) {
    return (
      <div className="mx-auto max-w-[1080px]">
        {head}
        <div className="rounded-lg border border-line bg-card p-10 text-center shadow-card">
          <div className="text-2xl text-ink-3" aria-hidden>📄</div>
          <div className="mt-2 text-[13.5px] text-ink-3">本卷暂无题目</div>
          <Button variant="primary" className="min-h-touch mt-4" onClick={() => navigate('/')}>回到今日</Button>
        </div>
      </div>
    );
  }

  if (at.phase === 'result') {
    return (
      <div className="mx-auto max-w-[860px]">
        {head}
        <ResultView attempt={at.attempt} assignment={assignment} />
        <div className="mt-4 flex justify-end gap-2.5">
          <Button className="min-h-touch" onClick={() => navigate('/wrong-book')}>去错题本</Button>
          <Button variant="primary" className="min-h-touch" onClick={() => navigate('/')}>返回今日</Button>
        </div>
      </div>
    );
  }

  // ---------- 作答中 ----------
  const { quiz } = at;
  const idx = quiz.current;
  const q = at.attempt.questions[idx];
  const item = quiz.items[idx];
  const draft = drafts[q.questionId] ?? null;
  const confirmed = item.response != null;
  const unanswered = quiz.items.length - answeredCount(quiz);

  const onConfirm = async () => {
    if (!draft) return;
    try {
      await at.confirm(q.questionId, draft, item.flagged);
      setDrafts((d) => ({ ...d, [q.questionId]: null }));
    } catch {
      toast('提交失败,请重试');
    }
  };

  const doSubmit = async () => {
    setConfirmOpen(false);
    try {
      await at.submit();
    } catch {
      toast('交卷失败,请重试');
    }
  };

  return (
    <div className="mx-auto max-w-[1080px]">
      {head}
      <div className="grid grid-cols-[1fr_280px] items-start gap-4">
        <div>
          {/* 进度条 */}
          <div className="mb-3.5 flex items-center gap-3.5 rounded-lg border border-line bg-card px-4 py-3 shadow-card">
            <b className="shrink-0 text-[13.5px] tabular-nums">第 {idx + 1} / {quiz.items.length} 题</b>
            <ProgressBar className="flex-1" tone="primary" value={(answeredCount(quiz) / quiz.items.length) * 100} />
            <span className="shrink-0 text-xs text-ink-3">已答 {answeredCount(quiz)} 题 · 不限时</span>
          </div>

          <QuestionPanel q={q} item={item} draft={draft} redoKind={redoKind} onUploadPhoto={uploadAnswerPhoto}
            onDraft={(r) => setDrafts((d) => ({ ...d, [q.questionId]: r }))} />

          {/* 底部操作 */}
          <div className="mt-3.5 flex items-center gap-2.5">
            <Button className={`min-h-touch ${item.flagged ? '!border-orange !text-orange' : ''}`} onClick={() => at.flag(q.questionId)}>
              ⚑ {item.flagged ? '取消标记' : '标记'}
            </Button>
            <Button className="min-h-touch" disabled={idx === 0} onClick={() => at.goTo(idx - 1)}>← 上一题</Button>
            <div className="flex-1" />
            {!confirmed ? (
              <Button variant="primary" className="min-h-touch min-w-[140px]" disabled={!draft} onClick={onConfirm}>
                确认答案
              </Button>
            ) : idx < quiz.items.length - 1 ? (
              <Button variant="primary" className="min-h-touch min-w-[140px]" onClick={at.next}>下一题 →</Button>
            ) : (
              <Button variant="primary" className="min-h-touch min-w-[140px]" disabled={at.submitting}
                onClick={() => (allAnswered(quiz) ? doSubmit() : setConfirmOpen(true))}>
                交卷
              </Button>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <AnswerCard quiz={quiz} onGoto={at.goTo} />
          <Button variant={allAnswered(quiz) ? 'primary' : 'secondary'} block className="min-h-touch" disabled={at.submitting}
            onClick={() => (allAnswered(quiz) ? doSubmit() : setConfirmOpen(true))}>
            {at.submitting ? '交卷中…' : '交卷'}
          </Button>
          {redoKind && (
            <div className="rounded-lg border border-line bg-card p-4 text-xs leading-6 text-ink-2 shadow-card">
              <b className="mb-1 block text-[13px] text-ink">来源说明</b>
              订正与重练的成绩<b>不计入作业分</b>,但会更新你的知识点掌握度与错题状态。同一道错题<b>重做对 2 次</b>自动移出错题本。
            </div>
          )}
        </div>
      </div>

      <Modal open={confirmOpen} title="确认交卷?" onClose={() => setConfirmOpen(false)}
        footer={
          <>
            <Button className="min-h-touch" onClick={() => setConfirmOpen(false)}>继续作答</Button>
            <Button variant="primary" className="min-h-touch" onClick={doSubmit}>仍要交卷</Button>
          </>
        }>
        <p className="text-sm leading-7 text-ink-2">还有 <b className="text-orange">{unanswered}</b> 道题未作答,交卷后将不能再修改。</p>
      </Modal>
    </div>
  );
}
