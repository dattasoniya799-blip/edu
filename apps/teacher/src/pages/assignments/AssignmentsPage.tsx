/**
 * 作业总览(C3 #4)
 * 教师看自己布置过的全部作业:走 GET /assignments → AssignmentBrief[]。
 * 展示 作业名/讲次/截止/提交进度/已批/状态;进行中可去批改,有讲次可回编排。
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { AssignmentBriefDto, AssignmentKind } from '@qiming/contracts';
import { Button, Card, EmptyState, ProgressBar, Skeleton, Tag } from '@qiming/ui';
import { api } from '../../api';
import { PageHead } from '../Shell';
import { fmtDateTime } from '../course/lib/format';

const KIND_LABEL: Record<AssignmentKind, string> = {
  homework: '课后作业', in_class: '随堂作业', correction: '订正', wrong_redo: '错题重做', consolidation: '巩固练习',
};

type StatusFilter = 'all' | 'ongoing' | 'finished';
const FILTERS: { key: StatusFilter; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'ongoing', label: '进行中' },
  { key: 'finished', label: '已结束' },
];

export function AssignmentsPage() {
  const navigate = useNavigate();
  const [list, setList] = useState<AssignmentBriefDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false); // REV-front #2:加载失败(可重试)区别于空态
  const [reload, setReload] = useState(0);
  const [filter, setFilter] = useState<StatusFilter>('all');

  useEffect(() => {
    setLoading(true);
    setError(false);
    api.get('/assignments', { query: filter === 'all' ? undefined : { status: filter } })
      .then((r) => setList(r.data as AssignmentBriefDto[]))
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [filter, reload]);

  return (
    <div>
      <PageHead title="作业总览" sub="你布置过的全部作业 · 提交进度与批改状态一览;进行中可直接去批改" />

      <div className="mb-4 flex gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            className={`rounded-pill border-[1.5px] px-3.5 py-1.5 text-[13px] font-semibold transition-colors ${
              filter === f.key ? 'border-primary bg-primary text-card' : 'border-line bg-card text-ink-2 hover:border-ink-3'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {loading ? (
        <Skeleton lines={3} className="h-24 w-full" />
      ) : error ? (
        <div className="rounded-lg border border-line bg-card shadow-card">
          <EmptyState icon="⚠" text="作业加载失败" hint="可能是网络波动,请重试"
            action={<Button variant="primary" onClick={() => setReload((n) => n + 1)}>重新加载</Button>} />
        </div>
      ) : list.length === 0 ? (
        <div className="rounded-lg border border-line bg-card shadow-card">
          <EmptyState icon="✦" text="还没有布置作业" hint="进入讲次编排「课后作业」区,从题库组卷并发布作业" />
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {list.map((a) => {
            const submitRate = a.totalStudents > 0 ? Math.round((a.submitted / a.totalStudents) * 100) : 0;
            const gradeRate = a.submitted > 0 ? Math.round((a.graded / a.submitted) * 100) : 0;
            return (
              <Card key={a.id}>
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-md bg-orange-soft text-[16px] text-orange">✦</div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <b className="text-sm">{a.paperName}</b>
                      <Tag tone="primary">{KIND_LABEL[a.kind]}</Tag>
                      {a.status === 'finished' ? <Tag tone="green">已结束</Tag> : <Tag tone="orange">进行中</Tag>}
                    </div>
                    <div className="mt-0.5 text-[12.5px] text-ink-2">
                      {a.lessonTitle ?? '未挂讲次'} · 截止 {fmtDateTime(a.dueAt)}
                    </div>
                  </div>
                  <div className="flex w-[180px] shrink-0 flex-col gap-1.5">
                    <div className="flex items-center justify-between text-[12px] text-ink-2">
                      <span>提交</span>
                      <span className="tabular-nums">{a.submitted}/{a.totalStudents}</span>
                    </div>
                    <ProgressBar value={submitRate} tone="primary" />
                    <div className="flex items-center justify-between text-[12px] text-ink-2">
                      <span>已批</span>
                      <span className="tabular-nums">{a.graded}/{a.submitted}</span>
                    </div>
                    <ProgressBar value={gradeRate} tone={gradeRate >= 100 ? 'green' : 'orange'} />
                  </div>
                  <div className="flex shrink-0 flex-col gap-1.5">
                    <Button variant="primary" className="!px-3.5 !py-[7px]" onClick={() => navigate(`/grading/${a.id}`)}>
                      去批改
                    </Button>
                    {a.lessonId != null && (
                      <button type="button" className="text-[12.5px] font-semibold text-primary hover:underline" onClick={() => navigate(`/lessons/${a.lessonId}/arrange`)}>
                        回编排
                      </button>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
