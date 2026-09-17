/**
 * 动画卡 —— shared/protocol.md「动画桥」三条路:
 *  - template:同源直接挂 LectureScene.templates[id].mount(),action 直接 scene.applyAction
 *  - html:sandbox="allow-scripts" iframe + srcDoc,postMessage 桥(lecture:ready / do / unlock / reset)
 *  - static:直接渲染降级 SVG,不可交互
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { AnimController } from '../../board-context';
import { useBoard } from '../../board-context';
import { animIframeHeight, withBaseCss } from '../../lib/html-anim';
import { baseTargetsFor, loadLectureScene, type LectureSceneHandle } from '../../lib/lecture-scene';
import { sanitizePurpose } from '../../lib/purpose';
import type { Animation } from '../../types';

export function AnimationCard({ anim }: { anim: Animation }) {
  const badge = anim.kind === 'template' ? `模板 · ${anim.template ?? ''}` : anim.kind === 'html' ? '沙箱 HTML' : '静态降级';
  // 已存的老剧本可能把「动作名:rotate(...)」这类实现细节写进了 purpose,渲染前兜底截掉(见 lib/purpose.ts)
  const purpose = sanitizePurpose(anim.purpose);
  return (
    <>
      <span className="anim-badge">{badge}</span>
      {anim.status === 'pending' ? (
        <div className="figure-skeleton" style={{ height: 230 }} />
      ) : anim.status === 'failed' ? (
        <div className="figure-failed">动画生成失败:{anim.error ?? '未知原因'}(旁白照讲)</div>
      ) : anim.kind === 'template' ? (
        <TemplateScene anim={anim} />
      ) : anim.kind === 'html' ? (
        <HtmlScene anim={anim} />
      ) : (
        <StaticScene anim={anim} />
      )}
      {purpose && <div className="anim-purpose">{purpose}</div>}
    </>
  );
}

/* --------------------------- template --------------------------- */

function TemplateScene({ anim }: { anim: Animation }) {
  const host = useRef<HTMLDivElement>(null);
  const { registerAnim, script } = useBoard();
  const [error, setError] = useState<string | null>(null);

  /** 剧本自己 show / draw 过哪些层 —— 这些不用兜底,交给剧本按节奏放。 */
  const scriptShown = useMemo(() => {
    const out = new Set<string>();
    for (const step of script.steps) {
      for (const item of step.flow) {
        if (!('do' in item) || item.do !== 'anim' || item.target !== anim.id) continue;
        const type = String(item.action.type ?? '');
        const target = item.action.target;
        if ((type === 'show' || type === 'draw') && typeof target === 'string') out.add(target);
      }
    }
    return out;
  }, [script.steps, anim.id]);

  useEffect(() => {
    let disposed = false;
    let scene: LectureSceneHandle | null = null;
    let autoShow: string[] = [];
    let shown = false;
    const queued: Array<() => Promise<void>> = [];

    /**
     * 模板的层默认 opacity 0,要靠 show / draw 点亮。真剧本里有的只发 run(浮力题)、
     * 有的只 show 了一条线段(圆题),底图就一直是空的。兜底:第一个动作到达前,
     * 把「剧本自己不管」的底图层瞬时点亮 —— 剧本写全了的话这里是空集,不干扰。
     */
    const ensureShown = async () => {
      if (shown || !scene) return;
      shown = true;
      for (const t of autoShow) await scene.applyAction({ type: 'show', target: t, durationMs: 0 }, {});
    };

    const ctrl: AnimController = {
      kind: 'template',
      async apply(action, opts) {
        const run = async () => {
          if (!scene) return;
          await ensureShown();
          // 跳步补齐:时长归零;run 的分段过程动画换成 settle(直接按判据落位)
          const act = opts.instant
            ? { ...action, durationMs: 0, ...(action.type === 'run' ? { phase: 'settle' } : null) }
            : action;
          await scene.applyAction(act, {});
        };
        if (!scene) {
          queued.push(run);
          return;
        }
        await run();
      },
      unlock(params) {
        scene?.setUnlocked(params);
      },
      reset() {
        void scene?.applyAction({ type: 'reset' }, {});
      },
    };
    const unregister = registerAnim(anim.id, ctrl);

    void loadLectureScene()
      .then(async (ns) => {
        if (disposed || !host.current) return;
        const tpl = ns.templates[anim.template ?? ''];
        if (!tpl) throw new Error(`未知模板:${anim.template}`);
        // 剧本一个 show/draw 都没发 → 整套底图放出来;剧本在管显隐 → 只补 manifest 明说的底图层,
        // 免得把它故意没显示的层(浮力题的桌面、读数面板)也翻出来。
        const drawBase = await baseTargetsFor(anim.template ?? '');
        autoShow = scriptShown.size
          ? drawBase.filter((t) => !scriptShown.has(t))
          : drawBase.length
            ? drawBase
            : (tpl.targets ?? []);
        if (disposed || !host.current) return;
        host.current.innerHTML = '';
        scene = tpl.mount(host.current, (anim.params ?? {}) as Record<string, unknown>, {});
        scene.setUnlocked([]);
        for (const job of queued.splice(0)) await job();
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));

    return () => {
      disposed = true;
      unregister();
      scene?.destroy?.();
    };
  }, [anim.id, anim.template, anim.params, registerAnim, scriptShown]);

  if (error) return <div className="figure-failed">{error}</div>;
  return <div className="anim-host" ref={host} />;
}

