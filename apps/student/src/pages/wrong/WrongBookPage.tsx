/**
 * 错题本(原型 s-wrong 段):错因筛选 + 列表/解析折叠 + 重做单题 + 一键重练全部
 * 重做对 2 次自动移出(消灭);已消灭折叠展示
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { AssignmentDto } from '@qiming/contracts';
import { Button, Card, EmptyState, Skeleton, useToast } from '@qiming/ui';
import { api, errorMessage } from '../../api';
import { WrongItemCard } from './WrongItemCard';
import { deriveSubjects, filterBySubject, type WrongBookItemView } from './subjects';

export function WrongBookPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [items, setItems] = useState<WrongBookItemView[] | null>(null);
  const [error, setError] = useState(false); // REV-front #2:加载失败别停在骨架(可重试)
  const [reload, setReload] = useState(0);
  const [subject, setSubject] = useState<string | null>(null); // FIX3 问题5:学科筛选(null=全部)
  const [filter, setFilter] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showCleared, setShowCleared] = useState(false);
  // M4 配套:存在已提交未出分(myAttempt.status='submitted')的作业 → 提示出分后错题自动收进来
  const [pendingGrading, setPendingGrading] = useState(false);

  useEffect(() => {
    // 契约 WrongBookItem 暂无 subject(见 README 契约变更申请 FIX3-1);view 容忍缺失,mock 先行附带
    setItems(null);
    setError(false);
    api.get('/student/wrong-book', { query: { page: 1, size: 50 } })
      .then((r) => setItems(r.data.items as WrongBookItemView[]))
      .catch(() => setError(true));
  }, [reload]);

  useEffect(() => {
    // 复用既有契约接口判定「待出分」,不发明新接口;失败静默(提示属锦上添花)
    api.get('/student/assignments', { query: { status: 'all' } })
      .then((r) => setPendingGrading((r.data as AssignmentDto[]).some((a) => a.myAttempt?.status === 'submitted')))
      .catch(() => setPendingGrading(false));
  }, [reload]);

  const open = useMemo(() => (items ?? []).filter((w) => w.status === 'open'), [items]);
  // 后端只允许客观题重做:全部待消灭均为解答题(主观题)时,「一键重练全部」预禁用
  const allSolution = useMemo(() => open.length > 0 && open.every((w) => w.type === 'solution'), [open]);
  const cleared = useMemo(() => (items ?? []).filter((w) => w.status === 'cleared'), [items]);
  // 学科分组:≥2 学科才显示筛选,单科优雅退化(对照原型单科口径)
  const subjects = useMemo(() => deriveSubjects(open), [open]);
  const bySubject = useMemo(() => filterBySubject(open, subjects.length > 1 ? subject : null), [open, subjects, subject]);
  const tagCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const w of bySubject) for (const t of w.errorTags) m.set(t, (m.get(t) ?? 0) + 1);
    return [...m.entries()];
  }, [bySubject]);
  const visible = filter ? bySubject.filter((w) => w.errorTags.includes(filter)) : bySubject;
  const pickSubject = (s: string | null) => { setSubject(s); setFilter(null); }; // 切学科重置错因筛选

  const go = (a: AssignmentDto) => navigate(`/homework/${a.id}`);

  const redoOne = async (id: number) => {
    setBusy(true);
    try {
      const r = await api.post('/student/wrong-book/{id}/redo', { params: { id } });
      go(r.data as AssignmentDto);
    } catch (e) {
      toast(errorMessage(e, '生成重做卷失败'));
    } finally {
      setBusy(false);
    }
  };

  const redoAll = async () => {
    setBusy(true);
    try {
      const r = await api.post('/student/wrong-book/redo-all');
      go(r.data as AssignmentDto);
    } catch (e) {
      toast(errorMessage(e, '生成重练卷失败'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-[920px]">
      <div className="mb-5 flex items-end justify-between gap-4">
        <div>
          <h2 className="text-[21px] font-extrabold">错题本</h2>
          <p className="mt-1 text-[13px] text-ink-2">
            {error ? '加载失败' : items ? `共 ${open.length} 道待消灭 · 重做对 2 次自动移出错题本` : '加载中…'}
          </p>
        </div>
        {open.length > 0 && (
          <Button variant="primary" className="min-h-touch shrink-0" disabled={busy || allSolution} onClick={redoAll}
            title={allSolution ? '当前待消灭均为主观题,暂不支持重做' : undefined}>
            一键重练全部
          </Button>
        )}
      </div>

      {error ? (
        <Card>
          <EmptyState icon="⚠" text="错题本加载失败" hint="可能是网络波动,请重试"
            action={<Button variant="primary" className="min-h-touch" onClick={() => setReload((n) => n + 1)}>重新加载</Button>} />
        </Card>
      ) : !items ? (
        <Skeleton className="h-32" lines={3} />
      ) : open.length === 0 ? (
        <Card>
          <EmptyState icon="✓" text="太棒了,没有待消灭的错题"
            hint={pendingGrading
              ? '有作业待老师出分,出分后错题会自动收进来'
              : cleared.length > 0 ? `已累计消灭 ${cleared.length} 道错题` : '答错的题会自动收进来,重做对 2 次自动移出'} />
        </Card>
      ) : (
        <>
          {pendingGrading && (
            <div role="status" className="mb-4 rounded-lg border border-line bg-primary-soft px-4 py-3 text-[13px] text-ink-2">
              有作业待老师出分,出分后错题会自动收进来
            </div>
          )}
          {/* 学科筛选(FIX3 问题5):≥2 学科才显示,单科退化隐藏 */}
          {subjects.length > 1 && (
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span className="text-xs text-ink-3">学科</span>
              <FilterChip active={subject == null} label={`全部 (${open.length})`} onClick={() => pickSubject(null)} />
              {subjects.map((s) => (
                <FilterChip
                  key={s}
                  active={subject === s}
                  label={`${s} (${open.filter((w) => (w.subject ?? '') === s).length})`}
                  onClick={() => pickSubject(subject === s ? null : s)}
                />
              ))}
            </div>
          )}
          <div className="mb-4 flex flex-wrap gap-2">
            <FilterChip active={filter == null} label={`全部 (${bySubject.length})`} onClick={() => setFilter(null)} />
            {tagCounts.map(([t, n]) => (
              <FilterChip key={t} active={filter === t} label={`${t} (${n})`} onClick={() => setFilter(filter === t ? null : t)} />
            ))}
          </div>
          <div className="flex flex-col gap-3.5">
            {visible.length === 0 ? (
              <Card><EmptyState text="该错因下没有待消灭错题" /></Card>
            ) : (
              visible.map((w) => (
                <WrongItemCard key={w.id} item={w} subjectLabel={subjects.length > 1 ? w.subject : undefined} onRedo={redoOne} redoing={busy} />
              ))
            )}
          </div>
        </>
      )}

      {items && cleared.length > 0 && (
        <div className="mt-5">
          <Button className="min-h-touch" aria-expanded={showCleared} onClick={() => setShowCleared((v) => !v)}>
            {showCleared ? '收起' : '查看'}已消灭错题({cleared.length})
          </Button>
          {showCleared && (
            <div className="mt-3.5 flex flex-col gap-3.5">
              {cleared.map((w) => <WrongItemCard key={w.id} item={w} onRedo={() => undefined} />)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function FilterChip({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active}
      className={`min-h-touch rounded-pill border-[1.5px] px-4 text-[13px] font-semibold transition-all ${
        active ? 'border-primary bg-primary text-card shadow-btn-sm' : 'border-line bg-card text-ink-2 hover:border-ink-3'
      }`}>
      {label}
    </button>
  );
}
