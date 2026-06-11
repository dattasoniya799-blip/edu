import { useEffect, useState } from 'react';
import type { MasteryItemDto } from '@qiming/contracts';
import { Card, EmptyState, ProgressBar, StatCard } from '@qiming/ui';
import { api } from '../api';

type Report = {
  mastery: MasteryItemDto[];
  weekStats: { answeredCount: number; correctRate: number | null; studySec: number; wrongOpenCount: number };
};

export function Report() {
  const [data, setData] = useState<Report | null>(null);

  useEffect(() => {
    api.get('/student/report').then((r) => setData(r.data));
  }, []);

  return (
    <div className="mx-auto max-w-[1040px]">
      <h2 className="mb-5 text-[21px] font-extrabold">学习报告</h2>
      <div className="mb-5 grid grid-cols-2 gap-4 xl:grid-cols-4">
        <StatCard ribbon="primary" label="本周答题" value={data?.weekStats.answeredCount ?? '—'} />
        <StatCard ribbon="green" label="本周正确率" value={data?.weekStats.correctRate != null ? `${data.weekStats.correctRate}%` : '—'} />
        <StatCard ribbon="violet" label="学习时长" value={data ? `${Math.round(data.weekStats.studySec / 360) / 10} h` : '—'} />
        <StatCard ribbon="orange" label="待清错题" value={data?.weekStats.wrongOpenCount ?? '—'} />
      </div>
      <Card title="知识点掌握度">
        {!data ? (
          <div className="h-24 animate-pulse rounded-md bg-bg" />
        ) : data.mastery.length === 0 ? (
          <EmptyState text="完成更多练习后这里会生成掌握度报告" />
        ) : (
          <div className="flex flex-col gap-3.5">
            {data.mastery.map((m) => (
              <div key={m.nodeId} className="flex items-center gap-3.5">
                <div className="w-40 shrink-0 truncate text-[13px]">{m.nodeName}</div>
                <ProgressBar className="flex-1" value={m.mastery} />
                <div className="w-12 shrink-0 text-right text-[13px] font-bold tabular-nums">{m.mastery}%</div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
