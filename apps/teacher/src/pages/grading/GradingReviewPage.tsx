/**
 * 解答题复核(原型 v0.4 id=t-grade)
 * 名单经真实端点 GET /grading/assignments/{id}/answers(GradingAnswerBriefDto[])驱动学生切换条;
 * 点一项 → GET /grading/answers/{answerId} 看详情复核;review 后该项 pending→graded 刷新;支持只看 pending。
 * 流程:学生切换条 → 作答原稿(照片/文字)→ 解答题人工判分 / 公式填空看 AI 预批 → 改分+评语 → 确认下一份 → 出分
 * 判分口径:解答题(拍照手写,photoUrl 有)由老师人工判分、隐藏 AI 预批卡,评语引导写"哪些知识点掌握不好";
 *          公式填空(文字 LaTeX)仍走 AI 预批,保留预批卡供老师参考。
 */
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { GradingAnswerBriefDto, GradingItemDto } from '@qiming/contracts';
import { Button, Card, EmptyState, Skeleton, Tag, TexText, useToast } from '@qiming/ui';
import { api } from '../../api';
import { PageHead } from '../Shell';
import { bizError, pendingAnswerIds } from '../lesson/lib/segments';

const fullScore = (g: GradingItemDto) => g.rubric.reduce((s, r) => s + r.score, 0);

