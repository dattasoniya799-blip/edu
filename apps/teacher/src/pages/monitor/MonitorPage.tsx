/**
 * 课堂监控(原型 v0.4 id=t-monitor)
 * monitor:roster 流驱动(source.ts 抽象,mock 每 5s 一帧)→ 顶部四卡 + 学生卡片网格(卡住红框)+ 告警侧栏
 * 不闪烁:mergeRoster 增量合并保引用 + memo 卡片,未变化的学生卡不重渲
 * 裁剪口径(MVP 手册 1.1):介入辅导(推语音)、回放时点切换延后
 */
import { memo, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { LessonDto, ParticipantMonitor } from '@qiming/contracts';
import { Card, EmptyState, Skeleton, StatCard } from '@qiming/ui';
import { api } from '../../api';
import { getToken } from '../../auth/token';
import { PageHead } from '../Shell';
import { fmtClock, fmtDateTime } from '../course/lib/format';
import { SEGMENT_LABEL } from '../lesson/lib/segments';
import { deriveStats, mergeRoster, pushAlerts, type AlertEntry } from './lib/roster';
import { createMonitorSource } from './source';

/** 随堂练题数兜底(实际取讲次 practice 卷题数) */
const FALLBACK_QUESTION_TOTAL = 5;

const STATE_UI: Record<ParticipantMonitor['state'], { cls: string; label: (p: ParticipantMonitor) => string }> = {
  normal: { cls: 'bg-green-soft text-green', label: () => '正常' },
  stuck: { cls: 'bg-red-soft text-red', label: (p) => `卡住 ${Math.floor(p.stuckSec / 60)} 分钟` },
  hand_up: { cls: 'bg-orange-soft text-orange', label: () => '举手' },
  offline: { cls: 'bg-bg text-ink-3', label: () => '离线' },
};

/** 学生卡(memo:roster 增量合并后,引用不变即不重渲 → 5s 刷新不闪烁) */
const StudentCard = memo(function StudentCard({ p, questionTotal }: { p: ParticipantMonitor; questionTotal: number }) {
  const ui = STATE_UI[p.state];
  const pct = Math.round((p.answeredCount / Math.max(1, questionTotal)) * 100);
  const done = p.currentQuestion == null;
  return (
    <div className={`rounded-lg border bg-card p-3.5 shadow-card ${p.state === 'stuck' ? 'border-[1.5px] border-red' : 'border-line'} ${p.online ? '' : 'opacity-60'}`}>
      <div className="flex items-center gap-2">
        <div className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-pill bg-primary-soft text-[11px] font-bold text-primary">
          {p.studentName.slice(0, 1)}
        </div>
        <b className="truncate text-[13.5px]">{p.studentName}</b>
        <span className={`ml-auto shrink-0 rounded-pill px-2 py-0.5 text-[11.5px] font-semibold tabular-nums ${ui.cls}`}>{ui.label(p)}</span>
      </div>
      <div className="mt-2.5 h-1.5 w-full overflow-hidden rounded-pill bg-bg">
        <div
          className={`h-full rounded-pill transition-all duration-700 ${p.state === 'stuck' ? 'bg-red' : pct >= 100 ? 'bg-green' : 'bg-primary'}`}
          style={{ width: `${Math.min(100, pct)}%` }}
        />
      </div>
      <small className="mt-1.5 block truncate text-xs tabular-nums text-ink-2">
        {done ? '已完成本环节' : `第 ${p.currentQuestion} 题`} · 正确 {p.correctCount}/{p.answeredCount}
        {p.aiAskCount > 0 && ` · 问 AI ${p.aiAskCount} 次`}
      </small>
    </div>
  );
});

const ALERT_UI = {
  stuck: { icon: '⚠', cls: 'bg-red-soft text-red' },
  hand_up: { icon: '✋', cls: 'bg-orange-soft text-orange' },
} as const;

export function MonitorPage() {
  const { id } = useParams();
  const lessonId = Number(id);
  const useMock = import.meta.env.VITE_USE_MOCK !== 'false';
  const [lesson, setLesson] = useState<LessonDto | null>(null);
  /** seq → 环节名(取自讲次编排;mock 流的 segment=3 即随堂练) */
  const [segNames, setSegNames] = useState<Map<number, string>>(new Map());
  const [questionTotal, setQuestionTotal] = useState(FALLBACK_QUESTION_TOTAL);
  const [participants, setParticipants] = useState<ParticipantMonitor[]>([]);
  const [alerts, setAlerts] = useState<AlertEntry[]>([]);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    api.get('/lessons/{id}', { params: { id: lessonId } }).then((r) => setLesson(r.data as LessonDto)).catch(() => {});
    // 随堂练题数 = 讲次 practice 环节挂的卷的题数(进度条分母)
    api.get('/lessons/{id}/segments', { params: { id: lessonId } })
      .then(async (r) => {
        setSegNames(new Map(r.data.map((s) => [s.seq, SEGMENT_LABEL[s.type]])));
        const practice = r.data.find((s) => s.type === 'practice');
        if (practice?.paperId != null) {
          const p = await api.get('/papers/{id}', { params: { id: practice.paperId } });
          if (p.data.questions.length > 0) setQuestionTotal(p.data.questions.length);
        }
      })
      .catch(() => {});
  }, [lessonId]);

  // 真实模式需用真实 ClassSession id 连 WS(契约 LessonDto.sessionId,GET /lessons/:id 返回);
  // 无在开会话(sessionId=null)则不连,渲染时给出提示。mock 模式流自带帧,sessionId 仅占位。
  const sessionId = lesson?.sessionId ?? null;
  const noSession = lesson != null && !useMock && sessionId == null;

  useEffect(() => {
    if (lesson == null) return; // 等讲次加载,拿到真实 sessionId 再决定是否连
    if (!useMock && sessionId == null) return; // 真实模式无进行中会话:不连 WS,避免 join 报错
    // 真实模式以本课教师身份 class:join 进监控房(sessionId=真实 ClassSession id)
    const source = createMonitorSource({ sessionId: sessionId ?? lessonId, token: getToken() });
    const stop = source.connect({
      onRoster: (e) => {
        setConnected(true);
        // 增量合并:未变化的学生沿用旧引用,memo 卡片不重渲(不闪烁)
        setParticipants((prev) => mergeRoster(prev, e.participants));
      },
      onAlert: (e) => setAlerts((prev) => pushAlerts(prev, [e], Date.now())),
    });
    return stop;
  }, [lessonId, sessionId, useMock, lesson]);

  const stats = useMemo(() => deriveStats(participants), [participants]);

  return (
    <div>
      <PageHead
        title={(
          <span>
            <Link className="text-[15px] font-semibold text-primary hover:underline" to={`/courses${lesson ? `?courseId=${lesson.courseId}` : ''}`}>← 讲次</Link>
            <span className="text-ink-3"> / </span>{lesson?.title ?? '课堂'} · 课堂监控
          </span>
        )}
        sub={`本页仅上课中实时可用,每 5 秒刷新;课后无回放${lesson?.scheduledStart ? ` · ${fmtDateTime(lesson.scheduledStart)}` : ''}`}
      />

      {noSession ? (
        <div className="rounded-lg border border-line bg-card shadow-card">
          <EmptyState
            icon="◷"
            text="课堂未开始"
            hint="该讲次暂无进行中的课堂会话;待教师发布/开课后,这里实时显示每个学生的进度。"
          />
        </div>
      ) : !connected ? (
        <>
          <div className="mb-4 grid grid-cols-2 gap-4 xl:grid-cols-4">
            {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24 w-full" />)}
          </div>
          <Skeleton lines={2} className="h-24 w-full" />
        </>
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-4 xl:grid-cols-4">
            <StatCard
              ribbon="primary" label="环节进度"
              value={stats.majoritySegment != null
                ? `环节 ${stats.majoritySegment} · ${segNames.get(stats.majoritySegment) ?? '随堂练'}`
                : '—'}
              delta={`${stats.online}/${stats.total} 人在堂`}
            />
            <StatCard
              ribbon="green" label="全班实时正确率"
              value={stats.correctRate != null ? `${stats.correctRate}%` : '—'}
              delta="按已作答题目实时统计"
            />
            <StatCard
              ribbon="red" label="卡住提醒"
              value={stats.stuckCount}
              delta={stats.stuckCount > 0 ? `${stats.stuckNames.join('、')} 停留超 3 分钟` : '暂无卡住学生'}
            />
            <StatCard
              ribbon="violet" label="AI 答疑次数"
              value={stats.aiAskTotal}
              delta={stats.handUpCount > 0 ? `另有 ${stats.handUpCount} 人举手请求当面讲解` : 'AI 引导式答疑进行中'}
            />
          </div>

          <div className="grid items-start gap-4" style={{ gridTemplateColumns: 'minmax(0,1fr) 280px' }}>
            {participants.length === 0 ? (
              <div className="rounded-lg border border-line bg-card shadow-card">
                <EmptyState icon="◔" text="暂无学生在堂" hint="学生进入课堂后,这里实时显示每个人的进度" />
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3 xl:grid-cols-3">
                {participants.map((p) => <StudentCard key={p.studentId} p={p} questionTotal={questionTotal} />)}
              </div>
            )}

            {/* 告警侧栏 */}
            <Card title="告警" bodyClassName="p-3">
              {alerts.length === 0 ? (
                <EmptyState icon="✓" text="暂无告警" hint="卡住超 3 分钟或举手会在此提醒" className="py-8" />
              ) : (
                <div className="flex max-h-[520px] flex-col gap-2 overflow-auto">
                  {alerts.map((a) => {
                    const ui = ALERT_UI[a.alert.type];
                    return (
                      <div key={a.key} className="flex items-start gap-2.5 rounded-md border border-line px-3 py-2.5">
                        <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-pill text-[12px] ${ui.cls}`}>{ui.icon}</span>
                        <div className="min-w-0 text-[12.5px] leading-snug">
                          <b>{a.alert.studentName}</b>
                          <span className="text-ink-2"> · {a.alert.type === 'stuck' ? '卡住' : '举手'}</span>
                          <div className="text-ink-2">{a.alert.detail}</div>
                          <div className="mt-0.5 text-[11px] tabular-nums text-ink-3">{fmtClock(a.at)}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
