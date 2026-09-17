/*
 * 模板 · 一维小车碰撞(cart-collision)
 * 参数:m1 m2(质量,kg)、v1 v2(初速度,m/s,右为正)、x1(小车 A 起点,m)、e(恢复系数 0 完全非弹性 … 1 完全弹性)
 * 元素:track 轨道 / carts 两辆车 / arrows 速度箭头 / bars 动量条 / readout 读数
 * 动作:show(target)/ run(phase: 'approach' 滑行到接触 | 'collide' 碰撞定格 | 'rebound' 碰后运动 | 'all' 全过程)/ reset / readout
 * 手柄:x1(拖车 A 改起点)/ v1(拖 A 的箭头尖改初速度)/ m2、e(画布内滑杆)
 * 物理:碰撞瞬时完成,用恢复系数公式;地面无摩擦;轨道范围 0..10 m。
 */
(function (global) {
  'use strict';
  var LS = global.LectureScene;
  var S = LS.svg, fmt = LS.fmt, clamp = LS.clamp;

  var PARAMS = {
    m1: { label: 'm₁(kg)', min: 0.5, max: 5, step: 0.5, def: 2 },
    m2: { label: 'm₂(kg)', min: 0.5, max: 5, step: 0.5, def: 1 },
    v1: { label: 'v₁(m/s)', min: -4, max: 4, step: 0.5, def: 3 },
    v2: { label: 'v₂(m/s)', min: -4, max: 4, step: 0.5, def: 0 },
    x1: { label: 'A 起点(m)', min: 0.5, max: 5, step: 0.5, def: 1.5 },
    e: { label: '恢复系数 e', min: 0, max: 1, step: 0.1, def: 1 }
  };
  var W = 960, H = 540;
  var TRACK = { x: 60, y: 300, w: 620, len: 10 }; // 10 m 轨道
  var X2_START = 7; // 小车 B 起点固定(m)
  var CART_W = 0.9; // 车长(m)

  function mount(container, params, ctx) {
    var svg = S.el('svg', { viewBox: '0 0 ' + W + ' ' + H, preserveAspectRatio: 'xMidYMid meet' });
    container.appendChild(svg);
    var p = Object.assign({}, defaults(), params || {});
    var onChange = ctx && ctx.onParamChange;
    var px = function (m) { return TRACK.x + (m / TRACK.len) * TRACK.w; };
    var mx = function (x) { return ((x - TRACK.x) / TRACK.w) * TRACK.len; };
    var visible = { track: false, carts: false, arrows: false, bars: false, readout: false };
    // 运动状态(与参数分离:参数是初始条件,state 是当前画面)
    var st = { xA: p.x1, xB: X2_START, vA: p.v1, vB: p.v2, phase: 'idle', collided: false, vAp: null, vBp: null };

    var layers = { track: S.el('g', { opacity: 0 }, svg), carts: S.el('g', { opacity: 0 }, svg), bars: S.el('g', { opacity: 0 }, svg), readout: S.el('g', { opacity: 0 }, svg), handles: S.el('g', null, svg) };
    // 轨道
    S.el('rect', { x: TRACK.x - 10, y: TRACK.y, width: TRACK.w + 20, height: 10, rx: 3, fill: '#D1D5DB' }, layers.track);
    for (var i = 0; i <= TRACK.len; i++) { S.el('line', { x1: px(i), y1: TRACK.y + 10, x2: px(i), y2: TRACK.y + 18, stroke: '#9CA3AF' }, layers.track); S.text(layers.track, px(i), TRACK.y + 34, i + ' m', { 'text-anchor': 'middle', 'font-size': 11, fill: '#6B7280', 'font-family': 'system-ui, sans-serif' }); }
    // 小车
    function cart(color, label) {
      var g = S.el('g', null, layers.carts);
      var body = S.el('rect', { x: 0, y: -46, width: 0, height: 34, rx: 6, fill: color }, g);
      var w1 = S.el('circle', { cx: 0, cy: -6, r: 7, fill: '#374151' }, g);
      var w2 = S.el('circle', { cx: 0, cy: -6, r: 7, fill: '#374151' }, g);
      var lab = S.text(g, 0, -56, label, { 'text-anchor': 'middle', 'font-size': 13, fill: color, 'font-weight': 800, 'font-family': 'system-ui, sans-serif' });
      var mass = S.text(g, 0, -24, '', { 'text-anchor': 'middle', 'font-size': 12, fill: '#fff', 'font-weight': 700, 'font-family': 'system-ui, sans-serif' });
      var arrow = S.el('g', { opacity: 0 }, g);
      var shaft = S.el('line', { x1: 0, y1: -80, x2: 0, y2: -80, stroke: color, 'stroke-width': 3 }, arrow);
      var head = S.el('path', { d: '', fill: color }, arrow);
      var vlab = S.text(arrow, 0, -90, '', { 'text-anchor': 'middle', 'font-size': 12.5, fill: color, 'font-weight': 700, 'font-family': 'system-ui, sans-serif' });
      return { g: g, body: body, w1: w1, w2: w2, lab: lab, mass: mass, arrow: arrow, shaft: shaft, head: head, vlab: vlab, color: color };
    }
    var A = cart('#1D4ED8', 'A'), B = cart('#C8102E', 'B');
    var flash = S.el('circle', { r: 0, fill: '#F59E0B', 'fill-opacity': 0.5 }, layers.carts);
    // 动量条
    var barsX = 720, barsY = 80;
    S.text(layers.bars, barsX, barsY - 16, '动量 p = mv(kg·m/s)', { 'font-size': 12, fill: '#6B7280', 'font-family': 'system-ui, sans-serif' });
    function bar(y, color, label) {
      S.text(layers.bars, barsX, y + 12, label, { 'font-size': 12, fill: '#1F2328', 'font-family': 'system-ui, sans-serif' });
      S.el('line', { x1: barsX + 110, y1: y - 4, x2: barsX + 110, y2: y + 20, stroke: '#9CA3AF' }, layers.bars);
      var r = S.el('rect', { x: barsX + 110, y: y, width: 0, height: 16, rx: 3, fill: color }, layers.bars);
      var t = S.text(layers.bars, barsX + 110, y + 34, '', { 'font-size': 11.5, fill: '#6B7280', 'font-family': 'system-ui, sans-serif' });
      return { r: r, t: t };
    }
    var barA = bar(barsY, '#1D4ED8', 'A'), barB = bar(barsY + 48, '#C8102E', 'B'), barT = bar(barsY + 96, '#374151', '总动量');
    // 读数
    var ro = layers.readout;
    S.el('rect', { x: 700, y: 250, width: 240, height: 130, rx: 12, fill: '#fff', stroke: '#E5E7EB' }, ro);
    var roBefore = S.text(ro, 716, 278, '', { 'font-size': 13, fill: '#1F2328', 'font-family': 'system-ui, sans-serif' });
    var roAfter = S.text(ro, 716, 304, '', { 'font-size': 13, fill: '#1F2328', 'font-family': 'system-ui, sans-serif', 'font-weight': 700 });
    var roP = S.text(ro, 716, 330, '', { 'font-size': 13, fill: '#1F2328', 'font-family': 'system-ui, sans-serif' });
    var roE = S.text(ro, 716, 356, '', { 'font-size': 13, fill: '#6B7280', 'font-family': 'system-ui, sans-serif' });

    function cartWidthPx() { return (CART_W / TRACK.len) * TRACK.w; }
    function drawCart(c, x, v, m) {
      var w = cartWidthPx();
      var h = 24 + m * 4; // 质量越大车越高
      S.attr(c.g, { transform: 'translate(' + px(x).toFixed(1) + ',' + TRACK.y + ')' });
      S.attr(c.body, { width: w, height: h, y: -12 - h });
      S.attr(c.w1, { cx: w * 0.25 }); S.attr(c.w2, { cx: w * 0.75 });
      S.attr(c.lab, { x: w / 2, y: -h - 22 });
      S.attr(c.mass, { x: w / 2, y: -12 - h / 2 + 4 }); c.mass.textContent = fmt(m) + ' kg';
      var len = v * 22; // 1 m/s = 22 px
      var y = -h - 46;
      S.attr(c.shaft, { x1: w / 2, y1: y, x2: w / 2 + len, y2: y });
      var tipX = w / 2 + len, dir = v >= 0 ? 1 : -1;
      S.attr(c.head, { d: Math.abs(v) < 0.05 ? '' : 'M' + tipX + ' ' + y + ' l' + (-dir * 10) + ' -6 v12 z' });
      S.attr(c.vlab, { x: w / 2 + len / 2, y: y - 10 }); c.vlab.textContent = 'v = ' + fmt(v) + ' m/s';
      S.attr(c.arrow, { opacity: visible.arrows ? 1 : 0 });
    }
    function render() {
      drawCart(A, st.xA, st.vA, p.m1);
      drawCart(B, st.xB, st.vB, p.m2);
      var pA = p.m1 * st.vA, pB = p.m2 * st.vB, pT = pA + pB;
      // 动量条比例自适应:最大不超过 110px,防止大参数时溢出画布(2026-09-04 修复)
      var maxAbs = Math.max(Math.abs(pA), Math.abs(pB), Math.abs(pT), 1e-6);
      var scale = Math.min(18, 110 / maxAbs);
      [[barA, pA], [barB, pB], [barT, pT]].forEach(function (pair) {
        var val = pair[1];
        S.attr(pair[0].r, { x: val >= 0 ? barsX + 110 : barsX + 110 + val * scale, width: Math.abs(val) * scale });
        pair[0].t.textContent = fmt(val, 2);
      });
      S.attr(layers.bars, { opacity: visible.bars ? 1 : 0 });
      var post = LS.collide1D(p.m1, p.v1, p.m2, p.v2, p.e);
      var pBefore = p.m1 * p.v1 + p.m2 * p.v2, pAfterV = p.m1 * post.v1 + p.m2 * post.v2;
      var kBefore = 0.5 * p.m1 * p.v1 * p.v1 + 0.5 * p.m2 * p.v2 * p.v2, kAfter = 0.5 * p.m1 * post.v1 * post.v1 + 0.5 * p.m2 * post.v2 * post.v2;
      roBefore.textContent = '碰前:v₁ = ' + fmt(p.v1) + ',v₂ = ' + fmt(p.v2);
      roAfter.textContent = '碰后:v₁\' = ' + fmt(post.v1) + ',v₂\' = ' + fmt(post.v2);
      roP.textContent = '总动量 ' + fmt(pBefore) + ' → ' + fmt(pAfterV) + '(守恒)';
      roE.textContent = '动能 ' + fmt(kBefore) + ' → ' + fmt(kAfter) + (p.e >= 0.999 ? '(弹性,守恒)' : '(损失 ' + fmt(kBefore - kAfter) + ')');
      S.attr(layers.readout, { opacity: visible.readout ? 1 : 0 });
      S.attr(layers.carts, { opacity: visible.carts ? 1 : 0 });
      // 滑杆也要随参数刷新:剧本/步骤改参数(如 e 设 0)时滑杆位置同步(2026-09-04 修复)
      (allHandles || handles).forEach(function (hd) { hd.update(); });
    }
    function resetMotion() { st.xA = p.x1; st.xB = X2_START; st.vA = p.v1; st.vB = p.v2; st.collided = false; st.phase = 'idle'; S.attr(flash, { r: 0 }); render(); }

    // 手柄与滑杆
    var handles = [];
    function setParam(id, v) {
      var spec = PARAMS[id]; p[id] = LS.snap(clamp(v, spec.min, spec.max), spec.step);
      resetMotion();
      onChange && onChange(id, p[id], Object.assign({}, p));
    }
    handles.push(new LS.Handle(svg, layers.handles, {
      id: 'x1', label: '起点', color: '#1D4ED8',
      get: function () { return { x: px(st.xA) + cartWidthPx() / 2, y: TRACK.y + 2 }; },
      onDrag: function (x) { setParam('x1', mx(x - cartWidthPx() / 2)); }
    }));
    handles.push(new LS.Handle(svg, layers.handles, {
      id: 'v1', label: 'v₁', color: '#1D4ED8',
      get: function () { var h = 24 + p.m1 * 4; return { x: px(st.xA) + cartWidthPx() / 2 + p.v1 * 22, y: TRACK.y - h - 46 }; },
      onDrag: function (x) { setParam('v1', (x - px(st.xA) - cartWidthPx() / 2) / 22); }
    }));
    var sliders = [
      new LS.Slider(svg, layers.handles, { id: 'm2', label: 'm₂ 质量(kg)', min: 0.5, max: 5, step: 0.5, x: 80, y: 420, width: 200, color: '#C8102E', get: function () { return p.m2; }, set: function (v) { setParam('m2', v); } }),
      new LS.Slider(svg, layers.handles, { id: 'm1', label: 'm₁ 质量(kg)', min: 0.5, max: 5, step: 0.5, x: 80, y: 480, width: 200, color: '#1D4ED8', get: function () { return p.m1; }, set: function (v) { setParam('m1', v); } }),
      new LS.Slider(svg, layers.handles, { id: 'e', label: '恢复系数 e(0 粘住 · 1 完全弹性)', min: 0, max: 1, step: 0.1, x: 380, y: 420, width: 200, color: '#374151', get: function () { return p.e; }, set: function (v) { setParam('e', v); } }),
      new LS.Slider(svg, layers.handles, { id: 'v2', label: 'v₂ B 初速度(m/s)', min: -4, max: 4, step: 0.5, x: 380, y: 480, width: 200, color: '#C8102E', get: function () { return p.v2; }, set: function (v) { setParam('v2', v); } })
    ];
    var allHandles = handles.concat(sliders);
    resetMotion();

    // 「时间加速」角标(滑行时间太长时压缩播放,如实标注)
    var speedTag = S.text(layers.carts, TRACK.x + TRACK.w - 4, TRACK.y - 130, '', { 'text-anchor': 'end', 'font-size': 12, fill: '#9CA3AF', 'font-family': 'system-ui, sans-serif' });

    /** 跑一段过程:从当前状态积分到接触(approach)/ 碰撞定格(collide,须已接触)/ 碰后运动(rebound) */
    function simulate(phase, ctx) {
      var MAX_PLAY = 2.5; // 单段动画最长播放秒数,超过则压缩并标注「时间加速」
      if (phase === 'approach') {
        var gap = st.xB - (st.xA + CART_W);
        var rel = st.vA - st.vB;
        if (rel <= 0 || gap <= 0) return LS.wait(300); // 追不上 / 已接触
        var T = gap / rel;
        // B 在接触前就会滑出轨道 → 只演到 B 到边界为止,不发生碰撞(collide 有接触守卫)
        if (st.vB > 0) T = Math.min(T, (TRACK.len - CART_W - st.xB) / st.vB);
        var dur = Math.min(T, MAX_PLAY);
        speedTag.textContent = T > MAX_PLAY ? '时间加速 ×' + fmt(T / MAX_PLAY, 1) : '';
        var xa0 = st.xA, xb0 = st.xB;
        return LS.tween({ duration: dur * 1000, easing: 'linear', onUpdate: function (t) { st.xA = xa0 + st.vA * T * t; st.xB = xb0 + st.vB * T * t; render(); } })
          .then(function () { speedTag.textContent = ''; });
      }
      if (phase === 'collide') {
        // 接触守卫:两车没贴上就不碰(防「隔空碰撞」,2026-09-04 修复)
        var gapNow = st.xB - (st.xA + CART_W);
        if (gapNow > 0.05) {
          var relNow = st.vA - st.vB;
          if (relNow > 0) return simulate('approach', ctx).then(function () { return simulate('collide', ctx); });
          return LS.wait(300); // 追不上,碰撞不会发生
        }
        var post = LS.collide1D(p.m1, st.vA, p.m2, st.vB, p.e);
        st.collided = true; st.vAp = post.v1; st.vBp = post.v2;
        S.attr(flash, { cx: px(st.xA + CART_W), cy: TRACK.y - 30 });
        return LS.tween({ duration: 500, onUpdate: function (t) { S.attr(flash, { r: 40 * Math.sin(Math.PI * t) }); } }).then(function () { st.vA = post.v1; st.vB = post.v2; render(); return LS.wait(400); });
      }
      if (phase === 'rebound') {
        // 播放时长取「任一车到轨道边界」与 1.6s 的较小者:不再出现撞墙冻结、箭头还有速度的矛盾画面(2026-09-04 修复)
        var T2 = 1.6, xa1 = st.xA, xb1 = st.xB, va = st.vA, vb = st.vB;
        var tEdge = function (x, v) { return v > 0 ? (TRACK.len - CART_W - x) / v : v < 0 ? -x / v : Infinity; };
        T2 = Math.max(0.4, Math.min(T2, tEdge(xa1, va), tEdge(xb1, vb)));
        return LS.tween({ duration: T2 * 1000, easing: 'linear', onUpdate: function (t) {
          st.xA = clamp(xa1 + va * T2 * t, 0, TRACK.len - CART_W); st.xB = clamp(xb1 + vb * T2 * t, 0, TRACK.len - CART_W);
          if (p.e < 0.05 && st.collided) { st.xB = st.xA + CART_W; } // 完全非弹性:粘在一起
          render();
        } });
      }
      if (phase === 'all') return simulate('approach').then(function () { return simulate('collide'); }).then(function () { return simulate('rebound'); });
      return LS.wait(0);
    }

    return {
      svg: svg,
      getParams: function () { return Object.assign({}, p); },
      setParams: function (np) { Object.assign(p, np); resetMotion(); },
      setUnlocked: function (ids) { allHandles.forEach(function (hd) { hd.setLocked(ids.indexOf(hd.spec.id) < 0); }); },
      /** 通用效果锚点(label/focus/pulse 的 target) */
      getAnchor: function (id) {
        var hA = 24 + p.m1 * 4, hB = 24 + p.m2 * 4;
        var map = {
          cartA: { x: px(st.xA) + cartWidthPx() / 2, y: TRACK.y - 12 - hA / 2, r: 34 },
          cartB: { x: px(st.xB) + cartWidthPx() / 2, y: TRACK.y - 12 - hB / 2, r: 34 },
          bars: { x: barsX + 110, y: barsY + 60, r: 90 },
          readout: { x: 820, y: 315, r: 92 },
          track: { x: px(5), y: TRACK.y + 8, r: 60 }
        };
        return map[id] || null;
      },
      beginStep: function () { resetMotion(); },
      applyAction: function (act) {
        var dur = act.durationMs == null ? 700 : act.durationMs; var d = function (def) { return act.durationMs == null ? def : act.durationMs; };
        switch (act.type) {
          case 'show': {
            var map = { track: layers.track, carts: layers.carts, bars: layers.bars, readout: layers.readout };
            visible[act.target] = true;
            if (act.target === 'arrows') { render(); return LS.wait(300); }
            var node = map[act.target]; if (!node) return LS.wait(0);
            render();
            return LS.tween({ duration: dur, onUpdate: function (t) { S.attr(node, { opacity: t }); } });
          }
          case 'hide': visible[act.target] = false; render(); return LS.wait(200);
          case 'run': return simulate(act.phase || 'all');
          case 'reset': resetMotion(); return LS.wait(300);
          case 'readout': visible.readout = act.on !== false; render(); return LS.wait(300);
          default: return LS.wait(0);
        }
      },
      destroy: function () { svg.remove(); }
    };
  }
  function defaults() { var d = {}; Object.keys(PARAMS).forEach(function (k) { d[k] = PARAMS[k].def; }); return d; }

  LS.registerTemplate({
    id: 'cart-collision',
    name: '一维小车碰撞',
    subject: '物理',
    params: PARAMS,
    targets: ['track', 'carts', 'arrows', 'bars', 'readout'],
    actions: ['show', 'hide', 'run', 'reset', 'readout'],
    defaults: defaults,
    mount: mount,
    describe: '小车 A 以 v₁ 滑向静止(或运动)的小车 B,按恢复系数 e 碰撞后各自运动;动量条实时显示 p 与总动量;可拖 A 的起点与速度箭头,滑杆改质量、e、v₂。run 动作分 approach / collide / rebound / all。'
  });
})(window);
