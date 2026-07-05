/**
 * 课堂模式(B6,原型 classHead/classFoot/s-class-* 各段)
 * 整屏接管:独立路由(不挂 Shell),隐藏常规导航;深色 class-head + 可点步进器 + 底部 AI 旁白条。
 * 四环节:①回顾(错题卡)②课件(分页+打点小测)③随堂练(B5 答题组件 + AI 助教)+ 大题预批 ④小结 → 下课返回。
 */
import { useEffect, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import type { AssignmentDto, WrongBookItemDto } from '@qiming/contracts';
import { Button, useToast } from '@qiming/ui';
import { api } from '../../api';
import { useAuth } from '../../auth/AuthProvider';
import { Stage } from '../../Stage';
import { ClassFoot } from './ClassFoot';
import { ClassHead } from './ClassHead';
import { LectureSegment } from './LectureSegment';
import { PracticeSegment } from './PracticeSegment';
import { SummarySegment } from './SummarySegment';
import { useClassroom } from './useClassroom';
import { WarmupSegment } from './WarmupSegment';

export function ClassroomPage() {
  const { sessionId } = useParams();
  const { me, ready } = useAuth();
  const sid = Number(sessionId);
  if (!ready) {
    return <Stage><div className="flex flex-1 items-center justify-center text-ink-3">加载中…</div></Stage>;
  }
  if (!me) return <Navigate to="/login" replace />;
  if (!Number.isFinite(sid)) return <Navigate to="/" replace />;
  return <ClassroomInner sessionId={sid} />;
}

function ClassroomInner({ sessionId }: { sessionId: number }) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const cls = useClassroom(sessionId);
  const { state } = cls;

  // ①回顾:错题卡列表(warmup config source=auto_wrong,取 open 前 3)
  const [warmup, setWarmup] = useState<WrongBookItemDto[] | null>(null);
  const [reviewed, setReviewed] = useState<number[]>([]);
  useEffect(() => {
    api.get('/student/wrong-book', { query: { status: 'open' } })
      .then((r) => setWarmup((r.data as { items: WrongBookItemDto[] }).items.slice(0, 3)))
      .catch(() => setWarmup([]));
  }, []);

  // ④小结:课后任务
  const lastSeq = Math.max(1, state.session?.segments.length ?? 4);
  const atSummary = state.seg >= lastSeq;
  const [pendingTasks, setPendingTasks] = useState<AssignmentDto[] | null>(null);
  useEffect(() => {
    if (!atSummary || pendingTasks != null) return;
    api.get('/student/assignments', { query: { status: 'pending' } })
      .then((r) => setPendingTasks(r.data as AssignmentDto[]))
      .catch(() => setPendingTasks([]));
  }, [atSummary, pendingTasks]);

  const exit = () => {
    cls.leave();
    navigate('/');
    toast(state.ended ? '本讲已结束,作业见「今日」' : '已离开课堂,课堂进度已保存');
  };
  /** 错误态返回(未成功入课,不提示「进度已保存」) */
  const back = () => {
    cls.leave();
    navigate('/');
  };

  // ---------- join 被业务拒绝(课堂已结束/不是本课学生/未开课等):已停止重连,明确错误态 ----------
  if (state.conn === 'rejected') {
    return (
      <Stage>
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-ink-3">
          <span aria-hidden className="text-2xl">⚠</span>
          <b className="text-base text-ink">无法进入课堂</b>
          <span className="text-sm">{state.error ?? '课堂拒绝了本次加入'}</span>
          <Button className="min-h-touch mt-2" onClick={back}>返回</Button>
        </div>
      </Stage>
    );
  }

  // ---------- 自动重连超限:不再转圈,手动重试 ----------
  if (state.conn === 'failed') {
    return (
      <Stage>
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-ink-3">
          <span aria-hidden className="text-2xl">⚠</span>
          <span className="text-sm">连接失败,请检查网络后重试</span>
          <div className="mt-2 flex gap-3">
            <Button variant="primary" className="min-h-touch" onClick={() => cls.retry()}>重新连接</Button>
            <Button className="min-h-touch" onClick={back}>返回首页</Button>
          </div>
        </div>
      </Stage>
    );
  }

  // ---------- 连接中(首个快照前) ----------
  if (state.session == null) {
    return (
      <Stage>
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-ink-3">
          <span aria-hidden className="text-2xl">{state.conn === 'closed' ? '⚠' : '⟳'}</span>
          <span className="text-sm">{state.conn === 'closed' ? '连接已关闭' : '正在进入课堂…'}</span>
          {state.reconnectAttempt > 0 && <span className="text-xs">网络不稳,正在重试(第 {state.reconnectAttempt} 次)</span>}
          <Button className="min-h-touch mt-2" onClick={exit}>返回首页</Button>
        </div>
      </Stage>
    );
  }

  const segType = state.session.segments.find((s) => s.seq === state.seg)?.type ?? 'summary';

  return (
    <Stage>
      <div className="relative flex min-h-0 flex-1 flex-col">
        <ClassHead
          title={state.session.lessonTitle}
          segments={state.session.segments}
          seg={state.seg}
          elapsedSec={state.session.elapsedSec}
          reconnectAttempt={state.conn === 'reconnecting' ? state.reconnectAttempt : 0}
          onStep={(seq) => cls.gotoSegment(seq)}
          onExit={exit}
        />

        <div className="min-h-0 flex-1 overflow-auto p-6">
          {segType === 'warmup' && (
            <WarmupSegment items={warmup} reviewed={reviewed}
              onReview={(id) => { setReviewed((r) => [...r, id]); cls.touch(); }}
              onNext={() => cls.gotoSegment(state.seg + 1)} />
          )}
          {segType === 'lecture' && (
            <LectureSegment pages={state.courseware}
              onTouch={() => cls.touch()}
              onDone={() => cls.gotoSegment(state.seg + 1)} />
          )}
          {segType === 'practice' && (
            <PracticeSegment state={state}
              onAnswer={(qid, r) => cls.answer(qid, r)}
              onGoto={(i) => cls.gotoQuestion(i)}
              onFlag={(qid) => cls.flag(qid)}
              onAsk={(t) => cls.aiAsk(t)}
              onTouch={(qid) => cls.touch(qid)}
              onDone={() => cls.gotoSegment(state.seg + 1)} />
          )}
          {(segType === 'summary' || segType === 'homework' || segType === 'break_time') && (
            <SummarySegment state={state} pendingTasks={pendingTasks}
              onOpenTask={(id) => { cls.leave(); navigate(`/homework/${id}`); }}
              onExit={exit} />
          )}
        </div>

        <ClassFoot narration={state.narration} />

        {/* 教师暂停(class:control pause)→ 整屏遮罩 */}
        {state.paused && !state.ended && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-ink/80 text-card">
            <span aria-hidden className="text-4xl">⏸</span>
            <b className="text-lg">老师暂停了课堂</b>
            <span className="text-[13px] text-card/70">稍作休息,恢复后自动继续</span>
            <Button className="min-h-touch mt-2 !border-0 !bg-card/15 !text-card" onClick={exit}>退出课堂</Button>
          </div>
        )}
      </div>
    </Stage>
  );
}
