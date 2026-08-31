/**
 * 坐标系场景 · Canvas 运动引擎版。
 *
 * 引擎直接移植自已通过 17 项校验的知识点动画(public/animations/初中/一次函数参数实验.html,引擎 v2):
 * - 双轨状态:props 只写 target,画面用 current,每帧 approach 缓动 —— 任何变化都不闪现;
 * - 常驻 rAF 主循环,dt 夹 50ms(切标签页回来不瞬移);
 * - 元素透明度同样走缓动,曲线的透明度兼作"从左往右画出来"的进度;
 * - 台阶 + 行走标记:把变化率读成可数的抬升动作;
 * - 读数标注每帧按 current 参数求值,画面数值永远是活的。
 */
import { useEffect, useRef } from 'react';
import type { SceneSpec, SemanticColor } from './script-schema';
import { compileExpr, evalNumOrExpr, type CompiledExpr } from './expr';
import { PAPER } from '../shared/paper-shell';

const SEMANTIC: Record<SemanticColor, string> = {
  primary: PAPER.hiA,
  orange: PAPER.hiA,
  green: PAPER.hiB,
  violet: PAPER.hiC,
  red: PAPER.red,
  muted: PAPER.ink3,
};
const tokenOf = (c: SemanticColor | undefined, fallback: string) => (c ? SEMANTIC[c] : fallback);

const K_SMOOTH = 0.9;
const K_GRAB = 0.55;
const K_ALPHA = 0.86;

function approach(now: number, want: number, dt: number, k: number): number {
  return now + (want - now) * (1 - Math.pow(k, dt * 60));
}
function smoothstep(u: number): number {
  const c = u < 0 ? 0 : u > 1 ? 1 : u;
  return c * c * (3 - 2 * c);
}
const num = (v: number, d = 1) => v.toFixed(d);

export interface CanvasSceneProps {
  scene: SceneSpec;
  /** 目标参数值(步进动作 + 学生滑杆写入;引擎负责缓动) */
  paramTargets: Record<string, number>;
  /** 元素目标透明度(按步重放:显 1 / 隐 0) */
  alphaTargets: Record<string, number>;
  /** 当前步高亮的元素 */
  highlights: ReadonlySet<string>;
  /** 正被拖拽的参数(用跟手阻尼) */
  grabParam?: string | null;
}

