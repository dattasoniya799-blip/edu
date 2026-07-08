/**
 * 作业(历史页,[2026-07-06 批准]):GET /student/assignments?status=all
 * 分「待完成 / 已完成」两组。待完成 → 进答题器;已完成 → 携 ?attempt= 直接打开成绩单
 * (题目 · 我的答案 · 解析 · 老师点评)。加载/失败/空态按 WrongBookPage 口径。
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { AssignmentDto } from '@qiming/contracts';
import { Button, Card, EmptyState, Skeleton, Tag } from '@qiming/ui';
import { api } from '../../api';

const KIND_LABEL: Record<string, string> = {
  homework: '课后作业', in_class: '随堂练', correction: '订正', wrong_redo: '错题重做', consolidation: '巩固练',
};

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('zh-CN', { year: 'numeric', month: 'numeric', day: 'numeric' }) : '';

const isDone = (a: AssignmentDto) =>
  a.myAttempt != null && (a.myAttempt.status === 'submitted' || a.myAttempt.status === 'graded');

export function HomeworkListPage() {
  const navigate = useNavigate();
  const [items, setItems] = useState<AssignmentDto[] | null>(null);
  const [error, setError] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    setItems(null);
    setError(false);
    api.get('/student/assignments', { query: { status: 'all' } })
      .then((r) => setItems(r.data as AssignmentDto[]))
      .catch(() => setError(true));
  }, [reload]);

  // 已完成 = 本人已交/已判的 attempt;待完成 = 其余(排除随堂练:老师课堂发起,不入学生自助待办)
  const done = useMemo(() => (items ?? []).filter(isDone), [items]);
  const pending = useMemo(
    () => (items ?? []).filter((a) => !isDone(a) && a.kind !== 'in_class'),
    [items],
  );

  const openDone = (a: AssignmentDto) =>
    navigate(`/homework/${a.id}?attempt=${a.myAttempt!.attemptId}`);
  const openPending = (a: AssignmentDto) => navigate(`/homework/${a.id}`);

  return (
    <div className="mx-auto max-w-[920px]">
      <div className="mb-5">
        <h2 className="text-[21px] font-extrabold">作业</h2>
        <p className="mt-1 text-[13px] text-ink-2">
          {error ? '加载失败' : items ? `待完成 ${pending.length} · 已完成 ${done.length},已完成作业可回看题目、我的答案与解析` : '加载中…'}
        </p>
      </div>

      {error ? (
        <Card>
          <EmptyState icon="⚠" text="作业加载失败" hint="可能是网络波动,请重试"
            action={<Button variant="primary" className="min-h-touch" onClick={() => setReload((n) => n + 1)}>重新加载</Button>} />
        </Card>
      ) : !items ? (
        <Skeleton className="h-32" lines={3} />
      ) : pending.length === 0 && done.length === 0 ? (
        <Card><EmptyState icon="✓" text="还没有作业" hint="老师布置作业后,会出现在这里" /></Card>
      ) : (
        <div className="flex flex-col gap-6">
          <section>
            <h3 className="mb-2.5 flex items-center gap-2 text-sm font-bold text-ink">
              待完成 <span className="text-xs font-semibold text-ink-3">{pending.length}</span>
            </h3>
            {pending.length === 0 ? (
              <Card><EmptyState icon="✓" text="没有待完成的作业" hint="都做完啦" /></Card>
            ) : (
              <div className="flex flex-col gap-3">
                {pending.map((a) => (
                  <HomeworkRow key={a.id} a={a} done={false} onClick={() => openPending(a)} />
                ))}
              </div>
            )}
          </section>

          <section>
            <h3 className="mb-2.5 flex items-center gap-2 text-sm font-bold text-ink">
              已完成 <span className="text-xs font-semibold text-ink-3">{done.length}</span>
            </h3>
            {done.length === 0 ? (
              <Card><EmptyState text="还没有已完成的作业" hint="完成作业后可在这里回看成绩单" /></Card>
            ) : (
              <div className="flex flex-col gap-3">
                {done.map((a) => (
                  <HomeworkRow key={a.id} a={a} done onClick={() => openDone(a)} />
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

function HomeworkRow({ a, done, onClick }: { a: AssignmentDto; done: boolean; onClick: () => void }) {
  const graded = a.myAttempt?.status === 'graded' && a.myAttempt.score != null;
  return (
    <button
      type="button"
      onClick={onClick}
      className="min-h-touch flex items-center gap-3 rounded-lg border border-line bg-card p-4 text-left shadow-card transition-all hover:border-primary"
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <b className="truncate text-sm">{a.paperName}</b>
          <Tag tone={done ? 'green' : 'primary'}>{KIND_LABEL[a.kind] ?? a.kind}</Tag>
          {!a.scoreCounted && <Tag tone="gray">不计分</Tag>}
        </div>
        <div className="mt-1 text-xs text-ink-2">
          共 {a.questionCount} 题 · {a.totalScore} 分{fmtDate(a.publishAt) && ` · ${fmtDate(a.publishAt)}`}
        </div>
      </div>
      <div className="shrink-0 text-right">
        {done ? (
          graded ? (
            <div className="text-lg font-extrabold tabular-nums text-green">{a.myAttempt!.score}<span className="ml-0.5 text-xs font-semibold text-ink-3">分</span></div>
          ) : (
            <div className="text-[13px] font-semibold text-orange">已提交,待老师出分</div>
          )
        ) : (
          <div className="text-[13px] font-semibold text-primary">去完成 ›</div>
        )}
      </div>
    </button>
  );
}