export function GradingReviewPage() {
  const { assignmentId: idParam } = useParams();
  const assignmentId = Number(idParam);
  const navigate = useNavigate();
  const { toast } = useToast();

  const [paperName, setPaperName] = useState('');
  const [briefs, setBriefs] = useState<GradingAnswerBriefDto[]>([]);
  const [currentId, setCurrentId] = useState<number | null>(null);
  const [detail, setDetail] = useState<GradingItemDto | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [pendingOnly, setPendingOnly] = useState(false);
  const [score, setScore] = useState('');
  const [comment, setComment] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  /** 名单:GET /grading/assignments/{id}/answers(替换原 source.ts 适配层枚举) */
  const loadBriefs = async () => {
    const r = await api.get('/grading/assignments/{id}/answers', { params: { id: assignmentId } });
    return r.data as GradingAnswerBriefDto[];
  };

  const init = async () => {
    const [pending, list] = await Promise.all([
      api.get('/grading/pending').catch(() => null),
      loadBriefs(),
    ]);
    if (pending) {
      const g = (pending.data as { assignmentId: number; paperName: string }[]).find((x) => x.assignmentId === assignmentId);
      if (g) setPaperName(g.paperName);
    }
    setBriefs(list);
    const first = list.find((x) => x.status === 'pending') ?? list[0];
    setCurrentId(first ? first.answerId : null);
  };

  useEffect(() => {
    setLoading(true);
    init().finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignmentId]);

  // 选中项 → GET /grading/answers/{answerId} 拉详情(原稿 + AI 预批 + rubric)
  useEffect(() => {
    if (currentId == null) { setDetail(null); return; }
    let alive = true;
    setDetailLoading(true);
    api.get('/grading/answers/{id}', { params: { id: currentId } })
      .then((r) => { if (alive) setDetail(r.data as GradingItemDto); })
      .catch(() => { if (alive) setDetail(null); })
      .finally(() => { if (alive) setDetailLoading(false); });
    return () => { alive = false; };
  }, [currentId]);

  // 详情就绪 → 回填得分/评语:已复核回填 finalScore;
  // 解答题(人工判分)留空由老师填,公式填空回填 AI 建议分作参考
  useEffect(() => {
    if (!detail) return;
    if (detail.finalScore != null) setScore(String(detail.finalScore));
    else setScore(detail.photoUrl != null ? '' : String(detail.aiScore ?? 0));
    setComment(detail.comment ?? '');
  }, [detail]);

  const pendingCount = briefs.filter((b) => b.status === 'pending').length;
  // 「只看 pending」客户端过滤(端点亦支持 ?status=pending);保留全量以维持准确计数
  const visible = pendingOnly ? briefs.filter((b) => b.status === 'pending') : briefs;
  const full = detail ? fullScore(detail) : 10;
  // 解答题 = 拍照/手写(photoUrl 有)→ 人工判分、隐藏 AI 预批卡;公式填空 = 文字作答 → 保留 AI 预批
  const isSolution = detail?.photoUrl != null;

  const confirmAndNext = async () => {
    if (!detail) return;
    if (score.trim() === '') { toast('请先填写得分'); return; }
    const value = Number(score);
    if (!Number.isFinite(value) || value < 0 || value > full) {
      toast(`得分需在 0–${full} 之间`);
      return;
    }
    setBusy(true);
    try {
      await api.put('/grading/answers/{id}/review', {
        params: { id: detail.answerId },
        body: { finalScore: value, ...(comment.trim() ? { comment: comment.trim() } : {}) },
      });
      // 复核后用端点重新拉名单:该项 pending→graded(与服务端口径一致)
      const list = await loadBriefs();
      setBriefs(list);
      const nextPending = list.find((b) => b.status === 'pending');
      if (nextPending && nextPending.answerId !== detail.answerId) {
        setCurrentId(nextPending.answerId);
        toast(`已确认 ${detail.studentName} 得分 ${value}/${full},切换到下一份:${nextPending.studentName}`);
      } else {
        // 无下一份:就地把当前详情刷新为已复核
        setDetail({ ...detail, finalScore: value, comment: comment.trim() || null });
        toast(nextPending ? `已确认 ${detail.studentName} 得分 ${value}/${full}` : '全部复核完成,可以出分');
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : '提交失败');
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
        // 4501 detail 为对象 {pendingAnswerIds}(亦兼容裸数组);取 ids 计数(C3 #P2)
        const ids = pendingAnswerIds(biz.detail);
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
  if (briefs.length === 0) {
    return (
      <div>
        <PageHead title="解答题复核" />
        <div className="rounded-lg border border-line bg-card shadow-card">
          <EmptyState icon="✓" text="该作业没有待复核的主观题" action={<Button onClick={() => navigate('/grading')}>返回批改列表</Button>} />
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHead
        title={(
          <span>
            <Link className="text-[15px] font-semibold text-primary hover:underline" to="/grading">← 批改</Link>
            <span className="text-ink-3"> / </span>{paperName || '课后作业'} · 主观题复核
          </span>
        )}
        sub={`客观题已自动批改完成 · ${briefs.length} 份待判分:解答题人工判分、公式填空 AI 预批参考,逐份处理后出分(剩余 ${pendingCount} 份)`}
        actions={(
          <Button variant="primary" onClick={finalize} disabled={busy}>完成复核,出分</Button>
        )}
      />

      {/* 名单工具条:只看 pending 切换 */}
      <div className="mb-2.5 flex items-center gap-3 text-[12.5px] text-ink-2">
        <label className="flex cursor-pointer items-center gap-1.5">
          <input type="checkbox" checked={pendingOnly} onChange={(e) => setPendingOnly(e.target.checked)} aria-label="只看待复核" />
          只看待复核
        </label>
        <span className="tabular-nums">共 {briefs.length} 份 · 待复核 {pendingCount} 份</span>
      </div>

      {/* 学生切换条(GradingAnswerBriefDto 驱动) */}
      <div className="mb-4 flex flex-wrap gap-2">
        {visible.length === 0 ? (
          <span className="text-[13px] text-ink-3">已全部复核 ✓(已隐藏已复核,取消「只看待复核」可查看)</span>
        ) : visible.map((b) => {
          const reviewed = b.status === 'graded';
          const active = b.answerId === currentId;
          return (
            <button
              key={b.answerId}
              type="button"
              onClick={() => setCurrentId(b.answerId)}
              className={`rounded-pill border-[1.5px] px-3.5 py-1.5 text-[13px] font-semibold tabular-nums transition-colors ${
                active
                  ? 'border-primary bg-primary text-card'
                  : reviewed
                    ? 'border-green bg-green-soft text-green'
                    : 'border-line bg-card text-ink-2 hover:border-ink-3'
              }`}
            >
              {reviewed
                ? `✓ ${b.studentName} · ${b.finalScore} 分 已复核`
                : `${b.studentName} · AI 预批 ${b.aiScore ?? '—'}`}
            </button>
          );
        })}
      </div>

      {detailLoading ? (
        <div className="grid items-start gap-4" style={{ gridTemplateColumns: 'minmax(0,1fr) 360px' }}>
          <Skeleton className="h-72 w-full" />
          <Skeleton lines={2} className="h-32 w-full" />
        </div>
      ) : detail ? (
        <div className="grid items-start gap-4" style={{ gridTemplateColumns: 'minmax(0,1fr) 360px' }}>
          {/* 左:原稿(解答题=拍照/手写;公式填空=文字 LaTeX) */}
          <Card title={`${detail.studentName} 的作答 · ${detail.photoUrl ? '手写板原稿' : '文字 / 公式作答'}`}>
            <div className="mb-3 rounded-md border border-line bg-bg px-4 py-3 text-sm leading-[1.9]">
              <TexText src={`${detail.stemLatex}(${full} 分)`} />
            </div>
            {detail.photoUrl ? (
              <img src={detail.photoUrl} alt={`${detail.studentName} 的作答照片`} className="w-full rounded-md border border-line bg-card" />
            ) : detail.textResponse ? (
              <div className="whitespace-pre-wrap rounded-md border border-line px-5 py-4 text-[14.5px] leading-[2.1] text-ink">
                <TexText src={detail.textResponse} />
              </div>
            ) : (
              <EmptyState icon="✎" text="未找到作答原稿" />
            )}
          </Card>

          {/* 右:AI 预批(仅公式填空)+ 教师复核 */}
          <div className="flex flex-col gap-3.5">
            {/* 解答题(拍照手写)由老师人工判分,隐藏 AI 预批卡;公式填空仍走预批,保留供参考 */}
            {!isSolution && (
              <Card title={<span className="inline-flex items-center gap-2">AI 预批 <span className="rounded-[6px] bg-violet-soft px-1.5 py-px text-[11px] font-bold text-violet">AI</span></span>}>
                <div className="flex flex-col gap-2 text-[13px] leading-relaxed">
                  {detail.aiSteps.map((st) => {
                    const rubricStep = detail.rubric.find((r) => r.step === st.step);
                    return (
                      <div key={st.step} className={st.ok ? 'text-green' : 'text-red'}>
                        {st.ok ? '✓' : '✕'} 步骤 {st.step}:{rubricStep?.desc ?? ''}
                        ({st.ok ? rubricStep?.score ?? 0 : 0} / {rubricStep?.score ?? 0} 分)
                        {st.comment && <div className="mt-0.5 pl-4 text-[12.5px] text-ink-2"><TexText src={st.comment} /></div>}
                      </div>
                    );
                  })}
                  <div className="mt-1 border-t border-line pt-2 text-[12.5px] text-ink-2">
                    AI 建议得分 <b className="tabular-nums text-ink">{detail.aiScore ?? '—'} / {full}</b>
                    {detail.aiErrorTags.length > 0 && <> · 错因标签:{detail.aiErrorTags.join('、')}</>}
                  </div>
                </div>
              </Card>
            )}

            <Card title={isSolution ? '人工判分' : '教师复核'}>
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
                {detail.finalScore != null && <Tag tone="green" className="ml-auto">已复核</Tag>}
              </div>
              <label className="mt-3.5 flex flex-col gap-1.5">
                <span className="text-xs font-semibold text-ink-2">点评(将随解析推送给学生)</span>
                <textarea
                  rows={3}
                  className="resize-y rounded-[10px] border-[1.5px] border-line px-3 py-2 text-[13px] leading-relaxed focus:border-primary focus:outline-none"
                  placeholder="点评:该生哪些知识点掌握不好、错在哪一步、下一步怎么补…"
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                />
              </label>
              <Button variant="primary" block className="mt-3.5" onClick={confirmAndNext} disabled={busy}>
                {pendingCount > (detail.finalScore == null ? 1 : 0) ? '确认,下一份 →' : '确认本份'}
              </Button>
            </Card>
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-line bg-card shadow-card">
          <EmptyState icon="✎" text="未能加载该份作答详情" action={<Button onClick={() => currentId != null && setCurrentId(currentId)}>重试</Button>} />
        </div>
      )}
    </div>
  );
}
