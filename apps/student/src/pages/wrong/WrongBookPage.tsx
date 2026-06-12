/**
 * 错题本(原型 s-wrong 段):错因筛选 + 列表/解析折叠 + 重做单题 + 一键重练全部
 * 重做对 2 次自动移出(消灭);已消灭折叠展示
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { AssignmentDto, WrongBookItemDto } from '@qiming/contracts';
import { Button, Card, EmptyState, Skeleton, useToast } from '@qiming/ui';
import { api, errorMessage } from '../../api';
import { WrongItemCard } from './WrongItemCard';

export function WrongBookPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [items, setItems] = useState<WrongBookItemDto[] | null>(null);
  const [filter, setFilter] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showCleared, setShowCleared] = useState(false);

  useEffect(() => {
    api.get('/student/wrong-book', { query: { page: 1, size: 50 } }).then((r) => setItems(r.data.items as WrongBookItemDto[]));
  }, []);

  const open = useMemo(() => (items ?? []).filter((w) => w.status === 'open'), [items]);
  const cleared = useMemo(() => (items ?? []).filter((w) => w.status === 'cleared'), [items]);
  const tagCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const w of open) for (const t of w.errorTags) m.set(t, (m.get(t) ?? 0) + 1);
    return [...m.entries()];
  }, [open]);
  const visible = filter ? open.filter((w) => w.errorTags.includes(filter)) : open;

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
            {items ? `共 ${open.length} 道待消灭 · 重做对 2 次自动移出错题本` : '加载中…'}
          </p>
        </div>
        {open.length > 0 && (
          <Button variant="primary" className="min-h-touch shrink-0" disabled={busy} onClick={redoAll}>
            一键重练全部
          </Button>
        )}
      </div>

      {!items ? (
        <Skeleton className="h-32" lines={3} />
      ) : open.length === 0 ? (
        <Card>
          <EmptyState icon="✓" text="太棒了,没有待消灭的错题"
            hint={cleared.length > 0 ? `已累计消灭 ${cleared.length} 道错题` : '答错的题会自动收进来,重做对 2 次自动移出'} />
        </Card>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap gap-2">
            <FilterChip active={filter == null} label={`全部 (${open.length})`} onClick={() => setFilter(null)} />
            {tagCounts.map(([t, n]) => (
              <FilterChip key={t} active={filter === t} label={`${t} (${n})`} onClick={() => setFilter(filter === t ? null : t)} />
            ))}
          </div>
          <div className="flex flex-col gap-3.5">
            {visible.length === 0 ? (
              <Card><EmptyState text="该错因下没有待消灭错题" /></Card>
            ) : (
              visible.map((w) => <WrongItemCard key={w.id} item={w} onRedo={redoOne} redoing={busy} />)
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
