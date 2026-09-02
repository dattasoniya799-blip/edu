/**
 * 批改复核 · 待复核列表(/grading/pending,按作业聚合)
 * 入口:讲次时间线「作业批改」/ 工作台待复核卡
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Card, EmptyState, Skeleton, Tag } from '@qiming/ui';
import { api, type GetData } from '../../api';
import { PageHead } from '../Shell';

type PendingGroup = GetData<'/grading/pending'>[number];

export function GradingHomePage() {
  const navigate = useNavigate();
  const [groups, setGroups] = useState<PendingGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false); // REV-front #2:加载失败(可重试)区别于空态
  const [reload, setReload] = useState(0);

  useEffect(() => {
    setLoading(true);
    setError(false);
    api.get('/grading/pending')
      .then((r) => setGroups(r.data))
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [reload]);

  return (
    <div>
      {/* [2026-08-31 假功能下线] 文案对齐现状:预批(photo_pregrade)已 off,解答题为教师人工批改 */}
      <PageHead title="作业批改" sub="客观题已自动批改;解答题逐份人工批改后出分" />
      {loading ? (
        <Skeleton lines={2} className="h-20 w-full" />
      ) : error ? (
        <div className="rounded-lg border border-line bg-card shadow-card">
          <EmptyState icon="⚠" text="待复核列表加载失败" hint="可能是网络波动,请重试"
            action={<Button variant="primary" onClick={() => setReload((n) => n + 1)}>重新加载</Button>} />
        </div>
      ) : groups.length === 0 ? (
        <div className="rounded-lg border border-line bg-card shadow-card">
          <EmptyState icon="✓" text="暂无待批改的作业" hint="学生提交解答题后会出现在这里" />
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
                    {/* aiAvgScore 为历史预批数据(预批已下线,新作业无此值) */}
                    {g.aiAvgScore != null && <>预批均分(历史) <span className="tabular-nums">{g.aiAvgScore}</span> · </>}
                    {g.pendingCount > 0 ? '建议优先批改低分卷' : '全部已批改,可出分'}
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
