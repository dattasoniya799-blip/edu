/*
 * 模板 · 二次函数与直线相交(quadratic-line)
 * 参数:a b c(抛物线 y=ax²+bx+c)、k m(直线 y=kx+m)
 * 元素(target):axes 坐标系 / parabola 抛物线 / vertex 顶点标注 / line 直线 / points 交点 / readout 读数
 * 动作:show / hide / draw(逐渐画出 parabola|line)/ move(参数动画到目标值,如把直线平移进来)/ highlight(points)
 * 手柄:a(顶点右侧一格的点,竖拖改开口)/ c(顶点竖拖改 c,保持顶点横坐标)/ b(顶点横拖改对称轴)/ k(直线上 x=2 处竖拖)/ m(直线截距竖拖)
 */
(function (global) {
  'use strict';
  var LS = global.LectureScene;
  var S = LS.svg, fmt = LS.fmt, clamp = LS.clamp;

  var PARAMS = {
    a: { label: 'a', min: -3, max: 3, step: 0.1, def: 1 },
    b: { label: 'b', min: -6, max: 6, step: 0.1, def: -2 },
    c: { label: 'c', min: -6, max: 6, step: 0.1, def: -3 },
    k: { label: 'k', min: -4, max: 4, step: 0.1, def: 1 },
    m: { label: 'm', min: -8, max: 8, step: 0.1, def: 1 }
  };
  var VIEW = { xMin: -6, xMax: 6, yMin: -6, yMax: 8 };
  var W = 960, H = 540;
  var BOX = { x: 70, y: 30, w: 560, h: 480 };

  function mount(container, params, ctx) {
    var svg = S.el('svg', { viewBox: '0 0 ' + W + ' ' + H, preserveAspectRatio: 'xMidYMid meet' });
    container.appendChild(svg);
    var mapper = new LS.Mapper(VIEW, BOX);
    var p = Object.assign({}, defaults(), params || {});
    var visible = { axes: false, parabola: false, vertex: false, line: false, points: false, readout: false };
    var progress = { parabola: 1, line: 1 };
    var layers = {
      axes: S.el('g', { class: 'ls-layer-axes', opacity: 0 }, svg),
      curves: S.el('g', { class: 'ls-layer-curves' }, svg),
      marks: S.el('g', { class: 'ls-layer-marks' }, svg),
      readout: S.el('g', { class: 'ls-layer-readout', opacity: 0 }, svg),
      handles: S.el('g', { class: 'ls-layer-handles' }, svg)
    };
    LS.drawAxes(layers.axes, mapper);
    var parabola = S.el('path', { fill: 'none', stroke: '#1D4ED8', 'stroke-width': 3, 'stroke-linecap': 'round', opacity: 0 }, layers.curves);
    var line = S.el('path', { fill: 'none', stroke: '#C8102E', 'stroke-width': 3, 'stroke-linecap': 'round', opacity: 0 }, layers.curves);
    var vertexG = S.el('g', { opacity: 0 }, layers.marks);
    var vertexDot = S.el('circle', { r: 5, fill: '#1D4ED8' }, vertexG);
    var vertexLabel = S.text(vertexG, 0, 0, '', { 'font-size': 13, fill: '#1D4ED8', 'font-family': 'system-ui, sans-serif', 'font-weight': 700 });
    var pointsG = S.el('g', { opacity: 0 }, layers.marks);
    var eqParabola = S.text(layers.marks, BOX.x + BOX.w + 30, 60, '', { 'font-size': 20, fill: '#1D4ED8', 'font-family': 'Georgia, "Times New Roman", serif', 'font-style': 'italic', opacity: 0 });
    var eqLine = S.text(layers.marks, BOX.x + BOX.w + 30, 96, '', { 'font-size': 20, fill: '#C8102E', 'font-family': 'Georgia, "Times New Roman", serif', 'font-style': 'italic', opacity: 0 });
    // 读数面板
    var ro = layers.readout;
    S.el('rect', { x: BOX.x + BOX.w + 24, y: 130, width: 270, height: 150, rx: 12, fill: '#fff', stroke: '#E5E7EB' }, ro);
    S.text(ro, BOX.x + BOX.w + 40, 156, '联立后的一元二次方程', { 'font-size': 12, fill: '#6B7280', 'font-family': 'system-ui, sans-serif' });
    var roEq = S.text(ro, BOX.x + BOX.w + 40, 182, '', { 'font-size': 15, fill: '#1F2328', 'font-family': 'Georgia, serif', 'font-style': 'italic' });
    var roDelta = S.text(ro, BOX.x + BOX.w + 40, 214, '', { 'font-size': 15, fill: '#1F2328', 'font-family': 'system-ui, sans-serif' });
    var roCount = S.text(ro, BOX.x + BOX.w + 40, 244, '', { 'font-size': 15, fill: '#1F2328', 'font-family': 'system-ui, sans-serif', 'font-weight': 700 });
    var roPts = S.text(ro, BOX.x + BOX.w + 40, 268, '', { 'font-size': 13, fill: '#6B7280', 'font-family': 'system-ui, sans-serif' });

    var onChange = ctx && ctx.onParamChange;
    var f = function (x) { return p.a * x * x + p.b * x + p.c; };
    var g = function (x) { return p.k * x + p.m; };
    var vertex = function () { return p.a === 0 ? null : { x: -p.b / (2 * p.a), y: p.c - (p.b * p.b) / (4 * p.a) }; };
    function eqText(a, b, c, name) {
      var t = name + ' = ';
      t += (a === 1 ? '' : a === -1 ? '−' : fmt(a)) + 'x²';
      if (Math.abs(b) > 1e-9) t += (b < 0 ? ' − ' : ' + ') + (Math.abs(b) === 1 ? '' : fmt(Math.abs(b))) + 'x';
      if (Math.abs(c) > 1e-9) t += (c < 0 ? ' − ' : ' + ') + fmt(Math.abs(c));
      return t.replace('-', '−');
    }
    function lineText() {
      var t = 'y = ' + (p.k === 1 ? '' : p.k === -1 ? '−' : fmt(p.k).replace('-', '−')) + 'x';
      if (Math.abs(p.m) > 1e-9) t += (p.m < 0 ? ' − ' : ' + ') + fmt(Math.abs(p.m));
      return t;
    }
    function intersections() {
      // ax² + (b−k)x + (c−m) = 0
      var A = p.a, B = p.b - p.k, C = p.c - p.m;
      if (Math.abs(A) < 1e-9) {
        if (Math.abs(B) < 1e-9) return { delta: null, xs: [] };
        var x0 = -C / B; return { delta: null, xs: [x0] };
      }
      var delta = B * B - 4 * A * C;
      if (delta < -1e-9) return { delta: delta, xs: [] };
      if (Math.abs(delta) < 1e-9) return { delta: 0, xs: [-B / (2 * A)] };
      var sq = Math.sqrt(delta);
      return { delta: delta, xs: [(-B - sq) / (2 * A), (-B + sq) / (2 * A)].sort(function (u, v) { return u - v; }) };
    }

    function render() {
      S.attr(parabola, { d: LS.functionPath(mapper, f, progress.parabola), opacity: visible.parabola ? 1 : 0 });
      S.attr(line, { d: LS.functionPath(mapper, g, progress.line, 2), opacity: visible.line ? 1 : 0 });
      var vx = vertex();
      if (vx) {
        S.attr(vertexDot, { cx: mapper.px(vx.x), cy: mapper.py(vx.y) });
        S.attr(vertexLabel, { x: mapper.px(vx.x) + 10, y: mapper.py(vx.y) + (p.a > 0 ? 20 : -12) });
        vertexLabel.textContent = '顶点 (' + fmt(vx.x) + ', ' + fmt(vx.y) + ')';
      }
      S.attr(vertexG, { opacity: visible.vertex && vx ? 1 : 0 });
      eqParabola.textContent = eqText(p.a, p.b, p.c, 'y');
      eqLine.textContent = lineText();
      S.attr(eqParabola, { opacity: visible.parabola ? 1 : 0 });
      S.attr(eqLine, { opacity: visible.line ? 1 : 0 });
      // 交点
      var inter = intersections();
      pointsG.innerHTML = '';
      inter.xs.forEach(function (x) {
        var y = g(x);
        if (x < VIEW.xMin || x > VIEW.xMax || y < VIEW.yMin || y > VIEW.yMax) return;
        var gg = S.el('g', null, pointsG);
        S.el('circle', { cx: mapper.px(x), cy: mapper.py(y), r: 9, fill: '#C8102E', 'fill-opacity': 0.15 }, gg);
        S.el('circle', { cx: mapper.px(x), cy: mapper.py(y), r: 5, fill: '#C8102E', stroke: '#fff', 'stroke-width': 2 }, gg);
        S.text(gg, mapper.px(x) + 10, mapper.py(y) - 10, '(' + fmt(x) + ', ' + fmt(y) + ')', { 'font-size': 12.5, fill: '#C8102E', 'font-weight': 700, 'font-family': 'system-ui, sans-serif' });
      });
      S.attr(pointsG, { opacity: visible.points ? 1 : 0 });
      // 读数
      var A = p.a, B = p.b - p.k, C = p.c - p.m;
      roEq.textContent = eqText(A, B, C, '0').replace('0 = ', '') + ' = 0';
      roDelta.textContent = inter.delta == null ? '一次方程(a = 0 时退化)' : 'Δ = (b−k)² − 4a(c−m) = ' + fmt(inter.delta);
      roCount.textContent = '交点个数:' + inter.xs.length + (inter.delta == null ? '' : inter.delta > 1e-9 ? '(Δ > 0,两个实根)' : Math.abs(inter.delta) < 1e-9 ? '(Δ = 0,相切)' : '(Δ < 0,无实根)');
      roCount.setAttribute('fill', inter.xs.length === 1 && inter.delta === 0 ? '#C8102E' : '#1F2328');
      roPts.textContent = inter.xs.length ? '交点横坐标:' + inter.xs.map(function (x) { return fmt(x); }).join(' , ') : '';
      S.attr(layers.readout, { opacity: visible.readout ? 1 : 0 });
      if (!dragging) { var v0 = vertex() || { x: 0, y: p.c }; ax = LS.pickVisibleX(mapper, f, v0.x + 1.5) - v0.x; if (Math.abs(ax) < 0.5) ax = 1.5; kx = LS.pickVisibleX(mapper, g, 2); if (Math.abs(kx) < 0.5) kx = kx < 0 ? -1 : 1; }
      handles.forEach(function (hd) { hd.update(); });
    }

    // 手柄(拖动期间横坐标固定,否则手柄会跟着图象跑;非拖动时按可见性重选位置)
    var handles = [], dragging = false, ax = 1.5, kx = 2;
    function setParam(id, v) {
      var spec = PARAMS[id];
      p[id] = LS.snap(clamp(v, spec.min, spec.max), spec.step);
      if (id === 'a' && Math.abs(p.a) < 0.05) p.a = p.a < 0 ? -0.1 : 0.1; // 不退化成直线
      render();
      onChange && onChange(id, p[id], Object.assign({}, p));
    }
    var vis = function (val) { return clamp(val, VIEW.yMin + 0.4, VIEW.yMax - 0.4); };
    handles.push(new LS.Handle(svg, layers.handles, {
      id: 'a', label: 'a', color: '#1D4ED8',
      get: function () { var v = vertex() || { x: 0, y: p.c }; return { x: mapper.px(v.x + ax), y: mapper.py(vis(f(v.x + ax))) }; },
      onStart: function () { dragging = true; var v = vertex() || { x: 0, y: p.c }; ax = LS.pickVisibleX(mapper, f, v.x + 1.5) - v.x; if (Math.abs(ax) < 0.5) ax = 1.5; },
      onDrag: function (px, py) { var v = vertex() || { x: 0, y: p.c }; setParam('a', (mapper.my(py) - v.y) / (ax * ax)); },
      onEnd: function () { dragging = false; render(); }
    }));
    handles.push(new LS.Handle(svg, layers.handles, {
      id: 'c', label: 'c', color: '#1D4ED8',
      get: function () { return { x: mapper.px(0), y: mapper.py(vis(p.c)) }; },
      onStart: function () { dragging = true; }, onDrag: function (px, py) { setParam('c', mapper.my(py)); }, onEnd: function () { dragging = false; render(); }
    }));
    handles.push(new LS.Handle(svg, layers.handles, {
      id: 'b', label: '对称轴', color: '#1D4ED8',
      get: function () { var v = vertex() || { x: 0, y: p.c }; return { x: mapper.px(clamp(v.x, VIEW.xMin + 0.4, VIEW.xMax - 0.4)), y: mapper.py(vis(v.y)) }; },
      onStart: function () { dragging = true; }, onDrag: function (px) { var h0 = clamp(mapper.mx(px), -5, 5); setParam('b', -2 * p.a * h0); }, onEnd: function () { dragging = false; render(); }
    }));
    handles.push(new LS.Handle(svg, layers.handles, {
      id: 'k', label: 'k', color: '#C8102E',
      get: function () { return { x: mapper.px(kx), y: mapper.py(g(kx)) }; },
      onStart: function () { dragging = true; kx = LS.pickVisibleX(mapper, g, 2); if (Math.abs(kx) < 0.5) kx = kx < 0 ? -1 : 1; },
      onDrag: function (px, py) { setParam('k', (mapper.my(py) - p.m) / kx); },
      onEnd: function () { dragging = false; render(); }
    }));
    handles.push(new LS.Handle(svg, layers.handles, {
      id: 'm', label: 'm', color: '#C8102E',
      get: function () { return { x: mapper.px(0), y: mapper.py(vis(p.m)) }; },
      onStart: function () { dragging = true; }, onDrag: function (px, py) { setParam('m', mapper.my(py)); }, onEnd: function () { dragging = false; render(); }
    }));

    render();

    function setVisible(target, on) {
      if (target === 'axes') S.attr(layers.axes, { opacity: on ? 1 : 0 });
      visible[target] = !!on;
      render();
    }

    var instance = {
      svg: svg,
      getParams: function () { return Object.assign({}, p); },
      setParams: function (np) { Object.assign(p, np); render(); },
      setUnlocked: function (ids) { handles.forEach(function (hd) { hd.setLocked(ids.indexOf(hd.spec.id) < 0); }); },
      /** 通用效果锚点 */
      getAnchor: function (id) {
        var v = vertex() || { x: 0, y: p.c };
        var inter = intersections();
        var vis = function (val, lo, hi) { return clamp(val, lo, hi); };
        var pt = function (x, y) { return { x: mapper.px(vis(x, VIEW.xMin, VIEW.xMax)), y: mapper.py(vis(y, VIEW.yMin, VIEW.yMax)) }; };
        if (id === 'vertex') return Object.assign(pt(v.x, v.y), { r: 22 });
        if (id === 'points') {
          if (!inter.xs.length) return null;
          var x0 = inter.xs[0];
          return Object.assign(pt(x0, g(x0)), { r: 22 });
        }
        if (id === 'line') { var kx0 = LS.pickVisibleX(mapper, g, 2); return Object.assign(pt(kx0, g(kx0)), { r: 26 }); }
        if (id === 'parabola') { var ax0 = LS.pickVisibleX(mapper, f, v.x + 1.5); return Object.assign(pt(ax0, f(ax0)), { r: 26 }); }
        if (id === 'readout') return { x: BOX.x + BOX.w + 24 + 135, y: 205, r: 95 };
        if (id === 'yintercept') return Object.assign(pt(0, p.c), { r: 18 });
        return null;
      },
      beginStep: function () {},
      applyAction: function (act) {
        var dur = act.durationMs == null ? 900 : act.durationMs; var d = function (def) { return act.durationMs == null ? def : act.durationMs; };
        switch (act.type) {
          case 'show':
            if (act.target === 'axes') { visible.axes = true; return LS.tween({ duration: dur, onUpdate: function (t) { S.attr(layers.axes, { opacity: t }); } }); }
            setVisible(act.target, true); return LS.wait(Math.min(dur, 400));
          case 'hide': setVisible(act.target, false); return LS.wait(200);
          case 'draw':
            if (act.target === 'parabola' || act.target === 'line') {
              visible[act.target] = true; progress[act.target] = 0; render();
              return LS.tween({ duration: d(1400), easing: 'easeInOut', onUpdate: function (t) { progress[act.target] = t; render(); } });
            }
            setVisible(act.target, true); return LS.wait(300);
          case 'move': {
            // 参数动画:{type:'move', param:'m', from?:值, to:值}
            var id = act.param, to = Number(act.to), from = act.from == null ? p[id] : Number(act.from);
            p[id] = from; render();
            return LS.tween({ duration: d(1200), onUpdate: function (t) { p[id] = from + (to - from) * t; render(); } });
          }
          case 'highlight': {
            // points:在每个交点处扩散脉冲圈(原实现对 points 无视觉效果,2026-09-04 修复)
            if (act.target === 'points') {
              var inter2 = intersections();
              var rings = inter2.xs.map(function (x) {
                var y = g(x);
                if (x < VIEW.xMin || x > VIEW.xMax || y < VIEW.yMin || y > VIEW.yMax) return null;
                return S.el('circle', { cx: mapper.px(x), cy: mapper.py(y), r: 8, fill: 'none', stroke: '#C8102E', 'stroke-width': 3 }, layers.marks);
              }).filter(Boolean);
              if (!rings.length) return LS.wait(200);
              return LS.tween({ duration: d(900), onUpdate: function (t) {
                rings.forEach(function (rg) { S.attr(rg, { r: 8 + 26 * t, opacity: 1 - t, 'stroke-width': 3 * (1 - t) + 0.5 }); });
              } }).then(function () { rings.forEach(function (rg) { rg.remove(); }); });
            }
            var node = act.target === 'line' ? line : parabola;
            return LS.tween({ duration: d(900), onUpdate: function (t) { var s = 1 + 0.6 * Math.sin(Math.PI * t); S.attr(node, { 'stroke-width': 3 * s, opacity: 1 }); } });
          }
          case 'readout': setVisible('readout', act.on !== false); return LS.wait(300);
          default: return LS.wait(0);
        }
      },
      destroy: function () { svg.remove(); }
    };
    return instance;
  }

  function defaults() { var d = {}; Object.keys(PARAMS).forEach(function (k) { d[k] = PARAMS[k].def; }); return d; }

  LS.registerTemplate({
    id: 'quadratic-line',
    name: '二次函数与直线相交',
    subject: '数学',
    params: PARAMS,
    targets: ['axes', 'parabola', 'vertex', 'line', 'points', 'readout'],
    actions: ['show', 'hide', 'draw', 'move', 'highlight', 'readout'],
    defaults: defaults,
    mount: mount,
    describe: '抛物线 y=ax²+bx+c 与直线 y=kx+m;可拖 a(开口)、b(对称轴)、c(截距)、k(斜率)、m(直线截距);读数给出联立方程、判别式与交点。'
  });
})(window);
