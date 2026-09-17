/**
 * 讲题页:进度 → 剧本到达 → 白板开讲。
 * 调度器(lib/flow.ts)只通过 BoardApi 碰白板,不认识 excalidraw。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BoardContext, type AnimController } from '../board-context';
import { ExcalidrawBoard, type BoardApi } from '../board/ExcalidrawBoard';
import { NarrationPanel, type NarrationEntry, type NarrationInput } from '../components/Narration';
import { PlanningProgress, type StageRow } from '../components/PlanningProgress';
import { TopBar } from '../components/TopBar';
import { connectEvents } from '../lib/api';
import { FlowScheduler, type PlayerHost, type SchedulerPhase } from '../lib/flow';
import { setSceneClockPaused } from '../lib/lecture-scene';
import { buildIndex, resolveRevealTargets } from '../lib/script-index';
import { Speaker } from '../lib/speaker';
import { Waiter } from '../lib/waiter';
import type { BoardScript, LessonStage, LessonState, ServerEvent } from '../types';

declare global {
  interface Window {
    /** 截图脚本 / 调试用的钩子(见 web/README.md) */
    __board?: {
      ready: boolean;
      seek(stepIndex: number, flowIndex: number): Promise<void>;
      summary(): Promise<void>;
      setMuted(muted: boolean): void;
      deliverFigure(id?: string): void;
      focus(target: string): void;
      elements(): Array<{ id: string; type: string; x: number; y: number; w: number; h: number }>;
    };
  }
}

