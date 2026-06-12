/**
 * 解答题复核(原型 v0.4 id=t-grade)
 * 学生切换条 → 作答原稿(照片/文字)→ AI 逐步预批 → 改分+评语 → 确认下一份;全部采纳 AI 分;出分
 * 名单枚举经 source.ts 适配层(契约缺口说明见该文件)
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { GradingItemDto } from '@qiming/contracts';
import { Button, Card, EmptyState, Skeleton, Tag, TexText, useToast } from '@qiming/ui';
import { api } from '../../api';
import { PageHead } from '../Shell';
import { bizError } from '../lesson/lib/segments';
import { listGradingItems } from './source';

const fullScore = (g: GradingItemDto) => g.rubric.reduce((s, r) => s + r.score, 0);

export function GradingReviewPage() {
  const { assignmentId: idParam } = useParams();
  const assignmentId = Number(idParam);
  const navigate = useNavigate();
  const { toast } = useToast();

  const [paperName, setPaperName] = useState('');
  const [items, setItems] = useState<GradingItemDto[]>([]);
  const [currentId, setCurrentId] = useState<number | null>(null);
  const [score, setScore] = useState('');
  const [comment, setComment] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = async (selectFirstPending: boolean) => {
    const [pending, list] = await Promise.all([
      api.get('/grading/pending').catch(() => null),
      listGradingItems(assignmentId),
    ]);
    if (pending) {
      const g = (pending.data as { assignmentId: number; paperName: string }[]).find((x) => x.assignmentId === assignmentId);
      if (g) setPaperName(g.paperName);
    }
    setItems(list);
    if (selectFirstPending) {
      const first = list.find((x) => x.finalScore == null) ?? list[0];
      setCurrentId(first ? first.answerId : null);
    }
    return list;
  };

  useEffect(() => {
    setLoading(true);
    load(true).finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignmentId]);

  const current = useMemo(() => items.find((x) => x.answerId === currentId) ?? null, [items, currentId]);
  const pendingCount = items.filter((x) => x.finalScore == null).length;

  // 切换学生 / 复核状态变化(如全部采纳):回填该份的 finalScore(已复核)或 AI 建议分
  useEffect(() => {
    if (!current) return;
    setScore(String(current.finalScore ?? current.aiScore ?? 0));
    setComment(current.comment ?? '');
  }, [currentId, current?.finalScore]); // eslint-disable-line react-hooks/exhaustive-deps

  const confirmAndNext = async () => {
    if (!current) return;
    const full = fullScore(current);
    const value = Number(score);
    if (!Number.isFinite(value) || value < 0 || value > full) {
      toast(`得分需在 0–${full} 之间`);
      return;
    }
    setBusy(true);
    try {
      await api.put('/grading/answers/{id}/review', {
        params: { id: current.answerId },
        body: { finalScore: value, ...(comment.trim() ? { comment: comment.trim() } : {}) },
      });
      // 本地状态同步:已复核标记 + pending 数下降
      const next = items.map((x) => (x.answerId === current.answerId ? { ...x, finalScore: value, comment: comment.trim() || null } : x));
      setItems(next);
      const nextPending = next.find((x) => x.finalScore == null);
      if (nextPending) {
        setCurrentId(nextPending.answerId);
        toast(`已确认 ${current.studentName} 得分 ${value}/${full},切换到下一份:${nextPending.studentName}`);
      } else {
        toast('全部复核完成,可以出分');
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : '提交失败');
    } finally {
      setBusy(false);
    }
  };

  const adoptAll = async () => {
    setBusy(true);
    try {
      await api.post('/grading/assignments/{id}/adopt-ai', { params: { id: assignmentId } });
      await load(false);
      toast('已采纳全部 AI 预批分数,确认无误后可出分');
    } catch (e) {
      toast(e instanceof Error ? e.message : '操作失败');
    } finally {
      setBusy(false);
    }
  };

  const finalize = async () => {
    setBusy(true);
    try {
      await api.post('/grading/assignments/{id}/finalize', { params: { id: assignmentId } });
      toast('成绩单已生成,成绩与评语对学生可见');
      navigate('/grading');
    } catch (e) {
      const biz = bizError(e);
      if (biz?.code === 4501) {
        const ids = Array.isArray(biz.detail) ? biz.detail : [];
        toast(`仍有 ${ids.length || pendingCount} 份未复核,复核完成后才能出分`);
      } else {
        toast(e instanceof Error ? e.message : '出分失败');
      }
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div>
        <Skeleton className="mb-5 h-9 w-2/3" />
        <Skeleton className="mb-3.5 h-10 w-full" />
        <div className="grid gap-4" style={{ gridTemplateColumns: 'minmax(0,1fr) 360px' }}>
          <Skeleton className="h-72 w-full" />
          <Skeleton lines={2} className="h-32 w-full" />
        </div>
      </div>
    );
  }
  if (items.length === 0) {
    return (
      <div>
        <PageHead title="解答题复核" />
        <div className="rounded-lg border border-line bg-card shadow-card">
          <EmptyState icon="✓" text="该作业没有待复核的解答题" action={<Button onClick={() => navigate('/grading')}>返回批改列表</Button>} />
        </div>
      </div>
    );
  }

  const full = current ? fullScore(current) : 10;

  return (
    <div>
      <PageHead
        title={(
          <span>
            <Link className="text-[15px] font-semibold text-primary hover:underline" to="/grading">← 批改</Link>
            <span className="text-ink-3"> / </span>{paperName || '课后作业'} · 解答题复核
          </span>
        )}
        sub={`客观题已自动批改完成 · ${items.length} 份解答题 AI 已预批,逐份复核后出分(剩余 ${pendingCount} 份)`}
        actions={(
          <>
            <Button onClick={adoptAll} disabled={busy || pendingCount === 0}>全部采纳 AI 分</Button>
            <Button variant="primary" onClick={finalize} disabled={busy}>完成复核,出分</Button>
          </>
        )}
      />

      {/* 学生切换条 */}
      <div className="mb-4 flex flex-wrap gap-2">
        {items.map((g) => {
          const reviewed = g.finalScore != null;
          const active = g.answerId === currentId;
          return (
            <button
              key={g.answerId}
              type="button"
              onClick={() => setCurrentId(g.answerId)}
              className={`rounded-pill border-[1.5px] px-3.5 py-1.5 text-[13px] font-semibold tabular-nums transition-colors ${
                active
                  ? 'border-primary bg-primary text-card'
                  : reviewed
                    ? 'border-green bg-green-soft text-green'
                    : 'border-line bg-card text-ink-2 hover:border-ink-3'
              }`}
            >
              {reviewed
                ? `✓ ${g.studentName} · ${g.finalScore}/${fullScore(g)} 已复核`
                : `${g.studentName} · AI 预批 ${g.aiScore ?? '—'}/${fullScore(g)}`}
            </button>
          );
        })}
      </div>

      {current && (
        <div className="grid items-start gap-4" style={{ gridTemplateColumns: 'minmax(0,1fr) 360px' }}>
          {/* 左:原稿 */}
          <Card title={`${current.studentName} 的作答 · 手写板原稿`}>
            <div className="mb-3 rounded-md border border-line bg-bg px-4 py-3 text-sm leading-[1.9]">
              <TexText src={`${current.stemLatex}(${full} 分)`} />
            </div>
            {current.photoUrl ? (
              <img src={current.photoUrl} alt={`${current.studentName} 的作答照片`} className="w-full rounded-md border border-line bg-card" />
            ) : current.textResponse ? (
              <div className="whitespace-pre-wrap rounded-md border border-line px-5 py-4 text-[14.5px] italic leading-[2.1] text-ink">
                {current.textResponse}
              </div>
            ) : (
              <EmptyState icon="✎" text="未找到作答原稿" />
            )}
          </Card>

          {/* 右:AI 预批 + 教师复核 */}
          <div className="flex flex-col gap-3.5">
            <Card title={<span className="inline-flex items-center gap-2">AI 预批 <span className="rounded-[6px] bg-violet-soft px-1.5 py-px text-[11px] font-bold text-violet">AI</span></span>}>
              <div className="flex flex-col gap-2 text-[13px] leading-relaxed">
                {current.aiSteps.map((st) => {
                  const rubricStep = current.rubric.find((r) => r.step === st.step);
                  return (
                    <div key={st.step} className={st.ok ? 'text-green' : 'text-red'}>
                      {st.ok ? '✓' : '✕'} 步骤 {st.step}:{rubricStep?.desc ?? ''}
                      ({st.ok ? rubricStep?.score ?? 0 : 0} / {rubricStep?.score ?? 0} 分)
                      {st.comment && <div className="mt-0.5 pl-4 text-[12.5px] text-ink-2"><TexText src={st.comment} /></div>}
                    </div>
                  );
                })}
                <div className="mt-1 border-t border-line pt-2 text-[12.5px] text-ink-2">
                  AI 建议得分 <b className="tabular-nums text-ink">{current.aiScore ?? '—'} / {full}</b>
                  {current.aiErrorTags.length > 0 && <> · 错因标签:{current.aiErrorTags.join('、')}</>}
                </div>
              </div>
            </Card>

            <Card title="教师复核">
              <div className="flex items-center gap-2.5">
                <span className="text-[13px] font-semibold">最终得分</span>
                <input
                  type="number" min={0} max={full}
                  className="w-20 rounded-[10px] border-[1.5px] border-line px-3 py-2 text-center text-[15px] font-bold tabular-nums focus:border-primary focus:outline-none"
                  value={score}
                  onChange={(e) => setScore(e.target.value)}
                  aria-label="最终得分"
                />
                <span className="text-[13px] text-ink-3">/ {full}</span>
                {current.finalScore != null && <Tag tone="green" className="ml-auto">已复核</Tag>}
              </div>
              <label className="mt-3.5 flex flex-col gap-1.5">
                <span className="text-xs font-semibold text-ink-2">评语(将随解析推送给学生)</span>
                <textarea
                  rows={3}
                  className="resize-y rounded-[10px] border-[1.5px] border-line px-3 py-2 text-[13px] leading-relaxed focus:border-primary focus:outline-none"
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                />
              </label>
              <Button variant="primary" block className="mt-3.5" onClick={confirmAndNext} disabled={busy}>
                {pendingCount > (current.finalScore == null ? 1 : 0) ? '确认,下一份 →' : '确认本份'}
              </Button>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
