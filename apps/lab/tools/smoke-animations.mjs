#!/usr/bin/env node
/**
 * 知识点动画运动桩(npm run smoke:anim)。
 *
 * 校验器(validate-animations.mjs)只看静态文本;这个桩把动画真的跑起来,验「平滑」不是口号:
 * 用 jsdom 装载单文件 HTML,把 requestAnimationFrame / performance.now / Canvas2D 全部打桩,
 * 然后按同一套剧本手动步进每一帧:
 *
 *   1) 播放:点「播放演示」,手动步进 180 帧(≈3 秒,16.7ms/帧)
 *   2) 接管:模拟一次手动操作(拖滑杆或拖画布上的点),确认巡航立刻让位
 *   3) 重置:点「重置」,再步进 120 帧,确认参数回到初值
 *
 * 每帧读动画自己导出的只读探针 window.__kpProbe(),抽查两个以上状态量:
 *   - 帧间差有界(maxStep)→ 证明是缓动而不是跳变;
 *   - 播放段总行程够大(minTravel)→ 证明画面真的在动,不是静止;
 *   - 重置段收敛帧数 ≥ minSettleFrames → 证明是快速回摆而不是闪回;
 *   - 每帧结束后 rAF 队列里必须还有回调 → 证明主循环常驻;
 *   - 每帧至少有一次绘制调用 → 证明绘制在循环里。
 *
 * 任一动画失败 → 退出码 1。
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const ANIM_DIR = path.join(ROOT, 'public', 'animations');

const FRAME_MS = 16.7;
const PLAY_FRAMES = 180;   // ≈3 秒
const AFTER_MANUAL = 60;
const RESET_FRAMES = 120;

/**
 * 每个动画一条剧本。probes 里的 maxStep 按「该量的量程 × 15% 上下」给,
 * 指数缓动第一帧最多吃掉差距的 45%(K_GRAB),所以界要留够,但远小于「一步到位」。
 */
const PLAN = [
  {
    file: '初中/一次函数参数实验.html',
    probes: [
      { key: 'k', maxStep: 0.55, minTravel: 0.6, reset: 1 },
      { key: 'b', maxStep: 0.75, minTravel: 0.0, reset: 0 },
      { key: 'a2', maxStep: 0.30, minTravel: 0.0 },
    ],
    manual: { kind: 'slider', id: 'sk', value: 2.4 },
  },
  {
    file: '初中/勾股定理面积对账.html',
    probes: [
      { key: 'a', maxStep: 0.60, minTravel: 0.8, reset: 3 },
      { key: 'b', maxStep: 0.60, minTravel: 0.0, reset: 4 },
      { key: 'a2', maxStep: 0.30, minTravel: 0.0 },
    ],
    manual: { kind: 'drag', dx: 46, dy: -14 },
  },
  {
    file: '高中/正弦函数三参数变换.html',
    probes: [
      { key: 'A', maxStep: 0.45, minTravel: 0.5, reset: 1 },
      { key: 'w', maxStep: 0.45, minTravel: 0.0, reset: 1 },
      { key: 'p', maxStep: 0.70, minTravel: 0.0, reset: 0 },
    ],
    manual: { kind: 'slider', id: 'sw', value: 2.3 },
  },
  {
    file: '高中/导数的几何意义.html',
    probes: [
      { key: 'x0', maxStep: 0.55, minTravel: 0.4, reset: -1.4 },
      { key: 'h', maxStep: 0.50, minTravel: 0.2, reset: 1.5 },
      { key: 'a3', maxStep: 0.30, minTravel: 0.0 },
    ],
    manual: { kind: 'slider', id: 'sh', value: 0.4 },
  },
  {
    file: '高中/椭圆的定义.html',
    probes: [
      // P 的坐标(不是参数角):A·cos(0.9)=2.4864、b·sin(0.9)=2.5067 是初始位置。
      { key: 'x', maxStep: 1.40, minTravel: 1.5, reset: 2.4864 },
      { key: 'y', maxStep: 1.40, minTravel: 1.0, reset: 2.5067 },
      { key: 'c', maxStep: 0.55, minTravel: 0.0, reset: 2.4 },
      { key: 'a2', maxStep: 0.30, minTravel: 0.0 },
    ],
    manual: { kind: 'drag', dx: 30, dy: 26 },
  },
];

