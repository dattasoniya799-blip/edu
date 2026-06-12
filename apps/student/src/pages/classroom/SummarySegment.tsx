/**
 * 环节④ 小结与下课(原型 s-class-end):end-hero + 本堂表现 + 课后任务 → 下课返回常规导航
 * 课后任务 = REST /student/assignments?status=pending(取数在 ClassroomPage,本组件纯展示)
 */
import type { AssignmentDto } from '@qiming/contracts';
import { Button, EmptyState, ProgressBar, Skeleton } from '@qiming/ui';
import { practiceStats, type ClassState } from './machine';

export interface SummarySegmentProps {
  state: ClassState;
  /** null = 加载中 */
  pendingTasks: AssignmentDto[] | null;
  onOpenTask(assignmentId: number): void;
  onExit(): void;
}

const KIND_LABEL: Record<string, string> = {
  homework: '课后作业', correction: '订正', wrong_redo: '错题重做', consolidation: '巩固练', in_class: '随堂练',
};

export function SummarySegment({ state, pendingTasks, onOpenTask, onExit }: SummarySegmentProps) {
  const { answered, correct, total } = practiceStats(state);
  const judged = state.quiz.items.filter((it) => it.feedback?.judged).length;
  const rate = judged > 0 ? Math.round((correct / judged) * 100) : null;
  const grade = rate == null ? '已完成' : rate >= 80 ? '优秀' : rate >= 60 ? '良好' : '继续加油';

  return (
    <div className="mx-auto max-w-[980px]">
      {/* end-hero */}
      <div className="mb-4 flex items-center gap-4 rounded-lg bg-gradient-to-r from-green to-primary p-6 text-card shadow-card">
        <span aria-hidden className="text-4xl">🎉</span>
        <div className="min-w-0 flex-1">
          <b className="block text-lg">{state.ended ? '本讲已下课!' : '本讲临近尾声!'}本堂表现:{grade}</b>
          <span className="text-[13px] opacity-90">
            随堂练已答 {answered}/{total} 题{rate != null && ` · 客观题正确率 ${rate}%`}
            {state.wrongAdded.length > 0 && ` · ${state.wrongAdded.length} 道错题已收入错题本`}
          </span>
        </div>
        <Button className="min-h-touch shrink-0 !border-0 !bg-card !text-green" onClick={onExit}>
          下课,回到首页
        </Button>
      </div>

      <div className="grid grid-cols-2 items-start gap-4">
        {/* 本堂知识掌握 */}
        <div className="rounded-lg border border-line bg-card p-4 shadow-card">
          <h4 className="mb-3 text-[13.5px] font-bold">本堂知识掌握</h4>
          {judged === 0 ? (
            <EmptyState icon="✎" text="本堂还没有判分作答" hint="回到随堂练完成几题,这里会出现掌握情况" />
          ) : (
            <>
              <div className="mb-1 flex items-center justify-between text-[13px]">
                <span>随堂练 · 客观题</span><b className="tabular-nums">{rate}%</b>
              </div>
              <ProgressBar value={rate ?? 0} />
              <div className="mt-3 flex items-center justify-between text-[13px]">
                <span>压轴大题(AI 预批,待老师复核)</span>
                <b>{Object.keys(state.preGrade).length > 0 ? '已提交' : '未提交'}</b>
              </div>
            </>
          )}
          <div className="mt-4 rounded-md bg-violet-soft px-3.5 py-3 text-[12.5px] leading-6 text-ink">
            <span className="mr-1.5 rounded-[6px] bg-violet px-1.5 py-0.5 text-[10px] font-bold text-card">AI</span>
            小启总结:{answered === 0
              ? '这堂课你还没动笔,回到随堂练试两题吧~'
              : state.wrongAdded.length > 0
                ? `答错的 ${state.wrongAdded.length} 道题已收入错题本,课后作业里我会安排同类巩固,记得「上加下减」。`
                : '本堂没有新增错题,继续保持!课后作业按时完成哦。'}
          </div>
        </div>

        {/* 课后任务 */}
        <div className="rounded-lg border border-line bg-card p-4 shadow-card">
          <h4 className="mb-3 text-[13.5px] font-bold">课后任务 · 已推送到你的平板</h4>
          {pendingTasks == null ? (
            <Skeleton className="h-16" lines={2} />
          ) : pendingTasks.length === 0 ? (
            <EmptyState icon="✓" text="暂无待办任务" hint="老师发布课后作业后会出现在「今日」" />
          ) : (
            <div className="flex flex-col gap-2.5">
              {pendingTasks.map((a) => (
                <div key={a.id} className="flex items-center gap-3 rounded-md border border-line bg-bg/50 px-3.5 py-2.5">
                  <span aria-hidden className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] bg-primary-soft text-sm text-primary">✎</span>
                  <div className="min-w-0 flex-1">
                    <b className="block truncate text-[13px]">{a.paperName}</b>
                    <small className="text-xs text-ink-3">
                      {KIND_LABEL[a.kind] ?? a.kind} · {a.questionCount} 题
                      {a.dueAt && ` · ${new Date(a.dueAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })} 截止`}
                      {!a.scoreCounted && ' · 不计分'}
                    </small>
                  </div>
                  <Button className="min-h-touch shrink-0" onClick={() => onOpenTask(a.id)}>现在就做</Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
