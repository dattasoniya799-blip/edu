/**
 * 课堂监控(原型 v0.4 id=t-monitor)
 * monitor:roster 流驱动(source.ts 抽象,mock 每 5s 一帧)→ 顶部四卡 + 学生卡片网格(卡住红框)+ 告警侧栏
 * 不闪烁:mergeRoster 增量合并保引用 + memo 卡片,未变化的学生卡不重渲
 * 裁剪口径(MVP 手册 1.1):介入辅导(推语音)、回放时点切换延后
 */
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { ClassControl, ClassSnapshot, LessonDto, ParticipantMonitor, SessionStatus } from '@qiming/contracts';
import { Button, Card, EmptyState, Modal, Skeleton, StatCard, Tag, useToast } from '@qiming/ui';
import { api } from '../../api';
import { getToken } from '../../auth/token';
import { PageHead } from '../Shell';
import { fmtClock, fmtDateTime } from '../course/lib/format';
import { SEGMENT_LABEL } from '../lesson/lib/segments';
import { deriveStats, mergeRoster, pushAlerts, type AlertEntry } from './lib/roster';
import { createMonitorSource, type MonitorSource } from './source';

/** 随堂练题数兜底(实际取讲次 practice 卷题数) */
const FALLBACK_QUESTION_TOTAL = 5;
/** 首帧等待上限:mock 源立即推第 0 帧、真实 WS 握手秒级,超过即视为连不上 */
const CONNECT_TIMEOUT_MS = 15_000;

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
  const useMock = import.meta.env.VITE_USE_MOCK === 'true';
  /**
   * 本页是全仓唯一读 `lesson.sessionId` 的地方,而 openapi 的 `Lesson` schema 至今没有这个属性
   * (只有 dto.ts 的 `LessonDto` 有,见 [2026-06-14 批准·B6课堂]),推导类型里因此拿不到它。
   * 这个 `as LessonDto` 是「推导类型确不完整」的断言,补 openapi + gen:sdk 之后才能删。
   */
  const [lesson, setLesson] = useState<LessonDto | null>(null);
  /** seq → 环节名(取自讲次编排;mock 流的 segment=3 即随堂练) */
  const [segNames, setSegNames] = useState<Map<number, string>>(new Map());
  const [questionTotal, setQuestionTotal] = useState(FALLBACK_QUESTION_TOTAL);
  const [participants, setParticipants] = useState<ParticipantMonitor[]>([]);
  const [alerts, setAlerts] = useState<AlertEntry[]>([]);
  const [connected, setConnected] = useState(false);
  /** 讲次信息拉不到:此前会让骨架屏永远转(lesson 为 null → 连 WS 的 effect 直接 return) */
  const [lessonError, setLessonError] = useState(false);
  /** 连上 WS 前的等待上限:超时给提示 + 重试,而不是无限骨架屏 */
  const [connectTimedOut, setConnectTimedOut] = useState(false);
  const [reload, setReload] = useState(0);
  /**
   * [2026-09-02 走查 B-1/B-4] 控场:会话状态(live / paused / ended)来自 join 快照,之后随 class:control 广播
   * 与本地下发同步;环节表来自快照(force_segment 用)。ended 后停止按钮并提示。
   */
  const [sessionStatus, setSessionStatus] = useState<SessionStatus | null>(null);
  const [segments, setSegments] = useState<ClassSnapshot['session']['segments']>([]);
  const [currentSeg, setCurrentSeg] = useState<number | null>(null);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const sourceRef = useRef<MonitorSource | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    setLessonError(false);
    api.get('/lessons/{id}', { params: { id: lessonId } })
      .then((r) => setLesson(r.data as LessonDto))
      .catch(() => setLessonError(true));
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
  }, [lessonId, reload]);

  // 真实模式需用真实 ClassSession id 连 WS(契约 LessonDto.sessionId,GET /lessons/:id 返回);
  // 无在开会话(sessionId=null)则不连,渲染时给出提示。mock 模式流自带帧,sessionId 仅占位。
  const sessionId = lesson?.sessionId ?? null;
  const noSession = lesson != null && !useMock && sessionId == null;

  useEffect(() => {
    if (lesson == null) return; // 等讲次加载,拿到真实 sessionId 再决定是否连
    if (!useMock && sessionId == null) return; // 真实模式无进行中会话:不连 WS,避免 join 报错
    setConnectTimedOut(false);
    // 真实模式以本课教师身份 class:join 进监控房(sessionId=真实 ClassSession id)
    const source = createMonitorSource({ sessionId: sessionId ?? lessonId, token: getToken() });
    sourceRef.current = source;
    const stop = source.connect({
      onRoster: (e) => {
        setConnected(true);
        // 增量合并:未变化的学生沿用旧引用,memo 卡片不重渲(不闪烁)
        setParticipants((prev) => mergeRoster(prev, e.participants));
      },
      onAlert: (e) => setAlerts((prev) => pushAlerts(prev, [e], Date.now())),
      // join 成功即视为已连上(此前只等首帧 roster:仅作业环节的会话不推 roster → 骨架屏永远转,走查 B-5)
      onSnapshot: (snap) => {
        setConnected(true);
        setSessionStatus(snap.session.status);
        setSegments(snap.session.segments);
        setCurrentSeg(snap.session.currentSegmentSeq);
      },
      onControl: (c) => {
        if (c.action === 'pause') setSessionStatus('paused');
        else if (c.action === 'resume') setSessionStatus('live');
        else if (c.action === 'end') setSessionStatus('ended');
        else if (c.action === 'force_segment') setCurrentSeg(c.segmentSeq);
      },
      onException: (msg) => toast(msg, { variant: 'error' }),
    });
    // mock 流 5s 一帧、真实 WS 握手也是秒级;15s 还没首帧就是连不上,给提示别让骨架屏永远转
    const timer = setTimeout(() => setConnectTimedOut(true), CONNECT_TIMEOUT_MS);
    return () => { clearTimeout(timer); stop(); sourceRef.current = null; };
  }, [lessonId, sessionId, useMock, lesson, reload]);

  const control = (c: ClassControl) => {
    sourceRef.current?.control(c);
    // 乐观更新:服务端广播回来会再同步一次;mock 源直接回显
    if (c.action === 'pause') setSessionStatus('paused');
    if (c.action === 'resume') setSessionStatus('live');
    if (c.action === 'force_segment') setCurrentSeg(c.segmentSeq);
  };
  const endClass = () => {
    control({ action: 'end' });
    setSessionStatus('ended');
    setConfirmEnd(false);
    toast('已下课:随堂练已入账,课后作业已推送给学生', { variant: 'success' });
  };
  const ended = sessionStatus === 'ended';
  const paused = sessionStatus === 'paused';

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

      {connected && !lessonError && !noSession && (
        <div className={`mb-4 flex flex-wrap items-center gap-2.5 rounded-lg border px-4 py-3 shadow-card ${ended ? 'border-line bg-bg' : paused ? 'border-orange bg-orange-soft' : 'border-line bg-card'}`}>
          <b className="text-[13.5px]">课堂控场</b>
          {ended ? (
            <Tag tone="gray">课堂已结束 · 学生端已收到小结</Tag>
          ) : (
            <Tag tone={paused ? 'orange' : 'green'}>{paused ? '已暂停(学生端遮罩中)' : '进行中'}</Tag>
          )}
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {segments.length > 0 && (
              <label className="flex items-center gap-1.5 text-[12.5px] text-ink-2">
                切环节
                <select
                  value={currentSeg ?? ''}
                  disabled={ended}
                  aria-label="强制切换全班环节"
                  onChange={(e) => { const seq = Number(e.target.value); if (seq) control({ action: 'force_segment', segmentSeq: seq }); }}
                  className="rounded-[10px] border-[1.5px] border-line bg-card px-2.5 py-[6px] text-[13px] text-ink outline-none focus:border-primary"
                >
                  <option value="">(不强制)</option>
                  {segments.map((sg) => <option key={sg.seq} value={sg.seq}>{sg.seq} · {SEGMENT_LABEL[sg.type]}</option>)}
                </select>
              </label>
            )}
            {paused ? (
              <Button variant="primary" disabled={ended} onClick={() => control({ action: 'resume' })}>继续上课</Button>
            ) : (
              <Button disabled={ended} onClick={() => control({ action: 'pause' })} title="学生端整屏遮罩「老师暂停了课堂」">暂停</Button>
            )}
            <Button variant="primary" disabled={ended} className={ended ? '' : '!bg-red !border-red hover:!bg-red'} onClick={() => setConfirmEnd(true)}>下课</Button>
          </div>
        </div>
      )}

      <Modal
        open={confirmEnd}
        title="确认下课?"
        onClose={() => setConfirmEnd(false)}
        footer={(
          <>
            <Button onClick={() => setConfirmEnd(false)}>再等等</Button>
            <Button variant="primary" onClick={endClass}>确认下课</Button>
          </>
        )}
      >
        <p className="text-sm leading-7 text-ink-2">下课后:随堂练未交的自动交卷入账,挂在本讲的课后作业推送给全班,学生端进入课堂小结。课堂结束后不能再进入。</p>
      </Modal>

      {lessonError ? (
        <div className="rounded-lg border border-line bg-card shadow-card">
          <EmptyState
            icon="⚠"
            text="讲次信息加载失败"
            hint="拿不到讲次就无法判断课堂是否在进行中,请重试"
            action={<Button variant="primary" onClick={() => setReload((n) => n + 1)}>重新加载</Button>}
          />
        </div>
      ) : noSession ? (
        <div className="rounded-lg border border-line bg-card shadow-card">
          <EmptyState
            icon="◷"
            text="课堂未开始"
            hint="该讲次暂无进行中的课堂会话;待教师发布/开课后,这里实时显示每个学生的进度。"
          />
        </div>
      ) : !connected && connectTimedOut ? (
        <div className="rounded-lg border border-line bg-card shadow-card">
          <EmptyState
            icon="⚠"
            text="课堂实时数据未连上"
            hint="已等待 15 秒仍未收到首帧。可能是网络波动或课堂会话已结束,可重试连接。"
            action={<Button variant="primary" onClick={() => setReload((n) => n + 1)}>重新连接</Button>}
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
