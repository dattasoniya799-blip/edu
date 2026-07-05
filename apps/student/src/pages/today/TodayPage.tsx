/**
 * 今日(原型 s-home 段,按 MVP 裁剪:无学分/连续天数/课表)
 * 课程 hero + 任务列表 + 本周学习 mini-stats(/student/report 周数据)
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Card, EmptyState, Skeleton, useToast } from '@qiming/ui';
import { api } from '../../api';
import { useAuth } from '../../auth/AuthProvider';
import { formatCorrectRate } from '../../lib/format';
import { TaskRow, type TodayTask } from './TaskRow';

interface TodayData {
  todayLesson: {
    lessonId: number; courseName: string; title: string;
    startAt: string; endAt: string; canEnterAt: string; sessionId: number | null;
  } | null;
  tasks: TodayTask[];
}
interface WeekStats { answeredCount: number; correctRate: number | null; studySec: number; wrongOpenCount: number }

const fmtDay = (iso: string) => {
  const d = new Date(iso);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const hm = d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  return sameDay ? `今天 ${hm}` : `${d.getMonth() + 1}月${d.getDate()}日 ${hm}`;
};

export function TodayPage() {
  const { me } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [data, setData] = useState<TodayData | null>(null);
  const [week, setWeek] = useState<WeekStats | null>(null);
  const [error, setError] = useState(false); // 今日安排加载失败(整页可重试)
  const [weekError, setWeekError] = useState(false); // 本周 mini-stats 加载失败(局部降级)
  const [reload, setReload] = useState(0);

  useEffect(() => {
    setData(null); setWeek(null); setError(false); setWeekError(false);
    api.get('/student/today')
      .then((r) => setData(r.data as TodayData))
      .catch(() => setError(true));
    api.get('/student/report')
      .then((r) => setWeek((r.data as { weekStats: WeekStats }).weekStats))
      .catch(() => setWeekError(true));
  }, [reload]);

  const hour = new Date().getHours();
  const greet = hour < 12 ? '上午好' : hour < 18 ? '下午好' : '晚上好';

  if (error) {
    return (
      <div className="mx-auto max-w-[1080px]">
        <Card>
          <EmptyState icon="⚠" text="加载失败" hint="可能是网络波动,请重试"
            action={<Button variant="primary" className="min-h-touch" onClick={() => setReload((n) => n + 1)}>重新加载</Button>} />
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1080px]">
      <div className="mb-5">
        <h2 className="text-[21px] font-extrabold">{greet},{me?.name ?? ''} 👋</h2>
        <p className="mt-1 text-[13px] text-ink-2">
          {data == null
            ? '正在加载今天的安排…'
            : data.todayLesson
              ? data.todayLesson.sessionId != null
                ? '今天有课,课堂已开放,点击进入吧'
                : '今天有课,课堂尚未发布,老师发布后即可进入'
              : '今天没有排课,完成任务列表里的练习吧'}
        </p>
      </div>

      {data?.todayLesson && (
        <div className="mb-5 flex items-center gap-4 rounded-lg bg-gradient-to-r from-primary to-primary-deep p-5 text-card shadow-btn">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-card/20 text-lg" aria-hidden>▶</div>
          <div className="min-w-0 flex-1">
            <b className="block text-[15px]">{data.todayLesson.courseName} · {data.todayLesson.title}</b>
            <span className="text-[12.5px] text-card/80">
              {fmtDay(data.todayLesson.startAt)} – {new Date(data.todayLesson.endAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
              {' '}· AI 伴学课堂
            </span>
          </div>
          <Button variant="secondary" className="min-h-touch shrink-0 !border-0 !bg-card !text-primary"
            onClick={() => {
              const sid = data.todayLesson?.sessionId;
              // 发布即建会话:有 sessionId 才进课堂;无则讲次未发布(不再承诺「稍后再试」)
              if (sid != null) navigate(`/classroom/${sid}`);
              else toast('该讲次尚未发布,老师发布后即可进入课堂');
            }}>
            {data.todayLesson.sessionId != null ? '进入课堂' : '讲次未发布'}
          </Button>
        </div>
      )}

      <div className="grid grid-cols-[1fr_300px] items-start gap-4">
        <Card title="学习任务">
          {!data ? (
            <Skeleton className="h-16" lines={2} />
          ) : data.tasks.length === 0 ? (
            <EmptyState icon="✓" text="没有待办任务" hint="老师发布作业后会出现在这里" />
          ) : (
            <div className="flex flex-col gap-3">
              {data.tasks.map((t) => (
                <TaskRow key={t.assignmentId} task={t}
                  onOpen={(id) => navigate(`/homework/${id}`)}
                  onReview={() => navigate('/wrong-book')} />
              ))}
            </div>
          )}
        </Card>

        <Card title="本周学习">
          {weekError ? (
            <div className="py-2 text-center text-[13px] text-ink-3">本周数据加载失败</div>
          ) : !week ? (
            <Skeleton className="h-12" lines={2} />
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-md bg-bg/70 p-3 text-center">
                <b className="block text-[19px] tabular-nums">{week.answeredCount}</b>
                <small className="text-xs text-ink-3">完成题目</small>
              </div>
              <div className="rounded-md bg-bg/70 p-3 text-center">
                <b className="block text-[19px] tabular-nums text-green">{formatCorrectRate(week.correctRate)}</b>
                <small className="text-xs text-ink-3">平均正确率</small>
              </div>
              <div className="rounded-md bg-bg/70 p-3 text-center">
                <b className="block text-[19px] tabular-nums">{Math.floor(week.studySec / 3600)}h {Math.round((week.studySec % 3600) / 60)}m</b>
                <small className="text-xs text-ink-3">学习时长</small>
              </div>
              <div className="rounded-md bg-bg/70 p-3 text-center">
                <b className="block text-[19px] tabular-nums text-red">{week.wrongOpenCount}</b>
                <small className="text-xs text-ink-3">待消灭错题</small>
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