const CANVAS_W = 340;
const CANVAS_H = 300;

/** 记录型 Canvas2D 桩:只统计调用,不真画。 */
function makeCtx(stats) {
  const noop = () => { stats.calls += 1; };
  const ctx = {
    canvas: null,
    save: noop, restore: noop, beginPath: noop, closePath: noop, fill: noop, stroke: noop,
    clip: noop, setLineDash: noop, getLineDash: () => [],
    clearRect: noop, fillRect: noop, strokeRect: noop, rect: noop,
    moveTo: noop, lineTo: noop, arc: noop, arcTo: noop, ellipse: noop,
    quadraticCurveTo: noop, bezierCurveTo: noop,
    fillText: noop, strokeText: noop,
    translate: noop, rotate: noop, scale: noop, transform: noop, setTransform: noop,
    resetTransform: noop, drawImage: noop,
    measureText: (t) => ({ width: String(t).length * 6 }),
  };
  // 颜色/字体等属性随便存,读回来不影响判定。
  for (const p of ['fillStyle', 'strokeStyle', 'lineWidth', 'lineCap', 'lineJoin', 'font',
    'textAlign', 'textBaseline', 'globalAlpha', 'globalCompositeOperation', 'shadowBlur',
    'shadowColor', 'miterLimit', 'lineDashOffset', 'imageSmoothingEnabled']) {
    ctx[p] = p === 'globalAlpha' ? 1 : '';
  }
  return ctx;
}

function makeWorld(html) {
  const dom = new JSDOM(html, { runScripts: 'outside-only' });
  const win = dom.window;
  const stats = { calls: 0 };
  const errors = [];

  const ctx = makeCtx(stats);
  win.HTMLCanvasElement.prototype.getContext = function () { ctx.canvas = this; return ctx; };
  // jsdom 不给尺寸也不给 Pointer Capture,补上,让 layout() 与拖拽命中判定能跑。
  Object.defineProperty(win.HTMLCanvasElement.prototype, 'clientWidth', { get: () => CANVAS_W });
  Object.defineProperty(win.HTMLCanvasElement.prototype, 'clientHeight', { get: () => CANVAS_H });
  win.Element.prototype.getBoundingClientRect = function () {
    return { x: 0, y: 0, left: 0, top: 0, right: CANVAS_W, bottom: CANVAS_H,
      width: CANVAS_W, height: CANVAS_H, toJSON(){ return this; } };
  };
  win.Element.prototype.setPointerCapture = function () {};
  win.Element.prototype.releasePointerCapture = function () {};
  win.devicePixelRatio = 1;

  // 时钟与 rAF 全部由桩驱动:动画拿到的每一个 now 都是我们给的。
  const clock = { now: 1000 };
  let queue = [];
  let nextId = 1;
  win.performance.now = () => clock.now;
  win.requestAnimationFrame = (cb) => { const id = nextId++; queue.push({ id, cb }); return id; };
  win.cancelAnimationFrame = (id) => { queue = queue.filter((q) => q.id !== id); };
  win.addEventListener('error', (ev) => errors.push(String(ev.error || ev.message)));

  for (const el of dom.window.document.querySelectorAll('script')) {
    win.eval(el.textContent);
  }

  function pump() {
    const due = queue;
    queue = [];
    for (const q of due) {
      try {
        q.cb(clock.now);
      } catch (err) {
        errors.push(`rAF 回调抛错:${err && err.message ? err.message : String(err)}`);
      }
    }
    return due.length;
  }

  function step() {
    clock.now += FRAME_MS;
    stats.calls = 0;
    const ran = pump();
    return { ran, drawCalls: stats.calls, pending: queue.length };
  }

  return { dom, win, doc: win.document, errors, step, clock, queueSize: () => queue.length };
}

/** 用 MouseEvent 冒充 pointer 事件族:jsdom 没有 PointerEvent 构造器。 */
function firePointer(win, el, type, x, y) {
  const ev = win.document.createEvent('MouseEvents');
  ev.initMouseEvent(type, true, true, win, 0, x, y, x, y, false, false, false, false, 0, null);
  ev.pointerId = 1;
  el.dispatchEvent(ev);
}

function readProbe(win) {
  if (typeof win.__kpProbe !== 'function') return null;
  return win.__kpProbe();
}

