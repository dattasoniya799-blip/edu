import { useEffect, useState } from 'react';
import type { QuestionDto } from '@qiming/contracts';
import { Button, Card, EmptyState, Tag, TexText, useToast } from '@qiming/ui';
import { api } from '../api';
import { PageHead } from './Shell';

const TYPE_LABEL = { single: '单选', multi: '多选', blank: '填空', solution: '解答' } as const;

export function Bank() {
  const [items, setItems] = useState<QuestionDto[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  useEffect(() => {
    api.get('/questions', { query: { page: 1, size: 5 } })
      .then((r) => { setItems(r.data.items); setTotal(r.data.total); })
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <PageHead
        title="题库维护"
        sub={`共 ${total} 题 · LaTeX 公式经 <TexText/> 渲染($..$ 行内、$$..$$ 块级、\\ce{} 化学式)`}
        actions={<Button variant="primary" onClick={() => toast('录题编辑器由 B3 任务交付')}>✎ 录入新题</Button>}
      />
      {loading ? (
        <Card><div className="animate-pulse space-y-3">{[0, 1, 2].map((i) => <div key={i} className="h-16 rounded-md bg-bg" />)}</div></Card>
      ) : items.length === 0 ? (
        <Card><EmptyState text="题库还是空的" hint="点击右上角「录入新题」开始建设题库" /></Card>
      ) : (
        <div className="flex flex-col gap-3">
          {items.map((q) => (
            <Card key={q.id}>
              <div className="mb-2 flex flex-wrap items-center gap-1.5">
                <Tag tone="primary">{TYPE_LABEL[q.type]}</Tag>
                <Tag>{'★'.repeat(q.difficulty)}</Tag>
                {q.tags.filter((t) => t.graphType === 'curriculum_knowledge').map((t) => (
                  <Tag key={t.nodeId} tone="violet">{t.name}</Tag>
                ))}
              </div>
              <div className="text-sm leading-7"><TexText src={q.stemLatex} /></div>
              <div className="mt-2 flex gap-4 text-xs text-ink-3">
                <span>正确率 {q.stats.correctRate != null ? `${q.stats.correctRate}%` : '—'}</span>
                <span>组卷 {q.stats.usedInPapers} 次</span>
                <span>录入:{q.ownerName}</span>
              </div>
            </Card>
          ))}
          <div className="py-2 text-center text-xs text-ink-3">B1 仅展示前 5 题验证渲染链路,完整题库页由 B3 任务交付</div>
        </div>
      )}
    </div>
  );
}