/* ----------------------------- html ----------------------------- */

function HtmlScene({ anim }: { anim: Animation }) {
  const wrap = useRef<HTMLDivElement>(null);
  const ref = useRef<HTMLIFrameElement>(null);
  const { registerAnim } = useBoard();
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [message, setMessage] = useState('');
  // 卡宽会随列宽/画布缩放变化,iframe 高度跟着按 16:10 算,不用写死的一个数(README「已知待改」1)
  const [height, setHeight] = useState(280);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth;
      if (w > 0) setHeight(animIframeHeight(w));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const srcDoc = useMemo(() => withBaseCss(anim.html), [anim.html]);

  useEffect(() => {
    let ready = false;
    const queue: Array<Record<string, unknown>> = [];
    const post = (msg: Record<string, unknown>) => ref.current?.contentWindow?.postMessage(msg, '*');

    const onMessage = (ev: MessageEvent) => {
      if (!ref.current || ev.source !== ref.current.contentWindow) return;
      const data = ev.data as { type?: string; message?: string };
      if (data?.type === 'lecture:ready') {
        ready = true;
        setStatus('ready');
        for (const m of queue.splice(0)) post(m);
      } else if (data?.type === 'lecture:error') {
        setStatus('error');
        setMessage(data.message ?? '动画内部报错');
      }
    };
    window.addEventListener('message', onMessage);

    const send = (msg: Record<string, unknown>) => {
      if (ready) post(msg);
      else queue.push(msg);
    };
    const unregister = registerAnim(anim.id, {
      kind: 'html',
      async apply(action) {
        // html 动画只接受 {type:'do', name, params}(schema.ts)
        if (action.type !== 'do' || typeof action.name !== 'string') return;
        send({ type: 'lecture:do', name: action.name, params: action.params });
      },
      unlock(params) {
        send({ type: 'lecture:unlock', params });
      },
      reset() {
        send({ type: 'lecture:reset' });
      },
    });

    return () => {
      window.removeEventListener('message', onMessage);
      unregister();
    };
  }, [anim.id, registerAnim]);

  return (
    <div ref={wrap} style={{ position: 'relative' }}>
      <iframe
        ref={ref}
        className="anim-iframe"
        title={sanitizePurpose(anim.purpose) || '动画'}
        srcDoc={srcDoc}
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
        style={{ height }}
      />
      {status === 'loading' && <div className="anim-purpose">动画加载中…(等 lecture:ready)</div>}
      {status === 'error' && <div className="figure-failed">{message}</div>}
    </div>
  );
}

/* ---------------------------- static ---------------------------- */

function StaticScene({ anim }: { anim: Animation }) {
  const { registerAnim } = useBoard();
  useEffect(
    () =>
      registerAnim(anim.id, {
        kind: 'static',
        async apply() {
          /* 静态降级:动作无效,旁白照讲 */
        },
        unlock() {},
        reset() {},
      }),
    [anim.id, registerAnim],
  );
  if (!anim.svg) return <div className="figure-failed">静态降级图缺失</div>;
  return <div className="anim-host" dangerouslySetInnerHTML={{ __html: anim.svg }} />;
}
