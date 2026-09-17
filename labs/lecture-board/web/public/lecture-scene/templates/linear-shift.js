/*
 * 模板 · 一次函数图象与平移(linear-shift)
 * 参数:k b(原直线 y=kx+b)、d(平移量,正上负下)
 * 元素:axes / line(原直线,蓝)/ shifted(平移后,红)/ points(两个给定点,可选 A、B)/ readout
 * 动作:show / draw(line|shifted)/ move(param d 从 0 到目标,演示平移过程)/ highlight / readout
 * 手柄:k(原直线上 x=2 处竖拖)/ b(原直线截距竖拖)/ d(红线竖拖,改平移量)
 * 剧本可给 params.points = [{x,y,label}] 画出题目里的点,用来验证「平移后过 A、B」。
 */
(function (global) {
  'use strict';
  var LS = global.LectureScene;
  var S = LS.svg, fmt = LS.fmt, clamp = LS.clamp;

  var PARAMS = {
    k: { label: 'k', min: -4, max: 4, step: 0.1, def: 2 },
    b: { label: 'b', min: -8, max: 8, step: 0.1, def: 4 },
    d: { label: '平移量', min: -8, max: 8, step: 0.1, def: -3 }
  };
  var VIEW = { xMin: -5, xMax: 5, yMin: -5, yMax: 7 };
  var W = 960, H = 540;
  var BOX = { x: 70, y: 30, w: 560, h: 480 };

  function signed(v) { return v < 0 ? ' − ' + fmt(Math.abs(v)) : v > 0 ? ' + ' + fmt(v) : ''; }
  function lineText(k, b) { return 'y = ' + (k === 1 ? '' : k === -1 ? '−' : fmt(k).replace('-', '−')) + 'x' + signed(b); }

  function mount(container, params, ctx) {
    var svg = S.el('svg', { viewBox: '0 0 ' + W + ' ' + H, preserveAspectRatio: 'xMidYMid meet' });
    container.appendChild(svg);
    var mapper = new LS.Mapper(VIEW, BOX);
    var p = Object.assign({}, defaults(), params || {});
    var extraPoints = (params && params.points) || [];
    var visible = { axes: false, line: false, shifted: false, points: false, readout: false, arrows: false };
    var progress = { line: 1, shifted: 1 };
    var layers = {
      axes: S.el('g', { opacity: 0 }, svg),
      curves: S.el('g', null, svg),
      marks: S.el('g', null, svg),
      readout: S.el('g', { opacity: 0 }, svg),
      handles: S.el('g', null, svg)
    };
    LS.drawAxes(layers.axes, mapper);
    var line = S.el('path', { fill: 'none', stroke: '#1D4ED8', 'stroke-width': 3, 'stroke-linecap': 'round', opacity: 0 }, layers.curves);
    var shifted = S.el('path', { fill: 'none', stroke: '#C8102E', 'stroke-width': 3, 'stroke-linecap': 'round', opacity: 0 }, layers.curves);
    var arrows = S.el('g', { opacity: 0 }, layers.marks);
    var ptsG = S.el('g', { opacity: 0 }, layers.marks);
    var eqLine = S.text(layers.marks, BOX.x + BOX.w + 30, 60, '', { 'font-size': 20, fill: '#1D4ED8', 'font-family': 'Georgia, serif', 'font-style': 'italic', opacity: 0 });
    var eqShift = S.text(layers.marks, BOX.x + BOX.w + 30, 96, '', { 'font-size': 20, fill: '#C8102E', 'font-family': 'Georgia, serif', 'font-style': 'italic', opacity: 0 });
    var ro = layers.readout;
    S.el('rect', { x: BOX.x + BOX.w + 24, y: 130, width: 270, height: 130, rx: 12, fill: '#fff', stroke: '#E5E7EB' }, ro);
    S.text(ro, BOX.x + BOX.w + 40, 156, '平移规律', { 'font-size': 12, fill: '#6B7280', 'font-family': 'system-ui, sans-serif' });
    var roRule = S.text(ro, BOX.x + BOX.w + 40, 182, '', { 'font-size': 15, fill: '#1F2328', 'font-family': 'system-ui, sans-serif' });
    var roK = S.text(ro, BOX.x + BOX.w + 40, 212, '', { 'font-size': 15, fill: '#1F2328', 'font-family': 'system-ui, sans-serif' });
    var roPts = S.text(ro, BOX.x + BOX.w + 40, 242, '', { 'font-size': 13, fill: '#6B7280', 'font-family': 'system-ui, sans-serif' });
    var onChange = ctx && ctx.onParamChange;

    var f = function (x) { return p.k * x + p.b; };
    var g = function (x) { return p.k * x + p.b + p.d; };

    function render() {
      S.attr(line, { d: LS.functionPath(mapper, f, progress.line, 2), opacity: visible.line ? 1 : 0 });
      S.attr(shifted, { d: LS.functionPath(mapper, g, progress.shifted, 2), opacity: visible.shifted ? 1 : 0 });
      eqLine.textContent = lineText(p.k, p.b);
      eqShift.textContent = lineText(p.k, p.b + p.d);
      S.attr(eqLine, { opacity: visible.line ? 1 : 0 });
      S.attr(eqShift, { opacity: visible.shifted ? 1 : 0 });
      // 平移箭头:在 x = -2, 0, 2 三处画竖直箭头
      arrows.innerHTML = '';
      if (Math.abs(p.d) > 0.05) {
        [-2, 0, 2].forEach(function (x) {
          var y1 = f(x), y2 = g(x);
          var a = S.el('line', { x1: mapper.px(x), y1: mapper.py(y1), x2: mapper.px(x), y2: mapper.py(y2), stroke: '#6B7280', 'stroke-width': 1.5, 'stroke-dasharray': '4 3' }, arrows);
          var dir = y2 > y1 ? -1 : 1;
          S.el('path', { d: 'M' + mapper.px(x) + ' ' + mapper.py(y2) + ' l-5 ' + (dir * 8) + ' h10 z', fill: '#6B7280' }, arrows);
          if (x === 0) S.text(arrows, mapper.px(x) + 8, (mapper.py(y1) + mapper.py(y2)) / 2, (p.d > 0 ? '上移 ' : '下移 ') + fmt(Math.abs(p.d)), { 'font-size': 12.5, fill: '#6B7280', 'font-family': 'system-ui, sans-serif' });
        });
      }
      S.attr(arrows, { opacity: visible.arrows ? 1 : 0 });
      // 给定点:落在红线上则打勾
      ptsG.innerHTML = '';
      extraPoints.forEach(function (pt) {
        var onShifted = Math.abs(g(pt.x) - pt.y) < 0.05;
        var gg = S.el('g', null, ptsG);
        S.el('circle', { cx: mapper.px(pt.x), cy: mapper.py(pt.y), r: 6, fill: onShifted ? '#059669' : '#1F2328', stroke: '#fff', 'stroke-width': 2 }, gg);
        S.text(gg, mapper.px(pt.x) + 10, mapper.py(pt.y) - 8, (pt.label || '') + '(' + fmt(pt.x) + ', ' + fmt(pt.y) + ')' + (onShifted ? ' ✓' : ''), { 'font-size': 12.5, fill: onShifted ? '#059669' : '#1F2328', 'font-weight': 700, 'font-family': 'system-ui, sans-serif' });
      });
      S.attr(ptsG, { opacity: visible.points ? 1 : 0 });
      roRule.textContent = p.d === 0 ? '未平移' : (p.d > 0 ? '向上平移 ' : '向下平移 ') + fmt(Math.abs(p.d)) + ':b → b ' + (p.d > 0 ? '+ ' : '− ') + fmt(Math.abs(p.d));
      roK.textContent = '斜率 k = ' + fmt(p.k) + ' 不变;截距 ' + fmt(p.b) + ' → ' + fmt(p.b + p.d);
      roPts.textContent = extraPoints.length ? '给定点' + (extraPoints.every(function (pt) { return Math.abs(g(pt.x) - pt.y) < 0.05; }) ? '都在平移后的直线上 ✓' : '不全在平移后的直线上') : '';
      S.attr(layers.readout, { opacity: visible.readout ? 1 : 0 });
      if (!dragging) { kx = LS.pickVisibleX(mapper, f, 2); if (Math.abs(kx) < 0.5) kx = kx < 0 ? -1 : 1; dx = LS.pickVisibleX(mapper, g, -1); }
      handles.forEach(function (hd) { hd.update(); });
    }

    var handles = [], dragging = false;
    function setParam(id, v) {
      var spec = PARAMS[id];
      p[id] = LS.snap(clamp(v, spec.min, spec.max), spec.step);
      render();
      onChange && onChange(id, p[id], Object.assign({}, p));
    }
    var kx = 2; // k 手柄所在横坐标(随可见性调整,拖动期间固定)
    handles.push(new LS.Handle(svg, layers.handles, {
      id: 'k', label: 'k', color: '#1D4ED8',
      get: function () { return { x: mapper.px(kx), y: mapper.py(f(kx)) }; },
      onStart: function () { dragging = true; kx = LS.pickVisibleX(mapper, f, 2); if (Math.abs(kx) < 0.5) kx = kx < 0 ? -1 : 1; },
      onDrag: function (px, py) { setParam('k', (mapper.my(py) - p.b) / kx); },
      onEnd: function () { dragging = false; render(); }
    }));
    handles.push(new LS.Handle(svg, layers.handles, {
      id: 'b', label: 'b', color: '#1D4ED8',
      get: function () { return { x: mapper.px(0), y: mapper.py(clamp(p.b, VIEW.yMin + 0.4, VIEW.yMax - 0.4)) }; },
      onStart: function () { dragging = true; },
      onDrag: function (px, py) { setParam('b', mapper.my(py)); },
      onEnd: function () { dragging = false; render(); }
    }));
    var dx = -1;
    handles.push(new LS.Handle(svg, layers.handles, {
      id: 'd', label: '平移', color: '#C8102E',
      get: function () { return { x: mapper.px(dx), y: mapper.py(g(dx)) }; },
      onStart: function () { dragging = true; dx = LS.pickVisibleX(mapper, g, -1); },
      onDrag: function (px, py) { setParam('d', mapper.my(py) - f(dx)); },
      onEnd: function () { dragging = false; render(); }
    }));
    render();

    function setVisible(t, on) { visible[t] = !!on; if (t === 'axes') S.attr(layers.axes, { opacity: on ? 1 : 0 }); render(); }

    return {
      svg: svg,
      getParams: function () { return Object.assign({}, p); },
      setParams: function (np) { var q = Object.assign({}, np); if (q.points) { extraPoints = q.points; delete q.points; } Object.assign(p, q); render(); },
      setUnlocked: function (ids) { handles.forEach(function (hd) { hd.setLocked(ids.indexOf(hd.spec.id) < 0); }); },
      /** 通用效果锚点 */
      getAnchor: function (id) {
        var vis = function (x, y) { return { x: mapper.px(clamp(x, VIEW.xMin, VIEW.xMax)), y: mapper.py(clamp(y, VIEW.yMin, VIEW.yMax)) }; };
        if (id === 'line') { var x1 = LS.pickVisibleX(mapper, f, 2); return Object.assign(vis(x1, f(x1)), { r: 26 }); }
        if (id === 'shifted') { var x2 = LS.pickVisibleX(mapper, g, -1); return Object.assign(vis(x2, g(x2)), { r: 26 }); }
        if (id === 'points') { if (!extraPoints.length) return null; var pt = extraPoints[0]; return Object.assign(vis(pt.x, pt.y), { r: 20 }); }
        if (id === 'bIntercept') return Object.assign(vis(0, p.b), { r: 18 });
        if (id === 'arrows') return Object.assign(vis(0, (f(0) + g(0)) / 2), { r: 24 });
        if (id === 'readout') return { x: BOX.x + BOX.w + 24 + 135, y: 195, r: 90 };
        return null;
      },
      applyAction: function (act) {
        var dur = act.durationMs == null ? 900 : act.durationMs; var d = function (def) { return act.durationMs == null ? def : act.durationMs; };
        switch (act.type) {
          case 'show':
            if (act.target === 'axes') { visible.axes = true; return LS.tween({ duration: dur, onUpdate: function (t) { S.attr(layers.axes, { opacity: t }); } }); }
            setVisible(act.target, true); return LS.wait(Math.min(dur, 400));
          case 'hide': setVisible(act.target, false); return LS.wait(200);
          case 'draw':
            if (act.target === 'line' || act.target === 'shifted') {
              visible[act.target] = true; progress[act.target] = 0; render();
              return LS.tween({ duration: d(1200), onUpdate: function (t) { progress[act.target] = t; render(); } });
            }
            setVisible(act.target, true); return LS.wait(300);
          case 'move': {
            var id = act.param || 'd', to = Number(act.to), from = act.from == null ? p[id] : Number(act.from);
            if (id === 'd') { visible.shifted = true; visible.arrows = true; }
            p[id] = from; render();
            return LS.tween({ duration: d(1400), onUpdate: function (t) { p[id] = from + (to - from) * t; render(); } });
          }
          case 'highlight': {
            var node = act.target === 'shifted' ? shifted : act.target === 'points' ? ptsG : line;
            return LS.tween({ duration: d(900), onUpdate: function (t) { if (node !== ptsG) S.attr(node, { 'stroke-width': 3 * (1 + 0.6 * Math.sin(Math.PI * t)) }); } });
          }
          case 'readout': setVisible('readout', act.on !== false); return LS.wait(300);
          default: return LS.wait(0);
        }
      },
      destroy: function () { svg.remove(); }
    };
  }
  function defaults() { var d = {}; Object.keys(PARAMS).forEach(function (k) { d[k] = PARAMS[k].def; }); return d; }

  LS.registerTemplate({
    id: 'linear-shift',
    name: '一次函数图象与平移',
    subject: '数学',
    params: PARAMS,
    targets: ['axes', 'line', 'shifted', 'arrows', 'points', 'readout'],
    actions: ['show', 'hide', 'draw', 'move', 'highlight', 'readout'],
    defaults: defaults,
    mount: mount,
    describe: '原直线 y=kx+b(蓝)与平移后直线(红),d 为平移量;可给 points 画题目里的点并自动判断是否落在平移后直线上;可拖 k、b、d。'
  });
})(window);
