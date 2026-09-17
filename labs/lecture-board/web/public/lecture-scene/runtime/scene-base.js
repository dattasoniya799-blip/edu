/*
 * LectureScene · 场景运行时基础库(纯浏览器脚本,无依赖)
 * - 时钟/补间(可整体暂停,供播放器「随时暂停」)
 * - SVG 助手、坐标映射
 * - 拖拽手柄与画布内滑杆(学生「玩」的入口)
 * 挂到 window.LectureScene 命名空间,模板与播放器共用。
 */
(function (global) {
  'use strict';
  var LS = (global.LectureScene = global.LectureScene || {});
  var SVG_NS = 'http://www.w3.org/2000/svg';

  // ---------------- 时钟与补间 ----------------
  // 所有动画都走这个时钟;paused 时 now() 不前进,rAF 回调照常但不推进,于是「暂停」对所有动画一致有效。
  var Clock = {
    _paused: false,
    _offset: 0,
    _pausedAt: 0,
    now: function () {
      if (this._paused) return this._pausedAt - this._offset;
      return performance.now() - this._offset;
    },
    pause: function () {
      if (this._paused) return;
      this._pausedAt = performance.now();
      this._paused = true;
    },
    resume: function () {
      if (!this._paused) return;
      this._offset += performance.now() - this._pausedAt;
      this._paused = false;
    },
    isPaused: function () {
      return this._paused;
    }
  };

  var easings = {
    linear: function (t) { return t; },
    easeOut: function (t) { return 1 - Math.pow(1 - t, 3); },
    easeInOut: function (t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
  };

  var activeTweens = [];
  var rafId = 0;
  function pump() {
    rafId = 0;
    var t = Clock.now();
    for (var i = activeTweens.length - 1; i >= 0; i--) {
      var tw = activeTweens[i];
      if (tw.cancelled) { activeTweens.splice(i, 1); continue; }
      var p = Math.min(1, Math.max(0, (t - tw.start) / tw.duration));
      tw.onUpdate(tw.ease(p), p);
      if (p >= 1) {
        activeTweens.splice(i, 1);
        tw.resolve();
      }
    }
    if (activeTweens.length) rafId = requestAnimationFrame(pump);
  }
  /** 补间:返回 Promise,带 cancel;duration 0 立即完成 */
  function tween(opts) {
    var duration = Math.max(0, opts.duration || 0);
    var handle = { cancelled: false };
    var p = new Promise(function (resolve) {
      var tw = {
        start: Clock.now(),
        duration: duration || 1,
        ease: easings[opts.easing || 'easeInOut'] || easings.easeInOut,
        onUpdate: opts.onUpdate || function () {},
        resolve: resolve,
        cancelled: false
      };
      handle.cancel = function () { tw.cancelled = true; handle.cancelled = true; resolve(); };
      if (duration === 0) { tw.onUpdate(1, 1); resolve(); return; }
      activeTweens.push(tw);
      if (!rafId) rafId = requestAnimationFrame(pump);
    });
    p.cancel = function () { if (handle.cancel) handle.cancel(); };
    return p;
  }
  /** 受时钟控制的等待(暂停时不计时) */
  function wait(ms) {
    return tween({ duration: ms, onUpdate: function () {} });
  }
  function cancelAllTweens() {
    activeTweens.forEach(function (tw) { tw.cancelled = true; tw.resolve(); });
    activeTweens.length = 0;
  }

  // ---------------- SVG 助手 ----------------
  function el(name, attrs, parent) {
    var node = document.createElementNS(SVG_NS, name);
    if (attrs) for (var k in attrs) if (attrs[k] != null) node.setAttribute(k, String(attrs[k]));
    if (parent) parent.appendChild(node);
    return node;
  }
  function attr(node, attrs) {
    for (var k in attrs) if (attrs[k] != null) node.setAttribute(k, String(attrs[k]));
    return node;
  }
  function text(parent, x, y, str, attrs) {
    var t = el('text', Object.assign({ x: x, y: y }, attrs || {}), parent);
    t.textContent = str;
    return t;
  }
  function fmt(v, digits) {
    var d = digits == null ? 2 : digits;
    var s = Number(v).toFixed(d);
    if (s.indexOf('.') >= 0) s = s.replace(/0+$/, '').replace(/\.$/, '');
    if (s === '-0') s = '0';
    return s;
  }
  var clamp = function (v, lo, hi) { return Math.min(hi, Math.max(lo, v)); };
  function snap(v, step) {
    if (!step) return v;
    return Math.round(v / step) * step;
  }

  // ---------------- 坐标映射(数学场景) ----------------
  /** 数学坐标 ↔ 像素;view = {xMin,xMax,yMin,yMax}, box = {x,y,w,h} */
  function Mapper(view, box) {
    this.view = view; this.box = box;
  }
  Mapper.prototype.px = function (x) { return this.box.x + ((x - this.view.xMin) / (this.view.xMax - this.view.xMin)) * this.box.w; };
  Mapper.prototype.py = function (y) { return this.box.y + this.box.h - ((y - this.view.yMin) / (this.view.yMax - this.view.yMin)) * this.box.h; };
  Mapper.prototype.mx = function (px) { return this.view.xMin + ((px - this.box.x) / this.box.w) * (this.view.xMax - this.view.xMin); };
  Mapper.prototype.my = function (py) { return this.view.yMin + ((this.box.y + this.box.h - py) / this.box.h) * (this.view.yMax - this.view.yMin); };

  /** 画网格 + 坐标轴 + 刻度(返回 <g>) */
  function drawAxes(parent, mapper, opts) {
    opts = opts || {};
    var g = el('g', { class: 'ls-axes' }, parent);
    var v = mapper.view;
    var grid = el('g', { stroke: opts.gridColor || '#E5E7EB', 'stroke-width': 1 }, g);
    for (var x = Math.ceil(v.xMin); x <= v.xMax; x++) el('line', { x1: mapper.px(x), y1: mapper.py(v.yMin), x2: mapper.px(x), y2: mapper.py(v.yMax) }, grid);
    for (var y = Math.ceil(v.yMin); y <= v.yMax; y++) el('line', { x1: mapper.px(v.xMin), y1: mapper.py(y), x2: mapper.px(v.xMax), y2: mapper.py(y) }, grid);
    var axes = el('g', { stroke: opts.axisColor || '#1F2328', 'stroke-width': 1.6 }, g);
    var y0 = clamp(0, v.yMin, v.yMax), x0 = clamp(0, v.xMin, v.xMax);
    el('line', { x1: mapper.px(v.xMin), y1: mapper.py(y0), x2: mapper.px(v.xMax), y2: mapper.py(y0) }, axes);
    el('line', { x1: mapper.px(x0), y1: mapper.py(v.yMin), x2: mapper.px(x0), y2: mapper.py(v.yMax) }, axes);
    // 箭头
    el('path', { d: 'M' + (mapper.px(v.xMax)) + ' ' + mapper.py(y0) + ' l-10 -5 v10 z', fill: opts.axisColor || '#1F2328', stroke: 'none' }, axes);
    el('path', { d: 'M' + mapper.px(x0) + ' ' + mapper.py(v.yMax) + ' l-5 10 h10 z', fill: opts.axisColor || '#1F2328', stroke: 'none' }, axes);
    var labels = el('g', { fill: '#6B7280', 'font-size': 12, 'font-family': 'system-ui, sans-serif' }, g);
    for (var xi = Math.ceil(v.xMin); xi <= v.xMax; xi++) if (xi !== 0 && xi < v.xMax) text(labels, mapper.px(xi), mapper.py(y0) + 16, String(xi), { 'text-anchor': 'middle' });
    for (var yi = Math.ceil(v.yMin); yi <= v.yMax; yi++) if (yi !== 0 && yi < v.yMax) text(labels, mapper.px(x0) - 8, mapper.py(yi) + 4, String(yi), { 'text-anchor': 'end' });
    text(labels, mapper.px(x0) - 8, mapper.py(y0) + 16, 'O', { 'text-anchor': 'end' });
    text(labels, mapper.px(v.xMax) - 4, mapper.py(y0) - 8, 'x', { 'text-anchor': 'end', 'font-style': 'italic', fill: '#1F2328' });
    text(labels, mapper.px(x0) + 8, mapper.py(v.yMax) + 12, 'y', { 'font-style': 'italic', fill: '#1F2328' });
    return g;
  }

  /** 函数图象路径:采样 fn 于 [xMin, xMax],progress∈[0,1] 控制画出比例(从左往右) */
  function functionPath(mapper, fn, progress, samples) {
    var v = mapper.view, n = samples || 160;
    var upto = Math.max(1, Math.round(n * (progress == null ? 1 : progress)));
    var d = '';
    for (var i = 0; i <= upto; i++) {
      var x = v.xMin + ((v.xMax - v.xMin) * i) / n;
      var y = fn(x);
      if (!isFinite(y)) continue;
      // 裁剪到视窗上下 2 格,避免超长路径
      var yc = clamp(y, v.yMin - 2, v.yMax + 2);
      d += (d ? ' L' : 'M') + mapper.px(x).toFixed(1) + ' ' + mapper.py(yc).toFixed(1);
    }
    return d;
  }

  /**
   * 在视窗内给函数图象挑一个放手柄的横坐标:优先 prefer,若该处 y 出界则在可见区间里找离 prefer 最近的点。
   * 手柄跑到画布外会被页头/字幕条盖住,拖不到(2026-09-03 无头测试发现)。
   */
  function pickVisibleX(mapper, fn, prefer) {
    var v = mapper.view, margin = 0.4;
    var inside = function (x) { var y = fn(x); return isFinite(y) && y > v.yMin + margin && y < v.yMax - margin; };
    if (prefer > v.xMin + margin && prefer < v.xMax - margin && inside(prefer)) return prefer;
    var best = null, bestD = Infinity;
    for (var i = 0; i <= 120; i++) {
      var x = v.xMin + margin + ((v.xMax - v.xMin - 2 * margin) * i) / 120;
      if (!inside(x)) continue;
      var d = Math.abs(x - prefer);
      if (d < bestD) { bestD = d; best = x; }
    }
    return best == null ? clamp(prefer, v.xMin + margin, v.xMax - margin) : best;
  }

  // ---------------- 拖拽 ----------------
  /**
   * 让 node 可拖:onDrag(dx, dy, ev, start) 以像素增量回调;返回销毁函数。
   * 用 pointer 事件,兼容鼠标/触屏;拖动时给 node 加 .ls-dragging。
   */
  function draggable(node, handlers) {
    var start = null;
    function down(ev) {
      if (node.getAttribute('data-locked') === '1') return;
      ev.preventDefault();
      node.setPointerCapture && node.setPointerCapture(ev.pointerId);
      start = { x: ev.clientX, y: ev.clientY };
      node.classList.add('ls-dragging');
      handlers.onStart && handlers.onStart(ev);
    }
    function move(ev) {
      if (!start) return;
      handlers.onDrag(ev.clientX - start.x, ev.clientY - start.y, ev, start);
    }
    function up(ev) {
      if (!start) return;
      start = null;
      node.classList.remove('ls-dragging');
      handlers.onEnd && handlers.onEnd(ev);
    }
    node.addEventListener('pointerdown', down);
    node.addEventListener('pointermove', move);
    node.addEventListener('pointerup', up);
    node.addEventListener('pointercancel', up);
    return function () {
      node.removeEventListener('pointerdown', down);
      node.removeEventListener('pointermove', move);
      node.removeEventListener('pointerup', up);
      node.removeEventListener('pointercancel', up);
    };
  }

  /** 像素比例(SVG viewBox 缩放后,1 个 viewBox 单位 = 多少 client 像素) */
  function svgScale(svg) {
    var vb = svg.viewBox && svg.viewBox.baseVal;
    var rect = svg.getBoundingClientRect();
    if (!vb || !vb.width) return 1;
    return rect.width / vb.width;
  }

  /**
   * 圆形手柄:把「参数」映射到画布上一个可拖的点。
   * spec: { id, get:()=>{x,y}(viewBox 像素), onDrag:(px,py)=>void, color, label }
   */
  function Handle(svg, layer, spec) {
    this.svg = svg; this.spec = spec;
    this.g = el('g', { class: 'ls-handle', 'data-param': spec.id, 'data-locked': '1' }, layer);
    this.ring = el('circle', { r: 16, fill: spec.color || '#1D4ED8', 'fill-opacity': 0.12, stroke: 'none' }, this.g);
    this.dot = el('circle', { r: 7, fill: spec.color || '#1D4ED8', stroke: '#fff', 'stroke-width': 2 }, this.g);
    this.label = text(this.g, 0, -14, spec.label || spec.id, { 'text-anchor': 'middle', 'font-size': 12, fill: spec.color || '#1D4ED8', 'font-weight': 700, 'font-family': 'system-ui, sans-serif' });
    var self = this, startPos = null;
    draggable(this.g, {
      onStart: function () { spec.onStart && spec.onStart(); startPos = spec.get(); },
      onDrag: function (dx, dy) {
        var s = svgScale(svg);
        spec.onDrag(startPos.x + dx / s, startPos.y + dy / s);
      },
      onEnd: function () { spec.onEnd && spec.onEnd(); }
    });
    this.update();
  }
  Handle.prototype.update = function () {
    var p = this.spec.get();
    attr(this.g, { transform: 'translate(' + p.x.toFixed(1) + ',' + p.y.toFixed(1) + ')' });
  };
  Handle.prototype.setLocked = function (locked) {
    attr(this.g, { 'data-locked': locked ? '1' : '0' });
    this.g.classList.toggle('ls-handle-active', !locked);
  };

  /**
   * 画布内滑杆(给没有几何手柄的参数,如质量、弹性系数):
   * spec: { id, label, min, max, step, get:()=>value, set:(v)=>void, x, y, width, color, format }
   */
  function Slider(svg, layer, spec) {
    this.svg = svg; this.spec = spec;
    var w = spec.width || 160;
    this.g = el('g', { class: 'ls-slider', 'data-param': spec.id, 'data-locked': '1', transform: 'translate(' + spec.x + ',' + spec.y + ')' }, layer);
    text(this.g, 0, -10, spec.label, { 'font-size': 12, fill: '#6B7280', 'font-family': 'system-ui, sans-serif' });
    el('rect', { x: 0, y: -3, width: w, height: 6, rx: 3, fill: '#E5E7EB' }, this.g);
    this.fill = el('rect', { x: 0, y: -3, width: 0, height: 6, rx: 3, fill: spec.color || '#1D4ED8' }, this.g);
    this.knob = el('g', { class: 'ls-handle', 'data-locked': '1' }, this.g);
    el('circle', { r: 14, fill: spec.color || '#1D4ED8', 'fill-opacity': 0.12 }, this.knob);
    el('circle', { r: 7, fill: spec.color || '#1D4ED8', stroke: '#fff', 'stroke-width': 2 }, this.knob);
    this.value = text(this.g, w + 12, 4, '', { 'font-size': 13, fill: '#1F2328', 'font-weight': 700, 'font-family': 'system-ui, sans-serif' });
    var self = this, startX = 0;
    draggable(this.knob, {
      onStart: function () { startX = self._knobX(); },
      onDrag: function (dx) {
        var s = svgScale(svg);
        var x = clamp(startX + dx / s, 0, w);
        var v = spec.min + (x / w) * (spec.max - spec.min);
        spec.set(snap(v, spec.step));
        self.update();
      },
      onEnd: function () { spec.onEnd && spec.onEnd(); }
    });
    this.update();
  }
  Slider.prototype._knobX = function () {
    var s = this.spec;
    return ((s.get() - s.min) / (s.max - s.min)) * (s.width || 160);
  };
  Slider.prototype.update = function () {
    var x = this._knobX();
    attr(this.knob, { transform: 'translate(' + x.toFixed(1) + ',0)' });
    attr(this.fill, { width: x.toFixed(1) });
    this.value.textContent = (this.spec.format || fmt)(this.spec.get());
  };
  Slider.prototype.setLocked = function (locked) {
    attr(this.g, { 'data-locked': locked ? '1' : '0' });
    attr(this.knob, { 'data-locked': locked ? '1' : '0' });
    this.g.classList.toggle('ls-handle-active', !locked);
    this.knob.classList.toggle('ls-handle-active', !locked);
  };

  // ---------------- 一维物理 ----------------
  /** 一维碰撞(恢复系数 e):返回碰后速度 */
  function collide1D(m1, v1, m2, v2, e) {
    var v1p = (m1 * v1 + m2 * v2 - m2 * e * (v1 - v2)) / (m1 + m2);
    var v2p = (m1 * v1 + m2 * v2 + m1 * e * (v1 - v2)) / (m1 + m2);
    return { v1: v1p, v2: v2p };
  }

  // ---------------- 通用效果(label / focus / pulse) ----------------
  /**
   * 所有模板共用的画面效果。锚点由模板的 getAnchor(id) 提供(viewBox 坐标 {x,y,r?}),
   * 几何运行时算(剧本只写目标 id)。效果画在场景 SVG 最上层的 ls-fx-layer,换步时清空。
   * 模板没实现 getAnchor 或找不到锚点时效果安全跳过。
   */
  function fxLayer(scene) {
    var svg = scene && scene.svg;
    if (!svg) return null;
    var layer = svg.querySelector(':scope > g.ls-fx-layer');
    if (!layer) layer = el('g', { class: 'ls-fx-layer' }, svg);
    svg.appendChild(layer); // 保持在最上层
    return layer;
  }
  function fxAnchor(scene, target) {
    if (!scene || typeof scene.getAnchor !== 'function' || !target) return null;
    var a = scene.getAnchor(String(target));
    return a && isFinite(a.x) && isFinite(a.y) ? a : null;
  }
  var effects = {
    clear: function (scene) {
      var svg = scene && scene.svg;
      var layer = svg && svg.querySelector(':scope > g.ls-fx-layer');
      if (layer) layer.innerHTML = '';
    },
    /** {type:'label', target, text}:锚点旁贴一条短标注(同锚点重复 label 会替换) */
    label: function (scene, act) {
      var layer = fxLayer(scene), a = fxAnchor(scene, act.target);
      if (!layer || !a || !act.text) return wait(0);
      var old = layer.querySelector('g[data-label="' + act.target + '"]');
      if (old) old.remove();
      var vb = scene.svg.viewBox.baseVal;
      var g = el('g', { class: 'ls-fx-label', 'data-label': act.target, opacity: 0 }, layer);
      var t = text(g, 0, 0, String(act.text), { 'font-size': 13, 'font-weight': 700, fill: '#7C2D12', 'font-family': 'system-ui, sans-serif' });
      var bb = t.getBBox();
      // 默认贴在锚点上方,出画布则翻到下方/内侧
      var x = clamp(a.x - bb.width / 2, 8, (vb.width || 960) - bb.width - 8);
      var y = a.y - (a.r || 14) - 10;
      if (y - bb.height < 4) y = a.y + (a.r || 14) + bb.height + 6;
      el('rect', { x: x - 6, y: y - bb.height - 3, width: bb.width + 12, height: bb.height + 8, rx: 6, fill: '#FEF3C7', stroke: '#F59E0B', 'stroke-width': 1 }, g);
      attr(t, { x: x, y: y });
      g.appendChild(t);
      return tween({ duration: act.durationMs == null ? 350 : act.durationMs, onUpdate: function (k) { attr(g, { opacity: k }); } });
    },
    /** {type:'focus', target}:聚光——压暗其余,亮出锚点周围;约 4 秒自动散场 */
    focus: function (scene, act) {
      var layer = fxLayer(scene), a = fxAnchor(scene, act.target);
      if (!layer || !a) return wait(0);
      var old = layer.querySelector('g.ls-fx-focus');
      if (old) old.remove();
      var vb = scene.svg.viewBox.baseVal, W = vb.width || 960, H = vb.height || 540;
      var g = el('g', { class: 'ls-fx-focus' }, layer);
      var maskId = 'lsfocus' + Math.floor(Math.random() * 1e9);
      var mask = el('mask', { id: maskId }, g);
      el('rect', { x: 0, y: 0, width: W, height: H, fill: '#fff' }, mask);
      var r = Math.max(a.r || 0, 46);
      el('circle', { cx: a.x, cy: a.y, r: r, fill: '#000' }, mask);
      var dim = el('rect', { x: 0, y: 0, width: W, height: H, fill: '#111827', 'fill-opacity': 0, mask: 'url(#' + maskId + ')', 'pointer-events': 'none' }, g);
      var ring = el('circle', { cx: a.x, cy: a.y, r: r, fill: 'none', stroke: '#F59E0B', 'stroke-width': 2.5, opacity: 0 }, g);
      var hold = act.durationMs == null ? 3200 : act.durationMs;
      return tween({ duration: 350, onUpdate: function (k) { attr(dim, { 'fill-opacity': 0.32 * k }); attr(ring, { opacity: k }); } })
        .then(function () { return wait(hold); })
        .then(function () {
          return tween({ duration: 400, onUpdate: function (k) { attr(dim, { 'fill-opacity': 0.32 * (1 - k) }); attr(ring, { opacity: 1 - k }); } });
        })
        .then(function () { g.remove(); });
    },
    /** {type:'pulse', target}:锚点处扩散一圈脉冲强调 */
    pulse: function (scene, act) {
      var layer = fxLayer(scene), a = fxAnchor(scene, act.target);
      if (!layer || !a) return wait(0);
      var ring = el('circle', { cx: a.x, cy: a.y, r: a.r || 10, fill: 'none', stroke: '#DC2626', 'stroke-width': 3 }, layer);
      return tween({ duration: act.durationMs == null ? 900 : act.durationMs, onUpdate: function (k) {
        attr(ring, { r: (a.r || 10) + 34 * k, opacity: 1 - k, 'stroke-width': 3 * (1 - k) + 0.5 });
      } }).then(function () { ring.remove(); });
    },
    /** 播放器统一入口:通用类型走这里,返回 Promise */
    apply: function (scene, act) {
      if (act.type === 'label') return effects.label(scene, act);
      if (act.type === 'focus') return effects.focus(scene, act);
      if (act.type === 'pulse') return effects.pulse(scene, act);
      return wait(0);
    },
    types: ['label', 'focus', 'pulse']
  };

  LS.Clock = Clock;
  LS.tween = tween;
  LS.wait = wait;
  LS.cancelAllTweens = cancelAllTweens;
  LS.svg = { el: el, attr: attr, text: text, NS: SVG_NS };
  LS.fmt = fmt;
  LS.clamp = clamp;
  LS.snap = snap;
  LS.Mapper = Mapper;
  LS.drawAxes = drawAxes;
  LS.functionPath = functionPath;
  LS.pickVisibleX = pickVisibleX;
  LS.draggable = draggable;
  LS.svgScale = svgScale;
  LS.Handle = Handle;
  LS.Slider = Slider;
  LS.collide1D = collide1D;
  LS.effects = effects;
  LS.templates = LS.templates || {};
  LS.registerTemplate = function (tpl) { LS.templates[tpl.id] = tpl; };
})(window);
