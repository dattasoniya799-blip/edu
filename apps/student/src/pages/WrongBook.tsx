import { useEffect, useState } from 'react';
import type { WrongBookItemDto } from '@qiming/contracts';
import { Button, Card, EmptyState, Tag, TexText, useToast } from '@qiming/ui';
import { api } from '../api';

export function WrongBook() {
  const [items, setItems] = useState<WrongBookItemDto[] | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    api.get('/student/wrong-book', { query: { page: 1, size: 20 } }).then((r) => setItems(r.data.items));
  }, []);

  return (
    <div className="mx-auto max-w-[1040px]">
      <div className="mb-5 flex items-end justify-between">
        <h2 className="text-[21px] font-extrabold">错题本</h2>
        {!!items?.length && (
          <Button variant="primary" className="min-h-touch" onClick={() => toast('错题重练由 B5 任务交付')}>
            一键重练全部
          </Button>
        )}
      </div>
      {!items ? (
        <Card><div className="h-20 animate-pulse rounded-md bg-bg" /></Card>
      ) : items.length === 0 ? (
        <Card><EmptyState icon="✓" text="太棒了,没有待清错题" /></Card>
      ) : (
        <div className="flex flex-col gap-3">
          {items.map((w) => (
            <Card key={w.id}>
              <div className="mb-2 flex flex-wrap items-center gap-1.5">
                <Tag tone="red">错 {w.wrongCount} 次</Tag>
                {w.errorTags.map((t) => <Tag key={t} tone="orange">{t}</Tag>)}
                <span className="text-xs text-ink-3">来自:{w.sourceName}</span>
              </div>
              <div className="text-sm leading-7"><TexText src={w.stemLatex} /></div>
              {w.analysisLatex && (
                <div className="mt-3 rounded-md bg-bg/60 p-3 text-[13px] leading-6 text-ink-2">
                  <b className="mr-1 text-ink">解析</b>
                  <TexText src={w.analysisLatex} />
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
