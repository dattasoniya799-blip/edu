/**
 * 讲次时间线(展示组件,原型 s-course 段):rail 圆点 + 讲次卡 + 回看/订正入口(≥44px)
 */
import type { LessonDto } from '@qiming/contracts';
import { Button, Tag } from '@qiming/ui';
import { canEnterClassroom, enterClassLabel } from './lib/entry';

export interface TimelineItem {
  lesson: LessonDto;
  myHomework: { assignmentId: number; score: number | null; wrongCount: number } | null;
  /** 契约变更申请 B5-1:回看入口需要资源 id(mock 已按该形状下发) */
  resources?: { id: number; name: string; type: string }[];
  /** 发布即建会话:已发布讲次带自己的课堂会话 id(契约前瞻,mock 已按该形状下发);未发布为 null */
  sessionId?: number | null;
}

export interface LessonTimelineProps {
  items: TimelineItem[];
  /** 该讲对应的待办订正作业(由 /student/assignments pending 按 lessonId 匹配) */
  correctionByLesson: Record<number, number>;
  onReplay: (resourceId: number, name: string) => void;
  onCorrect: (assignmentId: number) => void;
  /** 进课堂:用该讲自己的 sessionId(不再借用全局 today 的会话) */
  onEnterClass: (lesson: LessonDto, sessionId: number | null) => void;
}

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' }) : '待排期';

const isToday = (iso: string | null) => iso != null && new Date(iso).toDateString() === new Date().toDateString();

export function LessonTimeline({ items, correctionByLesson, onReplay, onCorrect, onEnterClass }: LessonTimelineProps) {
  return (
    <div>
      {items.map(({ lesson, myHomework, resources, sessionId }, i) => {
        const today = isToday(lesson.scheduledStart);
        const finished = lesson.status === 'finished';
        // C2 #9:进课堂以「已发布」为准(ready/in_progress),不再按上课时间拦截
        const published = canEnterClassroom(lesson);
        // FIX4 #1(P1-2):必须拿到该讲自己的 sessionId 才可进、跳对应课堂;
        // 已发布但会话尚未就绪(sessionId=null)→ 不给进,显示「课堂未开放」。
        const enterable = published && sessionId != null;
        const dot = finished
          ? 'bg-green-soft text-green'
          : enterable
            ? 'bg-primary text-card shadow-btn-sm'
            : 'bg-bg text-ink-3';
        const correctionId = correctionByLesson[lesson.id];
        return (
          <div key={lesson.id} className="flex gap-3.5">
            {/* rail */}
            <div className="flex w-9 shrink-0 flex-col items-center">
              <div className={`flex h-9 w-9 items-center justify-center rounded-pill text-[13px] font-bold ${dot}`} aria-hidden>
                {finished ? '✓' : lesson.seq}
              </div>
              {i < items.length - 1 && <div className="w-px flex-1 bg-line" />}
            </div>
            {/* body */}
            <div className={`mb-3.5 flex-1 rounded-lg border bg-card p-4 shadow-card ${today ? 'border-primary' : 'border-line'}`}>
              <div className="flex flex-wrap items-center gap-1.5">
                <b className="text-sm">{lesson.title}</b>
                {finished && myHomework?.score != null && <Tag tone="green">作业 {myHomework.score} 分</Tag>}
                {today && <Tag tone="primary">今天 {lesson.scheduledStart && new Date(lesson.scheduledStart).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</Tag>}
                {!finished && !today && <Tag tone="gray">{fmtDate(lesson.scheduledStart)}</Tag>}
                {finished && <span className="ml-auto text-xs text-ink-3">{fmtDate(lesson.scheduledStart)}</span>}
              </div>
              <div className="mt-1.5 flex gap-3 text-xs text-ink-2">
                {finished && myHomework
                  ? <span>{myHomework.wrongCount > 0 ? `${myHomework.wrongCount} 道错题待订正` : '作业全对,无需订正'}</span>
                  : finished
                    ? <span>本讲无作业</span>
                    : enterable
                      ? <span>AI 伴学课堂已开放 · 约 100 分钟</span>
                      : published
                        ? <span>课堂未开放,请稍候</span>
                        : <span>老师发布后即可进入课堂</span>}
              </div>
              {(enterable || (finished && ((resources?.length ?? 0) > 0 || correctionId != null))) && (
                <div className="mt-2.5 flex flex-wrap gap-2">
                  {enterable && (
                    <Button variant="primary" className="min-h-touch" onClick={() => onEnterClass(lesson, sessionId ?? null)}>{enterClassLabel(lesson)}</Button>
                  )}
                  {finished && resources?.map((r) => (
                    <Button key={r.id} className="min-h-touch" onClick={() => onReplay(r.id, r.name)}>▶ 回看课件</Button>
                  ))}
                  {finished && correctionId != null && (
                    <Button className="min-h-touch !border-orange !text-orange" onClick={() => onCorrect(correctionId)}>订正错题</Button>
                  )}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