function series(frames, key) {
  return frames.map((f) => (f && f.vals && typeof f.vals[key] === 'number' ? f.vals[key] : NaN));
}

function analyse(values) {
  let maxStep = 0, travel = 0;
  for (let i = 1; i < values.length; i++) {
    const d = Math.abs(values[i] - values[i - 1]);
    if (!Number.isFinite(d)) return { maxStep: NaN, travel: NaN };
    if (d > maxStep) maxStep = d;
    travel += d;
  }
  return { maxStep, travel };
}

async function runOne(plan) {
  const abs = path.join(ANIM_DIR, ...plan.file.split('/'));
  const html = await readFile(abs, 'utf8');
  const world = makeWorld(html);
  const { win, doc } = world;
  const fails = [];
  const notes = [];

  const $ = (id) => doc.getElementById(id);
  const canvas = doc.querySelector('canvas');

  if (typeof win.__kpProbe !== 'function') {
    return { file: plan.file, fails: ['没有导出 window.__kpProbe 只读探针,桩无法抽查状态量'], notes };
  }

  // 首帧之前主循环就该排好了队。
  if (world.queueSize() === 0) fails.push('脚本执行完毕后 rAF 队列为空:主循环没有启动');

  const collect = (n, label) => {
    const frames = [];
    for (let i = 0; i < n; i++) {
      const r = world.step();
      if (r.ran === 0) { fails.push(`${label} 第 ${i + 1} 帧没有 rAF 回调可跑:主循环断了`); break; }
      if (r.drawCalls === 0) fails.push(`${label} 第 ${i + 1} 帧没有任何绘制调用`);
      if (r.pending === 0) { fails.push(`${label} 第 ${i + 1} 帧结束后没有续排 rAF:循环不是常驻的`); break; }
      frames.push(readProbe(win));
    }
    return frames;
  };

  // ── 1) 播放 3 秒
  const btnPlay = [...doc.querySelectorAll('button')].find((b) => /播放|演示/.test(b.textContent || ''));
  if (!btnPlay) fails.push('找不到播放按钮');
  else btnPlay.click();
  const playFrames = collect(PLAY_FRAMES, '播放');
  const playing = playFrames.length ? playFrames[playFrames.length - 1].playing : false;
  if (!playing) fails.push('播放 3 秒后 probe.playing 不为 true:巡航没跑起来');

  for (const p of plan.probes) {
    const st = analyse(series(playFrames, p.key));
    if (!Number.isFinite(st.maxStep)) { fails.push(`播放段 ${p.key} 探针不是有限数值`); continue; }
    notes.push(`播放 ${p.key}: 帧间最大 ${st.maxStep.toFixed(4)} / 总行程 ${st.travel.toFixed(3)}`);
    if (st.maxStep > p.maxStep) fails.push(`播放段 ${p.key} 帧间差 ${st.maxStep.toFixed(4)} > 上限 ${p.maxStep}(疑似跳变)`);
    if (p.minTravel > 0 && st.travel < p.minTravel) {
      fails.push(`播放段 ${p.key} 总行程只有 ${st.travel.toFixed(3)} < ${p.minTravel}(巡航没让它动)`);
    }
  }

  // ── 2) 手动接管
  const dragFrames = [];
  if (plan.manual.kind === 'slider') {
    const el = $(plan.manual.id);
    if (!el) fails.push(`找不到滑杆 #${plan.manual.id}`);
    else {
      firePointer(win, el, 'pointerdown', 10, 10);
      el.value = String(plan.manual.value);
      el.dispatchEvent(new win.Event('input', { bubbles: true }));
      firePointer(win, el, 'pointerup', 10, 10);
      win.dispatchEvent(new win.Event('pointerup'));
    }
  } else {
    const before = readProbe(win);
    const grab = before && before.grab;
    if (!grab) fails.push('探针没给出可拖点的屏幕坐标(grab),桩没法模拟拖拽');
    else {
      firePointer(win, canvas, 'pointerdown', grab[0], grab[1]);
      dragFrames.push(before);
      for (let i = 1; i <= 6; i++) {
        firePointer(win, canvas, 'pointermove',
          grab[0] + (plan.manual.dx * i) / 6, grab[1] + (plan.manual.dy * i) / 6);
        world.step();
        dragFrames.push(readProbe(win));
      }
      firePointer(win, canvas, 'pointerup', grab[0] + plan.manual.dx, grab[1] + plan.manual.dy);
    }
  }
  const manualFrames = dragFrames.concat(collect(AFTER_MANUAL, '接管'));
  const stillPlaying = manualFrames.length ? manualFrames[manualFrames.length - 1].playing : true;
  if (stillPlaying) fails.push('手动操作之后 probe.playing 仍为 true:巡航没有让位');
  let manualMoved = 0;
  for (const p of plan.probes) {
    const st = analyse(series(manualFrames, p.key));
    notes.push(`接管 ${p.key}: 帧间最大 ${st.maxStep.toFixed(4)} / 总行程 ${st.travel.toFixed(3)}`);
    manualMoved = Math.max(manualMoved, st.travel);
    if (st.maxStep > p.maxStep) {
      fails.push(`接管段 ${p.key} 帧间差 ${st.maxStep.toFixed(4)} > 上限 ${p.maxStep}(手动操作把值瞬移了)`);
    }
  }
  if (manualMoved < 0.05) fails.push(`手动操作没有推动任何被抽查的状态量(最大行程 ${manualMoved.toFixed(4)})`);

  // ── 3) 重置:必须回摆,不许闪回
  const btnReset = [...doc.querySelectorAll('button')].find((b) => /重置|重新开始/.test(b.textContent || ''));
  if (!btnReset) fails.push('找不到重置按钮');
  else btnReset.click();
  const resetFrames = collect(RESET_FRAMES, '重置');
  for (const p of plan.probes) {
    if (p.reset === undefined) continue;
    const vals = series(resetFrames, p.key);
    const st = analyse(vals);
    if (st.maxStep > p.maxStep) fails.push(`重置段 ${p.key} 帧间差 ${st.maxStep.toFixed(4)} > 上限 ${p.maxStep}(闪回)`);
    const end = vals[vals.length - 1];
    if (!(Math.abs(end - p.reset) < 0.05)) {
      fails.push(`重置后 ${p.key} = ${Number(end).toFixed(4)},没有回到初值 ${p.reset}`);
    }
    let settleAt = vals.findIndex((v) => Math.abs(v - p.reset) < 0.02);
    if (settleAt === 0) settleAt = -1;   // 一开始就在初值上,这个量不参与回摆判定
    if (settleAt > 0) {
      notes.push(`重置 ${p.key}: ${settleAt} 帧回到初值`);
      if (settleAt < 4) fails.push(`重置段 ${p.key} 只用了 ${settleAt} 帧就到位:是闪回不是回摆`);
    }
  }
  const endStage = resetFrames.length ? resetFrames[resetFrames.length - 1].stage : 0;
  if (endStage !== 1) fails.push(`重置后阶段是 ${endStage},没回到阶段 1`);

  for (const e of world.errors) fails.push(`运行期报错:${e}`);
  return { file: plan.file, fails, notes };
}