export function LessonPage({
  lessonId,
  mockScript,
  onBack,
}: {
  lessonId: string | null;
  mockScript?: BoardScript;
  onBack(): void;
}) {
  const [script, setScript] = useState<BoardScript | null>(mockScript ?? null);
  const [stages, setStages] = useState<Partial<Record<LessonStage, StageRow>>>({});
  const [error, setError] = useState<string | null>(null);
  const [connection, setConnection] = useState<'open' | 'reconnecting'>('open');

  const [revealed, setRevealed] = useState<ReadonlySet<string>>(new Set());
  /** 讲到哪、亮到哪(protocol.md 播放器时序 §2):正在讲的目标(念完 300ms 淡出,同一时刻只有一组) */
  const [speaking, setSpeaking] = useState<ReadonlySet<string>>(new Set());
  /** emph 念完留下的痕迹:mark → 黄底持续显示(卡片按 props 渲染);circle → 另见 boardRef.keepCircle */
  const [kept, setKept] = useState<ReadonlyMap<string, 'mark' | 'circle'>>(new Map());
  const [entries, setEntries] = useState<NarrationEntry[]>([]);
  const [explore, setExplore] = useState<{ animationId: string; unlock: string[]; tasks: string[] } | null>(null);
  const [phase, setPhase] = useState<SchedulerPhase>('idle');
  const [stepIndex, setStepIndex] = useState(-1);
  const [rate, setRate] = useState(1);
  const [muted, setMuted] = useState(false);
  const [zoom, setZoom] = useState(0.72);

  const boardRef = useRef<BoardApi>(null);
  const anims = useRef(new Map<string, Set<AnimController>>());
  const waiter = useRef(new Waiter());
  const scriptRef = useRef<BoardScript | null>(script);
  scriptRef.current = script;
  const speaker = useRef(new Speaker(() => scriptRef.current?.audio));
  const schedulerRef = useRef<FlowScheduler | null>(null);
  const uid = useRef(0);

  const index = useMemo(() => (script ? buildIndex(script) : null), [script]);

  /* --------------------------- 旁白流 --------------------------- */

  const push = useCallback((entry: NarrationInput) => {
    setEntries((prev) => [...prev, { ...entry, uid: ++uid.current }]);
  }, []);

  /** 「总结」「动手」这类分段标题全程只追加一次 */
  const segmentsPushed = useRef(new Set<string>());

  /* --------------------------- 卡片浮现 --------------------------- */

  const applyReveal = useCallback(
    (target: string, opts: { instant: boolean }) => {
      setRevealed((prev) => {
        const next = new Set(prev);
        for (const t of index ? resolveRevealTargets(index, target) : [target]) next.add(t);
        return next;
      });
      // 视口跟随:整卡浮现时把卡带进视野(已经看得见就不动);逐行浮现时卡已经在视野里
      if (!opts.instant && index?.cards.has(target)) {
        window.setTimeout(() => boardRef.current?.focus(target, { align: 'ensure' }), 60);
      }
    },
    [index],
  );

  /**
   * 动作流水:动画卡不一定比动作先就位 —— 跳步补齐是同步跑完的(卡还没 mount)、
   * 素材可能后到、Excalidraw 也会把卡移出场景再挂回来。
   * 每张动画卡一注册就把已发生的动作瞬时重放一遍,场景直接追到当前状态。
   */
  const animLog = useRef(new Map<string, Array<Record<string, unknown>>>());

  /** 同一个 animationId 可能挂在多张卡上(正方形题的动画在第(2)问和动手列各放了一张),都要跟着动。 */
  const registerAnim = useCallback((id: string, ctrl: AnimController) => {
    const set = anims.current.get(id) ?? new Set<AnimController>();
    set.add(ctrl);
    anims.current.set(id, set);
    const history = animLog.current.get(id);
    if (history?.length) {
      void (async () => {
        for (const action of history) await ctrl.apply(action, { instant: true });
      })();
    }
    return () => {
      set.delete(ctrl);
    };
  }, []);

  /* --------------------------- 调度器 --------------------------- */

  /**
   * 调度器只在「剧本本体」变化时重建。
   * 素材事件(figure / animation / audio)会生成新的 script 对象,但 steps/cards/columns
   * 的引用不变 —— 若按 script 重建,配图一到达就会把正在播的讲解掐掉。
   */
  const steps = script?.steps;

  useEffect(() => {
    const script = scriptRef.current;
    if (!script || !steps) return;
    const host: PlayerHost = {
      reveal(target, opts) {
        boardRef.current?.reveal(target, opts);
      },
      say(req) {
        push({ kind: 'say', text: req.text });
        return speaker.current.speak(req);
      },
      async anim(target, action, opts) {
        // 跳步补齐时是把历史动作重放一遍,不该往旁白流里再记一串 🎞
        if (!opts.instant) {
          push({
            kind: 'note',
            icon: '🎞',
            text: `动画:${String(action.type ?? 'do')}${action.phase ? ` ${String(action.phase)}` : ''}`,
          });
        }
        const history = animLog.current.get(target) ?? [];
        history.push(action);
        animLog.current.set(target, history);
        const ctrls = anims.current.get(target);
        if (!ctrls?.size) return; // 卡还没就位,注册时会重放,不挡讲解
        for (const ctrl of ctrls) await ctrl.apply(action, opts);
      },
      fx(item) {
        boardRef.current?.fx({ kind: item.fx, target: item.target, snippet: item.snippet, color: item.color });
      },
      speaking(targets, active) {
        setSpeaking(active ? new Set(targets) : new Set());
      },
      keep(targets, emph) {
        if (!targets.length) return;
        setKept((prev) => {
          const next = new Map(prev);
          for (const t of targets) next.set(t, emph);
          return next;
        });
        // circle 由画布适配层画(复用 fx:circle 的 ellipse 实现);mark 纯 CSS,卡片组件自己按 kept 渲染
        if (emph === 'circle') for (const t of targets) boardRef.current?.keepCircle(t);
      },
      focus(target) {
        boardRef.current?.focus(target);
      },
      wait(ms) {
        return waiter.current.wait(ms);
      },
      onStepStart(step, i) {
        setStepIndex(i);
        boardRef.current?.clearFx();
        const col = scriptRef.current?.columns.find((c) => c.id === step.col);
        push({ kind: 'segment', icon: '✎', label: col?.title ?? step.title });
      },
      onPhase(p) {
        setPhase(p);
        // 分段标题只追加一次:反复进终态(连点「下一步」)不该把右栏刷成一串重复
        if (p === 'takeaways' && !segmentsPushed.current.has('takeaways')) {
          segmentsPushed.current.add('takeaways');
          push({ kind: 'segment', icon: '📋', label: '总结' });
        }
      },
    };
    const scheduler = new FlowScheduler(script, host);
    schedulerRef.current = scheduler;
    return () => {
      scheduler.cancel();
      speaker.current.stopAll();
      waiter.current.flush();
    };
  }, [steps, push]);

  /* ------------------------ 动手环节:解锁手柄 ------------------------ */

  useEffect(() => {
    if (phase !== 'explore' || !script?.explore) return;
    setExplore(script.explore);
    if (!segmentsPushed.current.has('explore')) {
      segmentsPushed.current.add('explore');
      push({ kind: 'segment', icon: '🖐', label: '动手' });
    }
    for (const ctrl of anims.current.get(script.explore.animationId) ?? []) ctrl.unlock(script.explore.unlock);
  }, [phase, script, push]);

  /* ------------------------------ 控件 ------------------------------ */

  const start = useCallback(() => {
    void schedulerRef.current?.run(0);
  }, []);

  // 暂停要连动画一起冻住:lecture-scene 的所有补间都走它自己的 Clock
  const pause = useCallback(() => {
    schedulerRef.current?.pause();
    waiter.current.pause();
    setSceneClockPaused(true);
  }, []);

  const resume = useCallback(() => {
    waiter.current.resume();
    setSceneClockPaused(false);
    schedulerRef.current?.resume();
  }, []);

  const onPlayPause = useCallback(() => {
    const s = schedulerRef.current;
    if (!s) return;
    if (s.phase === 'idle') return start();
    if (s.isPaused) return resume();
    return pause();
  }, [pause, resume, start]);

  /** 跳步会把之前的动作重新补一遍,旧流水先清掉,免得重放时重复。 */
  const resetAnimLog = useCallback(() => {
    animLog.current.clear();
    for (const set of anims.current.values()) for (const ctrl of set) ctrl.reset();
  }, []);

  /** 跳步前的清场:掐掉当前这句、放行等待、清红圈、清动作流水 */
  const beforeJump = useCallback(() => {
    speaker.current.stopAll();
    waiter.current.flush();
    waiter.current.resume();
    boardRef.current?.clearFx();
    resetAnimLog();
  }, [resetAnimLog]);

  const goNext = useCallback(() => {
    const s = schedulerRef.current;
    if (!s || s.phase === 'explore') return; // 已经在终态,别重播最后一步
    beforeJump();
    void s.next();
  }, [beforeJump]);

  const goPrev = useCallback(() => {
    const s = schedulerRef.current;
    if (!s) return;
    beforeJump();
    void s.prev();
  }, [beforeJump]);

  useEffect(() => {
    speaker.current.setRate(rate);
  }, [rate]);

  useEffect(() => {
    speaker.current.setMuted(muted);
  }, [muted]);

  const onZoomButton = useCallback(
    (dir: -1 | 0 | 1) => {
      const b = boardRef.current;
      if (!b) return;
      b.setZoom(dir === 0 ? 0.72 : Math.round((b.getZoom() + dir * 0.1) * 100) / 100);
    },
    [],
  );

  /* ------------------------------ SSE ------------------------------ */

  const applyServerEvent = useCallback((e: ServerEvent) => {
    switch (e.type) {
      case 'snapshot':
        applyLessonState(e.state, setStages, setScript, setError);
        break;
      case 'stage':
        setStages((prev) => ({
          ...prev,
          [e.stage]: {
            status: e.status === 'start' ? 'running' : e.status === 'done' ? 'done' : 'error',
            ms: e.ms,
            message: e.message,
          },
        }));
        break;
      case 'script':
        setScript(e.script);
        break;
      case 'figure':
        setScript((prev) =>
          prev
            ? {
                ...prev,
                figures: prev.figures.map((f) => (f.id === e.id ? { ...f, status: e.status, src: e.src, error: e.error } : f)),
              }
            : prev,
        );
        setEntries((prev) => [...prev, { uid: ++uid.current, kind: 'note', icon: '🖼', text: '配图到达' }]);
        break;
      case 'animation':
        setScript((prev) =>
          prev
            ? {
                ...prev,
                animations: prev.animations.map((a) =>
                  a.id === e.id ? { ...a, status: e.status, kind: e.kind ?? a.kind, html: e.html ?? a.html, svg: e.svg ?? a.svg, error: e.error } : a,
                ),
              }
            : prev,
        );
        break;
      case 'audio':
        setScript((prev) =>
          prev
            ? {
                ...prev,
                audio: {
                  voice: prev.audio?.voice ?? { provider: 'unknown', voiceId: '', name: '' },
                  clips: { ...(prev.audio?.clips ?? {}), [e.key]: { text: e.text, src: e.src, durationMs: e.durationMs } },
                },
              }
            : prev,
        );
        break;
      case 'error':
        setError(e.message);
        break;
      case 'complete':
        setStages((prev) => ({ ...prev, assets: { status: 'done' } }));
        break;
    }
  }, []);

  useEffect(() => {
    if (!lessonId) return;
    const stream = connectEvents(lessonId, {
      onEvent: applyServerEvent,
      onStatus: setConnection,
    });
    return () => stream.close();
  }, [lessonId, applyServerEvent]);

  /* -------------------- mock:配图 6 秒后到达,演占位替换 -------------------- */

  const deliverFigure = useCallback((id?: string) => {
    setScript((prev) => {
      if (!prev) return prev;
      const target = id ?? prev.figures[0]?.id;
      if (!target) return prev;
      return {
        ...prev,
        figures: prev.figures.map((f) =>
          f.id === target ? { ...f, status: 'ready' as const, src: '/sample-problem.jpg' } : f,
        ),
      };
    });
  }, []);

  useEffect(() => {
    if (!mockScript) return;
    const t = window.setTimeout(() => deliverFigure(), 6000);
    return () => window.clearTimeout(t);
  }, [mockScript, deliverFigure]);

  /* ------------------------ 截图 / 调试钩子 ------------------------ */

  useEffect(() => {
    if (!script) return;
    window.__board = {
      ready: true,
      async seek(s, f) {
        speaker.current.setMuted(true);
        setMuted(true);
        waiter.current.flush();
        resetAnimLog();
        await schedulerRef.current?.seek(s, f);
        setStepIndex(s);
      },
      async summary() {
        speaker.current.setMuted(true);
        setMuted(true);
        beforeJump();
        await schedulerRef.current?.toEnd();
        const takeCard = script.cards.find((c) => c.kind === 'takeaways');
        if (takeCard) window.setTimeout(() => boardRef.current?.focus(takeCard.id), 400);
      },
      setMuted(m) {
        setMuted(m);
        speaker.current.setMuted(m);
      },
      deliverFigure,
      focus: (target: string) => boardRef.current?.focus(target),
      elements: () => boardRef.current?.dumpElements() ?? [],
    };
    return () => {
      delete window.__board;
    };
  }, [script, deliverFigure, resetAnimLog]);

  /* ------------------------------ 渲染 ------------------------------ */

  const playing = phase === 'playing' || phase === 'takeaways';
  const statusText =
    connection === 'reconnecting'
      ? '● 重连中'
      : phase === 'explore'
        ? '✓ 讲完了'
        : playing
          ? '● 讲解中'
          : undefined;

  if (!script) {
    return (
      <div className="app">
        <TopBar
          title="讲题白板"
          zoom={zoom}
          onZoom={() => {}}
          playing={false}
          canPlay={false}
          onPlayPause={() => {}}
          stepIndex={-1}
          stepCount={0}
          onPrev={() => {}}
          onNext={() => {}}
          rate={rate}
          onRate={setRate}
          muted={muted}
          onMute={() => setMuted((m) => !m)}
          onBack={onBack}
          status={connection === 'reconnecting' ? '● 重连中' : undefined}
        />
        <div className="main">
          <PlanningProgress stages={stages} error={error} connection={connection} />
        </div>
      </div>
    );
  }

  return (
    <BoardContext.Provider value={{ script, revealed, explore, registerAnim, speaking, kept }}>
      <div className="app">
        <TopBar
          title={script.title}
          zoom={zoom}
          onZoom={onZoomButton}
          playing={playing}
          canPlay
          onPlayPause={onPlayPause}
          stepIndex={stepIndex}
          stepCount={script.steps.length}
          canPrev={stepIndex > 0 || phase === 'explore' || phase === 'takeaways'}
          canNext={phase !== 'explore'}
          onPrev={goPrev}
          onNext={goNext}
          rate={rate}
          onRate={setRate}
          muted={muted}
          onMute={() => setMuted((m) => !m)}
          onBack={onBack}
          status={statusText}
        />
        <div className="main">
          <ExcalidrawBoard
            ref={boardRef}
            script={script}
            revealed={revealed}
            explore={explore}
            onReveal={applyReveal}
            onZoomChange={setZoom}
          />
          <NarrationPanel
            entries={entries}
            footer={error ?? (connection === 'reconnecting' ? '与服务端断开,正在重连…' : undefined)}
          />
        </div>
      </div>
    </BoardContext.Provider>
  );
}

function applyLessonState(
  state: LessonState,
  setStages: (fn: (prev: Partial<Record<LessonStage, StageRow>>) => Partial<Record<LessonStage, StageRow>>) => void,
  setScript: (s: BoardScript) => void,
  setError: (e: string | null) => void,
): void {
  setStages(() => {
    const out: Partial<Record<LessonStage, StageRow>> = {};
    for (const [stage, t] of Object.entries(state.timings ?? {})) {
      if (!t) continue;
      out[stage as LessonStage] = { status: t.endedAt ? 'done' : 'running', ms: t.ms };
    }
    return out;
  });
  if (state.script) setScript(state.script);
  if (state.error) setError(state.error);
}
