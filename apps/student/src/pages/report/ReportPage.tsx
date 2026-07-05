/**
 * 我的学习报告(原型 s-report 段,按 MVP 裁剪:无雷达图)
 * 周数据四卡 + 知识点掌握度条形(绿≥80 / 主色 60–79 / 红<60,ProgressBar auto 规则)
 */
import { useEffect, useState } from 'react';
import type { MasteryItemDto } from '@qiming/contracts';
import { Button, Card, EmptyState, ProgressBar, Skeleton, StatCard } from '@qiming/ui';
import { api } from '../../api';
import { formatCorrectRate } from '../../lib/format';

interface ReportData {
  mastery: MasteryItemDto[];
  weekStats: { answeredCount: number; correctRate: number | null; studySec: number; wrongOpenCount: number };
}

export function ReportPage() {
  const [data, setData] = useState<ReportData | null>(null);
  const [error, setError] = useState(false); // 加载失败别停在骨架(可重试)
  const [reload, setReload] = useState(0);

  useEffect(() => {
    setData(null); setError(false);
    api.get('/student/report')
      .then((r) => setData(r.data as ReportData))
      .catch(() => setError(true));
  }, [reload]);

  if (error) {
    return (
      <div className="mx-auto max-w-[1080px]">
        <Card>
          <EmptyState icon="⚠" text="报告加载失败" hint="可能是网络波动,请重试"
            action={<Button variant="primary" className="min-h-touch" onClick={() => setReload((n) => n + 1)}>重新加载</Button>} />
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1080px]">
      <div className="mb-5">
        <h2 className="text-[21px] font-extrabold">我的学习报告</h2>
        <p className="mt-1 text-[13px] text-ink-2">数据范围:近 30 天 · 掌握度按知识点正确率加权计算</p>
      </div>

      <div className="mb-5 grid grid-cols-4 gap-4">
        <StatCard ribbon="primary" label="本周答题" value={data?.weekStats.answeredCount ?? '—'} />
        <StatCard ribbon="green" label="本周正确率" value={data ? formatCorrectRate(data.weekStats.correctRate) : '—'} />
        <StatCard ribbon="violet" label="学习时长" value={data ? `${Math.round(data.weekStats.studySec / 360) / 10} h` : '—'} />
        <StatCard ribbon="orange" label="待消灭错题" value={data?.weekStats.wrongOpenCount ?? '—'} />
      </div>

      <Card title="知识点掌握度" extra={data && data.mastery.length > 0 ? `${data.mastery.length} 个知识点` : undefined}>
        {!data ? (
          <Skeleton className="h-6" lines={5} />
        ) : data.mastery.length === 0 ? (
          <EmptyState text="完成更多练习后这里会生成掌握度报告" hint="先去完成今日任务吧" />
        ) : (
          <div className="flex flex-col gap-3.5">
            {[...data.mastery].sort((a, b) => a.mastery - b.mastery).map((m) => (
              <div key={m.nodeId} className="flex items-center gap-3.5">
                <div className="w-44 shrink-0 truncate text-[13px]">{m.nodeName}</div>
                <ProgressBar className="flex-1" value={m.mastery} />
                <div className="w-14 shrink-0 text-right text-[13px] font-bold tabular-nums">{m.mastery}%</div>
                <div className="w-16 shrink-0 text-right text-xs tabular-nums text-ink-3">{m.sampleCount} 题样本</div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