async function main() {
  const verbose = process.argv.includes('--verbose');
  let bad = 0;
  for (const plan of PLAN) {
    let result;
    try {
      result = await runOne(plan);
    } catch (err) {
      result = { file: plan.file, fails: [`桩装载失败:${err && err.stack ? err.stack : String(err)}`], notes: [] };
    }
    const ok = result.fails.length === 0;
    if (!ok) bad += 1;
    console.log(`${ok ? '✓' : '✗'} ${result.file}` +
      `  播放${PLAY_FRAMES}帧 → 手动接管${AFTER_MANUAL}帧 → 重置${RESET_FRAMES}帧`);
    if (verbose) for (const n of result.notes) console.log(`    · ${n}`);
    for (const f of result.fails) console.log(`    - ${f}`);
  }
  console.log('');
  console.log(`动画 ${PLAN.length} 个 · 通过 ${PLAN.length - bad} 个(每个 ${PLAY_FRAMES + AFTER_MANUAL + RESET_FRAMES} 帧手动步进)`);
  if (bad > 0) {
    console.error(`\n✗ ${bad} 个动画的运动层没过桩。`);
    process.exit(1);
  }
  console.log('\n✓ 全部通过:主循环常驻、状态双轨缓动、巡航可被手动接管、重置是回摆。');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
