/** 数据总览(原型 a-dash):问候 + 四统计卡 + 最近动态(7 日课次图无契约数据源,按裁剪自然收紧) */
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { AiUsageSummaryDto } from '@qiming/contracts';
import { Button, Card, EmptyState, Skeleton, StatCard } from '@qiming/ui';
import { api } from '../api';
import { useAuth } from '../auth/AuthProvider';
import { formatMoney, greeting } from '../lib/format';
import { PageHead } from './Shell';

type Dash = {
  teacherCount: number; studentCount: number; weekAttendanceRate: number | null;
  monthAiCost: number; todayLessonCount: number;
  recentEvents: { text: string; time: string }[];
};

/** 动态行图标:按内容语义着色(原型 .tl .ic) */
function eventIcon(text: string): { ch: string; cls: string } {
  if (text.includes('报名') || text.includes('新学员')) return { ch: '+', cls: 'bg-green-soft text-green' };
  if (text.includes('AI')) return { ch: '✦', cls: 'bg-orange-soft text-orange' };
  if (text.includes('申诉') || text.includes('待处理')) return { ch: '!', cls: 'bg-red-soft text-red' };
  return { ch: '▦', cls: 'bg-primary-soft text-primary' };
}

export function Dashboard() {
  const { me } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState<Dash | null>(null);
  const [ai, setAi] = useState<AiUsageSummaryDto | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    Promise.all([api.get('/admin/dashboard'), api.get('/admin/ai-usage/summary')])
      .then(([d, s]) => { setData(d.data); setAi(s.data); })
      .catch(() => setFailed(true));
  }, []);

  const now = new Date();

  return (
    <div>
      <PageHead
        title={`${greeting(now.getHours())},${me?.name ?? ''}`}
        sub={`${now.getMonth() + 1} 月 ${now.getDate()} 日${data ? ` · 今天共安排 ${data.todayLessonCount} 个课次` : ''}`}
        actions={<Button variant="primary" onClick={() => navigate('/teachers', { state: { openAdd: true } })}>+ 添加教师</Button>}
      />
      {failed ? (
        <Card><EmptyState text="数据加载失败" hint="请检查后端或 mock 是否就绪" /></Card>
      ) : !data ? (
        <>
          <div className="mb-5 grid grid-cols-2 gap-4 xl:grid-cols-4">
            {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[108px] w-full !rounded-lg" />)}
          </div>
          <Skeleton className="h-[220px] w-full !rounded-lg" />
        </>
      ) : (
        <>
          <div className="mb-5 grid grid-cols-2 gap-4 xl:grid-cols-4">
            <StatCard ribbon="primary" label="在职教师" value={data.teacherCount} delta={<Link to="/teachers" className="hover:text-primary">账号管理 →</Link>} />
            <StatCard ribbon="violet" label="在读学生" value={data.studentCount} delta={<Link to="/students" className="hover:text-primary">账号管理 →</Link>} />
            <StatCard
              ribbon="green"
              label="本周到课率"
              value={data.weekAttendanceRate != null ? `${data.weekAttendanceRate}%` : '—'}
              delta="按已结束课次统计"
            />
            <StatCard
              ribbon="orange"
              label="本月 AI 开销"
              value={formatMoney(data.monthAiCost)}
              delta={
                <span>
                  {ai ? `额度已用 ${ai.usedPercent}% · ` : ''}
                  <Link to="/ai-usage" className="text-primary hover:underline">查看明细</Link>
                </span>
              }
            />
          </div>
          <Card title="最近动态">
            {data.recentEvents.length ? (
              <div className="flex flex-col gap-3.5">
                {data.recentEvents.map((e) => {
                  const ic = eventIcon(e.text);
                  return (
                    <div key={e.text} className="flex items-start gap-3 text-sm">
                      <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-[9px] text-[13px] font-bold ${ic.cls}`}>{ic.ch}</div>
                      <div>
                        {e.text}
                        <div className="mt-0.5 text-xs text-ink-3">{new Date(e.time).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</div>
                      </div>
                    </div>
                  );
                })}
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
