/**
 * 今日任务行(展示组件):图标 + 标题/截止 + 进度 + 状态动作(≥44px)
 */
import { Button, ProgressBar, Tag } from '@qiming/ui';

export interface TodayTask {
  assignmentId: number;
  kind: string;
  title: string;
  questionCount: number;
  dueAt: string | null;
  progress: { answered: number; total: number; status: string };
}

const KIND_META: Record<string, { icon: string; iconCls: string; label: string }> = {
  homework: { icon: '✎', iconCls: 'bg-primary-soft text-primary', label: '课后作业' },
  in_class: { icon: '▶', iconCls: 'bg-primary-soft text-primary', label: '随堂练' },
  correction: { icon: '↻', iconCls: 'bg-orange-soft text-orange', label: '订正' },
  wrong_redo: { icon: '↻', iconCls: 'bg-red-soft text-red', label: '错题重做' },
  consolidation: { icon: '✓', iconCls: 'bg-green-soft text-green', label: '巩固练' },
};

const fmt = (iso: string) =>
  new Date(iso).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

export interface TaskRowProps {
  task: TodayTask;
  /** 进入答题器 */
  onOpen: (assignmentId: number) => void;
  /** 已出分任务 → 查看解析(错题本) */
  onReview: () => void;
}

export function TaskRow({ task, onOpen, onReview }: TaskRowProps) {
  const meta = KIND_META[task.kind] ?? KIND_META.homework;
  const { answered, total, status } = task.progress;
  const pct = (answered / Math.max(total, 1)) * 100;
  const overdue = task.dueAt != null && status !== 'graded' && status !== 'submitted' && new Date(task.dueAt) < new Date();

  return (
    <div className="flex min-h-touch items-center gap-3.5 rounded-md border border-line p-3.5">
      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] text-[15px] ${meta.iconCls}`} aria-hidden>
        {meta.icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <b className="text-sm">{task.title}</b>
          <Tag tone={task.kind === 'correction' || task.kind === 'wrong_redo' ? 'orange' : 'primary'}>{meta.label}</Tag>
          {status === 'graded' && <Tag tone="green">已完成</Tag>}
          {status === 'submitted' && <Tag tone="violet">已交卷 · 待批改</Tag>}
          {overdue && <Tag tone="red">已截止</Tag>}
        </div>
        <div className="mt-1 text-xs text-ink-2">
          共 {task.questionCount} 题
          {task.dueAt && status !== 'graded' && ` · 截止 ${fmt(task.dueAt)}`}
        </div>
      </div>
      <div className="w-32 shrink-0">
        <div className="mb-1 text-right text-xs tabular-nums text-ink-3">{answered} / {total}</div>
        <ProgressBar value={pct} tone={status === 'graded' ? 'green' : 'primary'} />
      </div>
      {status === 'graded' ? (
        <Button className="min-h-touch shrink-0" onClick={onReview}>查看解析</Button>
      ) : status === 'submitted' ? (
        // 已交卷待批改:出分前不可再进入(再次 POST attempts 会按契约新开一次作答)
        <span className="flex min-h-touch shrink-0 items-center px-2 text-xs text-ink-3">待老师批改</span>
      ) : (
        <Button variant="primary" className="min-h-touch shrink-0" onClick={() => onOpen(task.assignmentId)}>
          {status === 'in_progress' ? '继续作答' : task.kind === 'correction' ? '去订正' : '开始作答'}
        </Button>
      )}
    </div>
  );
}
