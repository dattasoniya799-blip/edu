/**
 * 批改复核 · 待复核列表(/grading/pending,按作业聚合)
 * 入口:讲次时间线「作业批改」/ 工作台待复核卡
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Card, EmptyState, Skeleton, Tag } from '@qiming/ui';
import { api } from '../../api';
import { PageHead } from '../Shell';

interface PendingGroup {
  assignmentId: number;
  paperName: string;
  pendingCount: number;
  aiAvgScore: number | null;
}

export function GradingHomePage() {
  const navigate = useNavigate();
  const [groups, setGroups] = useState<PendingGroup[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/grading/pending')
      .then((r) => setGroups(r.data as PendingGroup[]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <PageHead title="作业批改" sub="客观题已自动批改;解答题经 AI 预批,逐份复核后出分" />
      {loading ? (
        <Skeleton lines={2} className="h-20 w-full" />
      ) : groups.length === 0 ? (
        <div className="rounded-lg border border-line bg-card shadow-card">
          <EmptyState icon="✓" text="暂无待复核的作业" hint="学生提交解答题后,AI 预批结果会出现在这里" />
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {groups.map((g) => (
            <Card key={g.assignmentId}>
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-md bg-violet-soft text-[16px] text-violet">✓</div>
                <div className="min-w-0 flex-1">
                  <b className="text-sm">{g.paperName}</b>
                  <div className="mt-0.5 text-[12.5px] text-ink-2">
                    AI 预批均分 <span className="tabular-nums">{g.aiAvgScore ?? '—'}</span>
                    {g.pendingCount > 0 ? ' · 建议优先抽查低分卷' : ' · 全部已复核,可出分'}
                  </div>
                </div>
                {g.pendingCount > 0
                  ? <Tag tone="orange">{g.pendingCount} 份待复核</Tag>
                  : <Tag tone="green">已复核 ✓</Tag>}
                <Button variant="primary" onClick={() => navigate(`/grading/${g.assignmentId}`)}>去复核</Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
