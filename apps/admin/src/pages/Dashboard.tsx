import { useEffect, useState } from 'react';
import { Card, EmptyState, StatCard } from '@qiming/ui';
import { api } from '../api';
import { useAuth } from '../auth/AuthProvider';
import { PageHead } from './Shell';

type Dash = {
  teacherCount: number; studentCount: number; weekAttendanceRate: number | null;
  monthAiCost: number; todayLessonCount: number;
  recentEvents: { text: string; time: string }[];
};

export function Dashboard() {
  const { me } = useAuth();
  const [data, setData] = useState<Dash | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    api.get('/admin/dashboard').then((r) => setData(r.data)).catch(() => setFailed(true));
  }, []);

  return (
    <div>
      <PageHead title={`你好,${me?.name ?? ''}`} sub={data ? `今天共安排 ${data.todayLessonCount} 个课次` : '正在加载…'} />
      {failed ? (
        <Card><EmptyState text="数据加载失败" hint="请检查后端或 mock 是否就绪" /></Card>
      ) : (
        <>
          <div className="mb-5 grid grid-cols-2 gap-4 xl:grid-cols-4">
            <StatCard ribbon="primary" label="在职教师" value={data?.teacherCount ?? '—'} />
            <StatCard ribbon="violet" label="在读学生" value={data?.studentCount ?? '—'} />
            <StatCard ribbon="green" label="本周到课率" value={data?.weekAttendanceRate != null ? `${data.weekAttendanceRate}%` : '—'} />
            <StatCard ribbon="orange" label="本月 AI 开销" value={data ? `¥${data.monthAiCost.toLocaleString()}` : '—'} />
          </div>
          <Card title="最近动态">
            {data?.recentEvents.length ? (
              <div className="flex flex-col gap-3">
                {data.recentEvents.map((e) => (
                  <div key={e.text} className="flex items-start gap-3 text-sm">
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[9px] bg-primary-soft text-primary">▦</div>
                    <div>
                      {e.text}
                      <div className="text-xs text-ink-3">{new Date(e.time).toLocaleString('zh-CN')}</div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState text="暂无动态" />
            )}
          </Card>
        </>
      )}
    </div>
  );
}
