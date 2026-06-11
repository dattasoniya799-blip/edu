import { useEffect, useState } from 'react';
import { Button, Card, EmptyState, ProgressBar, Tag, useToast } from '@qiming/ui';
import { api } from '../api';
import { useAuth } from '../auth/AuthProvider';

type Today = {
  todayLesson: { lessonId: number; courseName: string; title: string; startAt: string; endAt: string; canEnterAt: string; sessionId: number | null } | null;
  tasks: { assignmentId: number; kind: string; title: string; questionCount: number; dueAt: string | null; progress: { answered: number; total: number; status: string } }[];
};

const KIND_LABEL: Record<string, string> = {
  homework: '课后作业', in_class: '随堂练', correction: '订正', wrong_redo: '错题重做', consolidation: '巩固练',
};

export function Today() {
  const { me } = useAuth();
  const { toast } = useToast();
  const [data, setData] = useState<Today | null>(null);

  useEffect(() => {
    api.get('/student/today').then((r) => setData(r.data));
  }, []);

  const fmt = (iso: string) =>
    new Date(iso).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

  return (
    <div className="mx-auto max-w-[1040px]">
      <div className="mb-5">
        <h2 className="text-[21px] font-extrabold">你好,{me?.name ?? ''} 👋</h2>
        <p className="mt-1 text-[13px] text-ink-2">
          {data?.todayLesson ? '今天有课,提前 10 分钟可进入课堂' : '今天没有排课,完成任务列表里的练习吧'}
        </p>
      </div>

      {data?.todayLesson && (
        <div className="mb-5 flex items-center gap-4 rounded-lg bg-gradient-to-r from-primary to-primary-deep p-5 text-card shadow-btn">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-card/20 text-lg">▶</div>
          <div className="min-w-0 flex-1">
            <b className="block text-[15px]">{data.todayLesson.courseName} · {data.todayLesson.title}</b>
            <span className="text-[12.5px] text-card/80">
              {fmt(data.todayLesson.startAt)} – {new Date(data.todayLesson.endAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })} · AI 伴学课堂
            </span>
          </div>
          <Button variant="secondary" className="min-h-touch shrink-0 !border-0 !bg-card !text-primary" onClick={() => toast('课堂模式由 B5 任务交付')}>
            进入课堂
          </Button>
        </div>
      )}

      <Card title="学习任务">
        {!data ? (
          <div className="animate-pulse space-y-3">{[0, 1].map((i) => <div key={i} className="h-14 rounded-md bg-bg" />)}</div>
        ) : data.tasks.length === 0 ? (
          <EmptyState text="没有待办任务" hint="老师发布作业后会出现在这里" />
        ) : (
          <div className="flex flex-col gap-3">
            {data.tasks.map((t) => (
              <div key={t.assignmentId} className="flex min-h-touch items-center gap-3.5 rounded-md border border-line p-3.5">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] bg-primary-soft text-primary">✎</div>
                <div className="min-w-0 flex-1">
                  <b className="text-sm">{t.title}</b>
                  <Tag tone="primary" className="ml-2">{KIND_LABEL[t.kind] ?? t.kind}</Tag>
                  <div className="mt-1 text-xs text-ink-2">
                    共 {t.questionCount} 题{t.dueAt && ` · 截止 ${fmt(t.dueAt)}`} · {t.progress.answered}/{t.progress.total} 已完成
                  </div>
                </div>
                <div className="w-28 shrink-0">
                  <ProgressBar value={(t.progress.answered / Math.max(t.progress.total, 1)) * 100} tone="primary" />
                </div>
                <Button onClick={() => toast('答题器由 B5 任务交付')}>
                  {t.progress.status === 'graded' ? '查看结果' : '继续作答'}
                </Button>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