export function CanvasScene({ scene, paramTargets, alphaTargets, highlights, grabParam }: CanvasSceneProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // props 全部落进 ref,主循环只读 ref —— 事件只改 target,不触发画
  const propsRef = useRef({ paramTargets, alphaTargets, highlights, grabParam });
  propsRef.current = { paramTargets, alphaTargets, highlights, grabParam };

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;

    const paramIds = scene.params.map((p) => p.id);
    const allowed = ['x', ...paramIds];
    const compiled = new Map<string, CompiledExpr>();
    const fnOf = (src: string): CompiledExpr => {
      let f = compiled.get(src);
      if (!f) {
        f = compileExpr(src, allowed);
        compiled.set(src, f);
      }
      return f;
    };

    // ── 双轨状态 ──
    const cur: Record<string, number> = {};
    for (const p of scene.params) cur[p.id] = propsRef.current.paramTargets[p.id] ?? p.initial;
    const alpha = new Map<string, number>();
    for (const e of scene.elements) alpha.set(e.id, propsRef.current.alphaTargets[e.id] ?? (e.hidden ? 0 : 1));
    let walk = 0;
    let pulse = 0;

    // ── 布局 ──
    let W = 640;
    let H = 420;
    const b = scene.board;
    let unitX = 40;
    let unitY = 40;
    let laidOut = false;
    let curDpr = 0;
    const layout = () => {
      const wrap = cv.parentElement;
      const w = Math.max(wrap?.clientWidth ?? 640, 320);
      const h = Math.max(wrap?.clientHeight ?? 420, 260);
      const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      if (laidOut && w === W && h === H && dpr === curDpr) return;
      laidOut = true;
      curDpr = dpr;
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
      cv.style.width = `${w}px`;
      cv.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      W = w;
      H = h;
      unitX = W / (b.xMax - b.xMin);
      unitY = H / (b.yMax - b.yMin);
      if (b.keepAspect) {
        const u = Math.min(unitX, unitY);
        unitX = u;
        unitY = u;
      }
    };
    const px = (x: number) => (x - b.xMin) * unitX;
    const py = (y: number) => H - (y - b.yMin) * unitY;
    const vars = () => ({ ...cur });

    // 网格步长:1/2/5×10ⁿ,保证线数可读(移植 niceTicks 思路);span 异常时兜底为 1
    const niceStep = (span: number, maxLines: number) => {
      if (!(span > 0)) return 1;
      const s = Math.pow(10, Math.floor(Math.log10(span / maxLines)));
      for (const m of [1, 2, 5, 10]) {
        if (span / (s * m) <= maxLines) return s * m;
      }
      return s * 10;
    };

    const drawGrid = () => {
      ctx.fillStyle = PAPER.sheet;
      ctx.fillRect(0, 0, W, H);
      const gx = niceStep(b.xMax - b.xMin, 18);
      const gy = niceStep(b.yMax - b.yMin, 14);
      if (scene.board.grid !== false) {
        ctx.lineWidth = 1;
        ctx.strokeStyle = PAPER.grid;
        ctx.beginPath();
        let guard = 0;
        for (let x = Math.ceil(b.xMin / gx) * gx; x <= b.xMax && guard < 400; x += gx, guard++) {
          ctx.moveTo(px(x), 0);
          ctx.lineTo(px(x), H);
        }
        guard = 0;
        for (let y = Math.ceil(b.yMin / gy) * gy; y <= b.yMax && guard < 400; y += gy, guard++) {
          ctx.moveTo(0, py(y));
          ctx.lineTo(W, py(y));
        }
        ctx.stroke();
      }
      // 坐标轴(0 不在范围内时贴边)
      const axY = b.yMin <= 0 && b.yMax >= 0 ? py(0) : H - 24;
      const axX = b.xMin <= 0 && b.xMax >= 0 ? px(0) : 36;
      ctx.strokeStyle = PAPER.axis;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(0, axY);
      ctx.lineTo(W, axY);
      ctx.moveTo(axX, 0);
      ctx.lineTo(axX, H);
      ctx.stroke();
      // 刻度数字
      ctx.fillStyle = PAPER.ink3;
      ctx.font = `600 11px ${PAPER.mono}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      let guard = 0;
      for (let x = Math.ceil(b.xMin / gx) * gx; x <= b.xMax && guard < 400; x += gx, guard++) {
        if (Math.abs(x) < 1e-9) continue;
        ctx.fillText(String(Math.round(x * 100) / 100), px(x), axY + 4);
      }
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      guard = 0;
      for (let y = Math.ceil(b.yMin / gy) * gy; y <= b.yMax && guard < 400; y += gy, guard++) {
        if (Math.abs(y) < 1e-9) continue;
        ctx.fillText(String(Math.round(y * 100) / 100), axX - 5, py(y));
      }
      // 轴名
      ctx.fillStyle = PAPER.ink2;
      ctx.font = `600 12px ${PAPER.mono}`;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'bottom';
      ctx.fillText(b.xLabel ?? 'x', W - 8, axY - 6);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(b.yLabel ?? 'y', axX + 6, 6);
    };

    /** {表达式:位数} 实时插值 */
    const fillTemplate = (tpl: string) =>
      tpl.replace(/\{([^:}]+)(?::(\d))?\}/g, (_, expr: string, d?: string) => {
        try {
          return num(fnOf(expr.trim())(vars()), d ? Number(d) : 1);
        } catch {
          return '?';
        }
      });

    const hiOf = (id: string) => propsRef.current.highlights.has(id);
    const badElems = new Set<string>();

    const draw = () => {
      drawGrid();
      for (const e of scene.elements) {
        const a = alpha.get(e.id) ?? 0;
        if (a < 0.01 || badElems.has(e.id)) continue;
        const aE = smoothstep(a);
        const hi = hiOf(e.id);
        const pulseW = hi ? Math.sin(pulse * 5) * 0.7 + 0.7 : 0;
        ctx.save();
        try {
        ctx.globalAlpha = aE;

        if (e.kind === 'functiongraph') {
          const f = fnOf(e.expr);
          const d0 = e.domain ? evalNumOrExpr(e.domain[0], vars(), allowed) : b.xMin;
          const d1full = e.domain ? evalNumOrExpr(e.domain[1], vars(), allowed) : b.xMax;
          const d1 = d0 + (d1full - d0) * aE; // 透明度兼作"画出来"的进度
          ctx.strokeStyle = tokenOf(e.color, PAPER.hiA);
          ctx.lineWidth = (hi ? 3.4 : 2.6) + pulseW;
          if (e.dash) ctx.setLineDash([5, 4]);
          ctx.lineCap = 'round';
          ctx.beginPath();
          const N = 90;
          let started = false;
          for (let i = 0; i <= N; i++) {
            const x = d0 + ((d1 - d0) * i) / N;
            const y = f({ ...cur, x });
            if (!Number.isFinite(y)) {
              started = false;
              continue;
            }
            if (started) ctx.lineTo(px(x), py(y));
            else {
              ctx.moveTo(px(x), py(y));
              started = true;
            }
          }
          ctx.stroke();
          if (e.label) {
            ctx.fillStyle = tokenOf(e.color, PAPER.hiA);
            ctx.font = `700 12.5px ${PAPER.mono}`;
            const lx = d0 + (d1 - d0) * 0.82;
            ctx.textAlign = 'left';
            ctx.textBaseline = 'bottom';
            ctx.fillText(fillTemplate(e.label), px(lx) + 6, py(f({ ...cur, x: lx })) - 6);
          }
        } else if (e.kind === 'point') {
          const x = evalNumOrExpr(e.x, vars(), allowed);
          const y = evalNumOrExpr(e.y, vars(), allowed);
          const color = tokenOf(e.color, PAPER.hiB);
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(px(x), py(y), (hi ? 6.5 : 5.5) * aE + pulseW, 0, Math.PI * 2);
          ctx.fill();
          if (hi) {
            ctx.strokeStyle = color;
            ctx.globalAlpha = aE * 0.4;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(px(x), py(y), 11 + Math.sin(pulse * 4) * 2.5, 0, Math.PI * 2);
            ctx.stroke();
            ctx.globalAlpha = aE;
          }
          const label = e.label ? fillTemplate(e.label) : '';
          if (label) {
            ctx.font = `700 12.5px ${PAPER.mono}`;
            ctx.textAlign = 'left';
            ctx.textBaseline = 'bottom';
            ctx.fillText(label, px(x) + 9, py(y) - 8);
          }
        } else if (e.kind === 'segment') {
          const x1 = evalNumOrExpr(e.from[0], vars(), allowed);
          const y1 = evalNumOrExpr(e.from[1], vars(), allowed);
          const x2full = evalNumOrExpr(e.to[0], vars(), allowed);
          const y2full = evalNumOrExpr(e.to[1], vars(), allowed);
          const x2 = x1 + (x2full - x1) * aE;
          const y2 = y1 + (y2full - y1) * aE;
          ctx.strokeStyle = tokenOf(e.color, PAPER.ink3);
          ctx.lineWidth = (hi ? 2.6 : 1.8) + pulseW;
          if (e.dash) ctx.setLineDash([5, 4]);
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(px(x1), py(y1));
          ctx.lineTo(px(x2), py(y2));
          ctx.stroke();
        } else if (e.kind === 'text') {
          const x = evalNumOrExpr(e.x, vars(), allowed);
          const y = evalNumOrExpr(e.y, vars(), allowed);
          ctx.fillStyle = tokenOf(e.color, PAPER.ink2);
          ctx.font = `600 12.5px ${PAPER.font}`;
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          ctx.fillText(fillTemplate(e.text), px(x), py(y));
        } else if (e.kind === 'ladder') {
          // 台阶 + 行走标记(移植自已验收动画的 drawStep)
          const f = fnOf(e.expr);
          const a0 = cur[e.atParam] ?? 0;
          const dx = e.dx;
          const y0 = f({ ...cur, x: a0 });
          const y1 = f({ ...cur, x: a0 + dx });
          const color = tokenOf(e.color, PAPER.hiC);
          ctx.strokeStyle = color;
          ctx.lineWidth = 1.6;
          ctx.setLineDash([5, 4]);
          ctx.beginPath();
          ctx.moveTo(px(a0), py(y0));
          ctx.lineTo(px(a0 + dx), py(y0));
          ctx.lineTo(px(a0 + dx), py(y1));
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = color;
          ctx.font = `700 12px ${PAPER.mono}`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'top';
          ctx.fillText(`Δx=${num(dx, dx % 1 === 0 ? 0 : 1)}`, px(a0 + dx / 2), py(y0) + 4);
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          ctx.fillText(`Δy=${num(y1 - y0)}`, px(a0 + dx) + 6, py((y0 + y1) / 2));
          // 行走标记:在 [a0, a0+dx] 巡游,竖线实时显示这一步抬了多少
          const wx = a0 + walk * dx;
          const fade = Math.sin(Math.PI * walk);
          ctx.globalAlpha = aE * fade * 0.9;
          ctx.strokeStyle = color;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(px(wx), py(y0));
          ctx.lineTo(px(wx), py(f({ ...cur, x: wx })));
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(px(wx), py(f({ ...cur, x: wx })), 3.4, 0, Math.PI * 2);
          ctx.fillStyle = color;
          ctx.fill();
        }
        } catch (err) {
          // 单个元素求值/绘制失败:跳过该元素,不拖死整个画面(质检门会在管线层拦截)
          badElems.add(e.id);
          console.error(`[dynamic-lecture] 元素「${e.id}」绘制失败:`, err);
        } finally {
          ctx.restore();
        }
      }

      // 左上角实时读数(活的数值)
      let ry = 26;
      for (const r of scene.readouts ?? []) {
        ctx.fillStyle = tokenOf(r.color, PAPER.ink1);
        ctx.font = `700 14.5px ${PAPER.mono}`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
        ctx.fillText(fillTemplate(r.template), 18, ry);
        ry += 24;
      }
    };

    // ── 唯一主循环(异常绝不允许杀死续帧) ──
    let raf = 0;
    let last = 0;
    let loopErrLogged = false;
    const frame = (now: number) => {
      try {
        const dtms = last ? Math.min(now - last, 50) : 16.7;
        last = now;
        const dt = dtms / 1000;
        const p = propsRef.current;
        for (const id of paramIds) {
          const want = p.paramTargets[id] ?? cur[id];
          cur[id] = approach(cur[id], want, dt, p.grabParam === id ? K_GRAB : K_SMOOTH);
        }
        for (const e of scene.elements) {
          const want = p.alphaTargets[e.id] ?? (e.hidden ? 0 : 1);
          alpha.set(e.id, approach(alpha.get(e.id) ?? 0, want, dt, K_ALPHA));
        }
        walk += dt * 0.42;
        if (walk > 1) walk -= 1;
        pulse += dt;
        layout();
        draw();
      } catch (err) {
        if (!loopErrLogged) {
          loopErrLogged = true;
          console.error('[dynamic-lecture] 绘制主循环异常:', err);
        }
      } finally {
        raf = requestAnimationFrame(frame);
      }
    };

    layout();
    raf = requestAnimationFrame(frame);
    const onResize = () => layout();
    window.addEventListener('resize', onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene]);

  return <canvas ref={canvasRef} style={{ display: 'block', width: '100%', height: '100%' }} aria-label="讲题画布" />;
}
