/**
 * 学生视角播放器 · 全屏上课模式。
 *
 * 布局:双栏,主图恒定完整可见(控制条恒定高度,不因步骤增减而跳变),右栏讲解独立滚动;
 * 播放:开场读题屏(顺带完成浏览器语音的手势解锁)→ 步进 + 连播;
 *       自动推进有最小停留时间(无中文语音时靠字幕也能跟上,不会几秒刷完);
 *       动手/小问步在连播中停下提示"轮到你",无操作数秒后自动继续,一旦操作立即接管;
 * 竞态:导航令牌只在 goToStep/开关切换处递增;同步点击直接忽略;所有定时器随步清理。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { TexText } from '@qiming/ui';
import type { LectureScript } from './script-schema';
import { CanvasScene } from './CanvasScene';
import { evalTemplate } from './expr';
import { BrowserTts } from './tts';

const RATES = [1, 1.25, 1.5] as const;

export function Player({ script }: { script: LectureScript }) {
  const steps = script.steps;
  const [runId, setRunId] = useState(0); // 「从头演一遍」在 stepIndex 已为 0 时也能重启
  const [stepIndex, setStepIndex] = useState(0);
  const [paramTargets, setParamTargets] = useState<Record<string, number>>(() => initialParams(script));
  const [grabParam, setGrabParam] = useState<string | null>(null);
  const [autoplay, setAutoplay] = useState(true);
  const [voiceOn, setVoiceOn] = useState(true);
  const [subOn, setSubOn] = useState(true);
  const [rateIdx, setRateIdx] = useState(0);
  const [speaking, setSpeaking] = useState(false);
  const [nudge, setNudge] = useState(false);
  const [quizPick, setQuizPick] = useState<Record<string, number | null>>({});
  const [scaffoldLevel, setScaffoldLevel] = useState<Record<string, number>>({});

  const tts = useMemo(() => new BrowserTts(), []);
  const step = steps[stepIndex];
  const navToken = useRef(0);
  const interacted = useRef(false);
  const railRef = useRef<HTMLElement>(null);
  const flags = useRef({ autoplay, voiceOn });
  useEffect(() => {
    flags.current = { autoplay, voiceOn };
  });
  useEffect(() => () => tts.dispose(), [tts]);

  // ── 按步重放(幂等):元素透明度 + 剧本参数(sweep 落到终值) ──
  const { alphaTargets, highlights, scriptedParams } = useMemo(() => {
    const alpha: Record<string, number> = {};
    for (const e of script.scene.elements) alpha[e.id] = e.hidden ? 0 : 1;
    const params = initialParams(script);
    for (let i = 0; i <= stepIndex; i++) {
      for (const a of steps[i].sceneActions) {
        if (a.op === 'show') alpha[a.target] = 1;
        else if (a.op === 'hide') alpha[a.target] = 0;
        else if (a.op === 'setParam') params[a.param] = a.value;
        else if (a.op === 'sweepParam' && i < stepIndex) params[a.param] = a.to;
      }
    }
    const hl = new Set<string>();
    for (const a of steps[stepIndex].sceneActions) if (a.op === 'highlight') hl.add(a.target);
    return { alphaTargets: alpha, highlights: hl, scriptedParams: params };
  }, [script, steps, stepIndex]);

  const goToStep = (i: number) => {
    const clamped = Math.max(0, Math.min(steps.length - 1, i));
    if (clamped === stepIndex) {
      setRunId((r) => r + 1);
      return;
    }
    navToken.current++;
    tts.stop();
    setSpeaking(false);
    setNudge(false);
    setStepIndex(clamped);
  };

  // ── 进入新步:剧本参数 → 引擎目标;sweep 扫描;朗读 + 最小停留 + 连播/轮到你 ──
  // (进入本页的那次点击已完成语音手势解锁,挂载即自动开讲,无需单独的"开始"按钮)
  useEffect(() => {
    railRef.current?.scrollTo({ top: 0 });
    setParamTargets((prev) => ({ ...prev, ...scriptedParams }));
    const token = ++navToken.current;
    const timers: number[] = [];
    let sweepRaf = 0;
    const current = steps[stepIndex];
    interacted.current = false;
    setNudge(false);

    const sweep = current.sceneActions.find((a) => a.op === 'sweepParam');
    if (sweep && sweep.op === 'sweepParam') {
      const t0 = performance.now();
      const run = (now: number) => {
        if (navToken.current !== token) return;
        const u = Math.min((now - t0) / (sweep.seconds * 1000), 1);
        const s = u * u * (3 - 2 * u);
        setParamTargets((prev) => ({ ...prev, [sweep.param]: sweep.from + (sweep.to - sweep.from) * s }));
        if (u < 1) sweepRaf = requestAnimationFrame(run);
      };
      sweepRaf = requestAnimationFrame(run);
    }

    const hold = Boolean(current.interaction || current.quiz);
    const minDwell = Math.max(3500, current.narration.length * 170);
    const tStart = Date.now();

    // 讲完(或无语音)后的推进:未到最小停留先等;动手/小问步提示"轮到你",6 秒无操作自动继续
    const proceed = () => {
      if (navToken.current !== token || !flags.current.autoplay || stepIndex >= steps.length - 1) return;
      const wait = Math.max(750, minDwell - (Date.now() - tStart));
      if (!hold) {
        timers.push(
          window.setTimeout(() => {
            if (navToken.current === token) setStepIndex(stepIndex + 1);
          }, wait),
        );
      } else {
        timers.push(
          window.setTimeout(() => {
            if (navToken.current !== token || interacted.current) return;
            setNudge(true);
            timers.push(
              window.setTimeout(() => {
                if (navToken.current === token && !interacted.current) setStepIndex(stepIndex + 1);
              }, 6000),
            );
          }, wait),
        );
      }
    };

    if (flags.current.voiceOn && tts.available) {
      setSpeaking(true);
      void tts.speak(current.narration).then(() => {
        if (navToken.current === token) setSpeaking(false);
        proceed();
      });
    } else {
      proceed();
    }
    return () => {
      timers.forEach((t) => window.clearTimeout(t));
      cancelAnimationFrame(sweepRaf);
      tts.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepIndex, runId]);

  // 键盘翻步(焦点在输入控件上时不抢)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        goToStep(stepIndex + 1);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        goToStep(stepIndex - 1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepIndex]);

  // 滑杆拖拽的松手兜底(指针移出滑杆后松手,input 上收不到 pointerup)
  useEffect(() => {
    const clear = () => setGrabParam(null);
    window.addEventListener('pointerup', clear);
    window.addEventListener('pointercancel', clear);
    return () => {
      window.removeEventListener('pointerup', clear);
      window.removeEventListener('pointercancel', clear);
    };
  }, []);

  const replay = () => {
    navToken.current++; // 作废原有推进链,重听后由用户决定何时继续
    tts.stop();
    setNudge(false);
    if (flags.current.voiceOn && tts.available) {
      const token = navToken.current;
      setSpeaking(true);
      void tts.speak(step.narration).then(() => {
        if (navToken.current === token) setSpeaking(false);
      });
    }
  };

  const cycleRate = () => {
    const next = (rateIdx + 1) % RATES.length;
    setRateIdx(next);
    tts.setRate(1.05 * RATES[next]);
  };

  const takeOver = () => {
    interacted.current = true;
    setNudge(false);
  };

  const interaction = step.interaction;
  const iParam = interaction ? script.scene.params.find((p) => p.id === interaction.paramId) : undefined;
  const quiz = step.quiz;
  const picked = quizPick[step.id] ?? null;
  const level = scaffoldLevel[step.id] ?? 0;
  const noZhVoice = voiceOn && tts.available && !tts.hasChineseVoice();
  const isProblem = script.kind === 'problem' && script.problem;


  return (
    <div className="dl-grid">
      {/* ── 左:主图 + 控制 ── */}
      <section className="dl-scene">
        {noZhVoice && (
          <div className="dl-banner">本机没有中文语音,已按字幕模式讲解(接入真人声后自动恢复)。</div>
        )}
        <div className="dl-frame">
          <CanvasScene
            scene={script.scene}
            paramTargets={paramTargets}
            alphaTargets={alphaTargets}
            highlights={highlights}
            grabParam={grabParam}
          />
          <div className="dl-caption">
            第 {stepIndex + 1} / {steps.length} 步{step.label ? ` · ${step.label}` : ''}
          </div>
        </div>

        <div className="dl-controls" aria-hidden={!iParam}>
          {iParam && (
            <>
          <div className="dl-row">
            <span className="dl-name">{iParam.label}</span>
            <input
                type="range"
                min={iParam.min}
                max={iParam.max}
                step={iParam.step}
                value={paramTargets[iParam.id] ?? iParam.initial}
                onPointerDown={() => {
                  setGrabParam(iParam.id);
                  takeOver();
                }}
                onChange={(e) => {
                  takeOver();
                  setParamTargets((prev) => ({ ...prev, [iParam.id]: Number(e.target.value) }));
                }}
                aria-label={iParam.label}
              />
            <em className="dl-val">
              {(paramTargets[iParam.id] ?? iParam.initial).toFixed(1)}
              {iParam.unit ?? ''}
            </em>
            {interaction?.targetValue !== undefined && (
              <button
                type="button"
                className="dl-btn go"
                onClick={() => {
                  takeOver();
                  setParamTargets((prev) => ({ ...prev, [iParam.id]: interaction.targetValue! }));
                }}
              >
                调到 {interaction.targetValue}
                {iParam.unit ?? ''}
              </button>
            )}
          </div>
          <p className="dl-hint">{interaction?.prompt}</p>
          {interaction?.feedback && (
            <p className="dl-feedback">
              {evalTemplate(
                interaction.feedback,
                { ...paramTargets },
                ['x', ...script.scene.params.map((p) => p.id)],
              )}
            </p>
          )}
            </>
          )}
          {nudge && (
            <p className="dl-nudge">
              轮到你了——{quiz ? '猜一猜右边的小问,' : ''}
              {iParam ? '拖一下滑杆试试。' : ''}不想动手的话,几秒后我接着讲。
            </p>
          )}
        </div>

        <div className="dl-actions">
          <button type="button" className="dl-btn" onClick={() => goToStep(stepIndex - 1)} disabled={stepIndex === 0}>
            ← 上一步
          </button>
          <button
            type="button"
            className="dl-btn on"
            onClick={() => goToStep(stepIndex + 1)}
            disabled={stepIndex === steps.length - 1}
          >
            下一步 →
          </button>
          <button type="button" className="dl-btn ghost" onClick={replay}>
            重听本拍
          </button>
          <span className="dl-spacer" />
          <button type="button" className="dl-btn" onClick={cycleRate}>
            倍速 ×{RATES[rateIdx]}
          </button>
          <button type="button" className={`dl-btn ${subOn ? 'on' : ''}`} onClick={() => setSubOn(!subOn)}>
            字幕
          </button>
          <button
            type="button"
            className={`dl-btn ${voiceOn ? 'on' : ''}`}
            onClick={() => {
              navToken.current++; // 静音不等于讲完,冻结本步推进
              if (voiceOn) tts.stop();
              setSpeaking(false);
              setVoiceOn(!voiceOn);
            }}
          >
            {voiceOn ? (speaking ? '讲解中…' : '语音 开') : '语音 关'}
          </button>
          <button
            type="button"
            className={`dl-btn ${autoplay ? 'on' : ''}`}
            onClick={() => {
              navToken.current++;
              setAutoplay(!autoplay);
            }}
          >
            {autoplay ? '连播 开' : '连播 关'}
          </button>
        </div>
      </section>

      {/* ── 右:讲解栏(独立滚动) ── */}
      <aside className="dl-talk" ref={railRef}>
        {isProblem && (
        <details className="dl-stem">
          <summary>原题(点开看全文)</summary>
          <div className="dl-stem-body">
            <TexText src={isProblem ? script.problem!.text : ''} />
          </div>
        </details>
        )}

        <ol className="dl-rail">
          {steps.map((s, i) => (
            <li key={s.id}>
              <button
                type="button"
                className={i === stepIndex ? 'active' : i < stepIndex ? 'done' : ''}
                onClick={() => goToStep(i)}
              >
                <i>{String(i + 1).padStart(2, '0')}</i>
                {s.label}
                {(s.interaction || s.quiz) && <span className="dl-dot" aria-label="有互动" />}
              </button>
            </li>
          ))}
        </ol>

        <div className="dl-narr">
          <small>{speaking ? '正在讲' : '本步讲解'}</small>
          <div className="dl-narr-body">
            <TexText src={step.display} />
          </div>
          {(subOn || noZhVoice || !voiceOn) && <p className="dl-sub-line">{step.narration}</p>}
        </div>

        {quiz && (
          <div className="dl-block">
            <small>猜一猜(不答也能继续)</small>
            <p className="dl-q">{quiz.question}</p>
            {quiz.options.map((opt, i) => {
              const revealed = picked !== null;
              const cls = revealed && i === quiz.answerIndex ? 'yes' : revealed && i === picked ? 'no' : '';
              return (
                <button
                  key={`${step.id}-${i}`}
                  type="button"
                  disabled={revealed}
                  className={`dl-choice ${picked === i ? 'picked' : ''} ${cls}`}
                  onClick={() => {
                    takeOver();
                    setQuizPick((prev) => ({ ...prev, [step.id]: i }));
                  }}
                >
                  {opt}
                </button>
              );
            })}
            {picked !== null && (
              <div className="dl-reveal">
                <TexText src={quiz.reveal} />
              </div>
            )}
          </div>
        )}

        {step.scaffolds && (
          <div className="dl-block">
            <small>卡住了?</small>
            {level > 0 &&
              step.scaffolds.slice(0, level).map((s, i) => (
                <div key={`${step.id}-sc-${i}`} className="dl-reveal">
                  <b>{['看哪里', '用什么关系', '完整提示'][i]}</b>
                  <TexText src={s} />
                </div>
              ))}
            {level < 3 && (
              <button
                type="button"
                className="dl-btn"
                onClick={() => {
                  takeOver();
                  setScaffoldLevel((prev) => ({ ...prev, [step.id]: level + 1 }));
                }}
              >
                {level === 0 ? '给我一点提示' : level === 1 ? '再给一点' : '直接告诉我'}
              </button>
            )}
            {level > 0 && <span className="dl-note">已用 {level}/3 级提示</span>}
          </div>
        )}
      </aside>
    </div>
  );
}

function initialParams(script: LectureScript): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of script.scene.params) out[p.id] = p.initial;
  return out;
}
