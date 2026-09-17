/*
 * 模板 · 浮力与浮沉(buoyancy)
 * 案例题型:注水/排水的潜艇模型——桌面压强、浸没浮力、浮沉判据、上浮时浮力做功(2026-09-04,题 2)
 * 参数:V(体积,×10⁻⁴ m³)m0(模型质量 kg)mw(水舱注水 kg)S(底面积,×10⁻³ m²)h(上浮高度 m)
 * 元素:desk 桌面场景 / tank 水槽 / model 模型 / forces 力箭头 / bars 力条(F浮 vs G)/ readout 读数
 * 动作:show/hide/move/readout + run(phase:'towater' 入水并按判据落位 | 'rise' 竖直上浮 h | 'settle' 按判据落位)
 * 手柄:mw m0 V S 滑杆;h 拖模型(水中竖直拖)
 * 物理:ρ水=1000,g=10;浸没 F浮=ρgV;G总=(m0+mw)g;沉底 G总>F浮,漂浮时 V排=G总/(ρg);上浮未露出水面 W=F浮·h
 */
(function (global) {
  'use strict';
  var LS = global.LectureScene;
  var S = LS.svg, fmt = LS.fmt, clamp = LS.clamp;

  var RHO_G = 10000; // ρ·g = 1000 × 10(每 m³ 的浮力,N)
  var G = 10;

  var PARAMS = {
    V: { label: '体积(×10⁻⁴ m³)', min: 2, max: 10, step: 0.5, def: 6 },
    m0: { label: '模型质量(kg)', min: 0.1, max: 1.5, step: 0.01, def: 0.48 },
    mw: { label: '注水(kg)', min: 0, max: 1.2, step: 0.02, def: 0.6 },
    S: { label: '底面积(×10⁻³ m²)', min: 2, max: 20, step: 0.5, def: 8 },
    h: { label: '上浮高度(m)', min: 0, max: 0.4, step: 0.05, def: 0.2 }
  };
  var W = 960, H = 540;
  var DESK = { x: 80, w: 200, topY: 320 };            // 桌面
  var TANK = { x: 340, w: 300, topY: 110, botY: 440 }; // 水槽
  var WATER_Y = 160;                                    // 水面
  var MODEL = { w: 76, h: 40 };
  var DEPTH_M = 1.0; // 水面到水底名义深度 1 m(上浮 h 按此比例映射像素)
  var PXPM = (TANK.botY - 8 - WATER_Y - MODEL.h) / DEPTH_M; // 每米像素

  function mount(container, params, ctx) {
    var svg = S.el('svg', { viewBox: '0 0 ' + W + ' ' + H, preserveAspectRatio: 'xMidYMid meet' });
    container.appendChild(svg);
    var p = Object.assign({}, defaults(), params || {});
    var onChange = ctx && ctx.onParamChange;
    var visible = { desk: false, tank: false, model: false, forces: false, bars: false, readout: false };
    // 位置状态:desk 桌上 | bottom 水底 | risen 水底上方 h | float 漂浮 | suspend 悬浮
    var st = { loc: 'desk', y: 0 };

    var layers = {
      desk: S.el('g', { opacity: 0 }, svg),
      tank: S.el('g', { opacity: 0 }, svg),
      model: S.el('g', { opacity: 0 }, svg),
      forces: S.el('g', { opacity: 0 }, svg),
      bars: S.el('g', { opacity: 0 }, svg),
      readout: S.el('g', { opacity: 0 }, svg),
      handles: S.el('g', null, svg)
    };

    // 桌面
    S.el('rect', { x: DESK.x, y: DESK.topY, width: DESK.w, height: 12, rx: 3, fill: '#A16207' }, layers.desk);
    S.el('rect', { x: DESK.x + 18, y: DESK.topY + 12, width: 14, height: 90, fill: '#A16207' }, layers.desk);
    S.el('rect', { x: DESK.x + DESK.w - 32, y: DESK.topY + 12, width: 14, height: 90, fill: '#A16207' }, layers.desk);
    S.text(layers.desk, DESK.x + DESK.w / 2, DESK.topY + 126, '桌面', { 'text-anchor': 'middle', 'font-size': 12, fill: '#6B7280', 'font-family': 'system-ui, sans-serif' });

    // 水槽与水
    S.el('path', { d: 'M' + TANK.x + ' ' + TANK.topY + ' V' + TANK.botY + ' H' + (TANK.x + TANK.w) + ' V' + TANK.topY, fill: 'none', stroke: '#6B7280', 'stroke-width': 3 }, layers.tank);
    S.el('rect', { x: TANK.x + 2, y: WATER_Y, width: TANK.w - 4, height: TANK.botY - WATER_Y - 2, fill: '#BFDBFE', 'fill-opacity': 0.55 }, layers.tank);
    S.el('line', { x1: TANK.x + 2, y1: WATER_Y, x2: TANK.x + TANK.w - 2, y2: WATER_Y, stroke: '#3B82F6', 'stroke-width': 2, 'stroke-dasharray': '6 4' }, layers.tank);
    S.text(layers.tank, TANK.x + TANK.w - 8, WATER_Y - 8, '水面', { 'text-anchor': 'end', 'font-size': 11.5, fill: '#3B82F6', 'font-family': 'system-ui, sans-serif' });
    S.text(layers.tank, TANK.x + TANK.w / 2, TANK.botY + 20, '水槽(ρ水 = 1.0×10³ kg/m³,g = 10 N/kg)', { 'text-anchor': 'middle', 'font-size': 11.5, fill: '#6B7280', 'font-family': 'system-ui, sans-serif' });

    // 模型(潜艇:壳 + 指挥塔 + 水舱水位)
    var modelG = layers.model;
    var hull = S.el('rect', { x: 0, y: 0, width: MODEL.w, height: MODEL.h, rx: 18, fill: '#334155', stroke: '#0F172A', 'stroke-width': 1.5 }, modelG);
    var tower = S.el('rect', { x: MODEL.w / 2 - 9, y: -12, width: 18, height: 14, rx: 3, fill: '#334155' }, modelG);
    var tankFill = S.el('rect', { x: 6, y: MODEL.h - 8, width: 0, height: 8, rx: 4, fill: '#60A5FA' }, modelG);
    S.text(modelG, MODEL.w / 2, MODEL.h / 2 + 4, '模型', { 'text-anchor': 'middle', 'font-size': 11.5, fill: '#fff', 'font-weight': 700, 'font-family': 'system-ui, sans-serif' });

    // 力箭头(G 向下 / F浮 向上 / N 支持力向上)
    function arrow(color, label) {
      var g = S.el('g', null, layers.forces);
      var line = S.el('line', { stroke: color, 'stroke-width': 3.5 }, g);
      var head = S.el('path', { fill: color }, g);
      var text = S.text(g, 0, 0, label, { 'font-size': 12.5, fill: color, 'font-weight': 700, 'font-family': 'system-ui, sans-serif' });
      return { g: g, line: line, head: head, text: text };
    }
    var fG = arrow('#DC2626', 'G'), fB = arrow('#2563EB', 'F浮'), fN = arrow('#059669', 'N');

    // 力条(F浮 vs G总)
    var barsX = 700, barsY = 70;
    S.text(layers.bars, barsX, barsY - 14, '浮沉判据:比较 F浮 与 G总(N)', { 'font-size': 12, fill: '#6B7280', 'font-family': 'system-ui, sans-serif' });
    function bar(y, color, label) {
      S.text(layers.bars, barsX, y + 12, label, { 'font-size': 12, fill: '#1F2328', 'font-family': 'system-ui, sans-serif' });
      var r = S.el('rect', { x: barsX + 44, y: y, width: 0, height: 14, rx: 3, fill: color }, layers.bars);
      var t = S.text(layers.bars, barsX + 44, y + 30, '', { 'font-size': 11.5, fill: '#6B7280', 'font-family': 'system-ui, sans-serif' });
      return { r: r, t: t };
    }
    var barB = bar(barsY, '#2563EB', 'F浮'), barG = bar(barsY + 44, '#DC2626', 'G总');
    var barVerdict = S.text(layers.bars, barsX, barsY + 96, '', { 'font-size': 13, fill: '#1F2328', 'font-weight': 700, 'font-family': 'system-ui, sans-serif' });

    // 读数面板
    var ro = layers.readout;
    S.el('rect', { x: 688, y: 210, width: 252, height: 168, rx: 12, fill: '#fff', stroke: '#E5E7EB' }, ro);
    var roL1 = S.text(ro, 704, 238, '', { 'font-size': 13, fill: '#1F2328', 'font-family': 'system-ui, sans-serif' });
    var roL2 = S.text(ro, 704, 264, '', { 'font-size': 13, fill: '#1F2328', 'font-family': 'system-ui, sans-serif' });
    var roL3 = S.text(ro, 704, 290, '', { 'font-size': 13, fill: '#1F2328', 'font-weight': 700, 'font-family': 'system-ui, sans-serif' });
    var roL4 = S.text(ro, 704, 316, '', { 'font-size': 13, fill: '#1F2328', 'font-family': 'system-ui, sans-serif' });
    var roL5 = S.text(ro, 704, 342, '', { 'font-size': 13, fill: '#6B7280', 'font-family': 'system-ui, sans-serif' });
    var roL6 = S.text(ro, 704, 366, '', { 'font-size': 13, fill: '#6B7280', 'font-family': 'system-ui, sans-serif' });

    // ---------- 物理量 ----------
    function forceB() { return RHO_G * p.V * 1e-4; }        // 浸没浮力
    function weight() { return (p.m0 + p.mw) * G; }          // 总重
    function pressure() { return (p.m0 + p.mw) * G / (p.S * 1e-3); } // 桌面压强
    function verdict() {
      var d = weight() - forceB();
      if (d > 0.05) return 'sink';
      if (d < -0.05) return 'float';
      return 'suspend';
    }

    // ---------- 位置 ----------
    function deskPos() { return { x: DESK.x + DESK.w / 2 - MODEL.w / 2, y: DESK.topY - MODEL.h }; }
    function bottomY() { return TANK.botY - 8 - MODEL.h; }
    function floatY() {
      // 漂浮:V排 = G总/(ρg),露出体积比例 = 1 − V排/V,按模型高度直观化
      var frac = clamp(1 - (weight() / RHO_G) / (p.V * 1e-4), 0, 0.8);
      return WATER_Y - MODEL.h * frac;
    }
    function waterX() { return TANK.x + TANK.w / 2 - MODEL.w / 2; }
    function modelPos() {
      if (st.loc === 'desk') return deskPos();
      if (st.loc === 'bottom') return { x: waterX(), y: bottomY() };
      if (st.loc === 'risen') return { x: waterX(), y: clamp(bottomY() - p.h * PXPM, WATER_Y + 4, bottomY()) };
      if (st.loc === 'float') return { x: waterX(), y: floatY() };
      return { x: waterX(), y: (WATER_Y + bottomY()) / 2 }; // suspend:中部
    }

    function placeArrow(a, x, yFrom, yTo, labelDy) {
      var dir = yTo > yFrom ? 1 : -1;
      S.attr(a.line, { x1: x, y1: yFrom, x2: x, y2: yTo });
      S.attr(a.head, { d: 'M' + x + ' ' + yTo + ' l-6 ' + (-dir * 10) + ' h12 z' });
      S.attr(a.text, { x: x + 10, y: yTo + (labelDy || 0) });
    }

    function render() {
      var pos = modelPos();
      S.attr(modelG, { transform: 'translate(' + pos.x.toFixed(1) + ',' + pos.y.toFixed(1) + ')' });
      S.attr(tankFill, { width: (MODEL.w - 12) * (p.mw / PARAMS.mw.max) });
      // 力箭头:作用在模型中心;比例自适应防过长,N 标签放左侧防与 F浮 重叠
      var cx = pos.x + MODEL.w / 2, cy = pos.y + MODEL.h / 2;
      var wN = weight(), bN = st.loc === 'desk' ? 0 : (st.loc === 'float' ? wN : forceB());
      var k = Math.min(4.2, 68 / Math.max(wN, bN, 1)); // N → px,箭头最长约 82px
      placeArrow(fG, cx, cy, cy + 14 + wN * k, 14);
      fG.text.textContent = 'G = ' + fmt(wN, 1) + ' N';
      if (st.loc === 'desk') {
        placeArrow(fN, cx - 26, cy, cy - 14 - wN * k, -6);
        fN.text.textContent = 'N = ' + fmt(wN, 1) + ' N';
        S.attr(fN.text, { 'text-anchor': 'end', x: cx - 36 });
        S.attr(fN.g, { opacity: 1 }); S.attr(fB.g, { opacity: 0 });
      } else {
        placeArrow(fB, cx, cy, cy - 14 - bN * k, -6);
        fB.text.textContent = 'F浮 = ' + fmt(bN, 1) + ' N';
        S.attr(fB.g, { opacity: 1 });
        var nBot = wN - forceB();
        if (st.loc === 'bottom' && nBot > 0.05) {
          placeArrow(fN, cx - 30, cy, cy - 14 - nBot * k, -6);
          fN.text.textContent = 'N = ' + fmt(nBot, 1) + ' N';
          S.attr(fN.text, { 'text-anchor': 'end', x: cx - 40 });
          S.attr(fN.g, { opacity: 1 });
        } else S.attr(fN.g, { opacity: 0 });
      }
      // 力条
      var maxN = Math.max(forceB(), weight(), 1e-6);
      var bScale = Math.min(16, 190 / maxN);
      S.attr(barB.r, { width: forceB() * bScale }); barB.t.textContent = 'F浮(浸没) = ρgV = ' + fmt(forceB(), 1) + ' N';
      S.attr(barG.r, { width: weight() * bScale }); barG.t.textContent = 'G总 = (m0 + m水)g = ' + fmt(weight(), 1) + ' N';
      var v = verdict();
      barVerdict.textContent = v === 'sink' ? 'G总 > F浮 → 下沉(沉底)' : v === 'float' ? 'G总 < F浮 → 上浮(漂浮)' : 'G总 = F浮 → 悬浮';
      barVerdict.setAttribute('fill', v === 'sink' ? '#DC2626' : v === 'float' ? '#2563EB' : '#059669');
      // 读数
      if (st.loc === 'desk') {
        roL1.textContent = '注水前:G = m g = ' + fmt(p.m0 * G, 2) + ' N';
        roL2.textContent = '受力面积 S = ' + fmt(p.S, 1) + '×10⁻³ m²';
        roL3.textContent = '压强 p = G/S = ' + fmt(p.m0 * G / (p.S * 1e-3), 0) + ' Pa';
        roL4.textContent = ''; roL5.textContent = ''; roL6.textContent = '';
      } else {
        roL1.textContent = 'V = ' + fmt(p.V, 1) + '×10⁻⁴ m³,浸没';
        roL2.textContent = 'F浮 = ρgV = ' + fmt(forceB(), 1) + ' N';
        roL3.textContent = 'G总 = ' + fmt(weight(), 1) + ' N → ' + (v === 'sink' ? '沉底' : v === 'float' ? '漂浮' : '悬浮');
        roL4.textContent = st.loc === 'bottom' && weight() - forceB() > 0.05 ? '水底支持力 N = ' + fmt(weight() - forceB(), 1) + ' N' : '';
        roL5.textContent = st.loc === 'risen' ? '上浮 h = ' + fmt(p.h, 2) + ' m(未露出水面)' : '';
        roL6.textContent = st.loc === 'risen' ? '浮力做功 W = F浮·h = ' + fmt(forceB() * p.h, 2) + ' J' : '';
      }
      // 注:层的显隐(opacity)只由 show/hide 动作管理,render 不碰,避免打断淡入动画
      allHandles.forEach(function (hd) { hd.update(); });
    }

    // ---------- 手柄 ----------
    var allHandles = [];
    function setParam(id, v) {
      var spec = PARAMS[id];
      p[id] = LS.snap(clamp(v, spec.min, spec.max), spec.step);
      if (id !== 'h' && st.loc !== 'desk') {
        // 水中改参数 → 按判据即时落位
        var vd = verdict();
        st.loc = vd === 'sink' ? 'bottom' : vd === 'float' ? 'float' : 'suspend';
      }
      render();
      onChange && onChange(id, p[id], Object.assign({}, p));
    }
    allHandles.push(new LS.Handle(svg, layers.handles, {
      id: 'h', label: '上浮', color: '#2563EB',
      get: function () { var pos = modelPos(); return { x: pos.x + MODEL.w / 2, y: pos.y - 6 }; },
      onDrag: function (x, y) {
        if (st.loc === 'desk') return;
        st.loc = 'risen';
        setParam('h', (bottomY() - (y + 6)) / PXPM);
      }
    }));
    var sliderSpecs = [
      { id: 'mw', x: 80, w: 150, color: '#2563EB' },
      { id: 'm0', x: 310, w: 130, color: '#DC2626' },
      { id: 'V', x: 520, w: 130, color: '#059669' },
      { id: 'S', x: 730, w: 130, color: '#6B7280' }
    ];
    sliderSpecs.forEach(function (sp) {
      var spec = PARAMS[sp.id];
      allHandles.push(new LS.Slider(svg, layers.handles, {
        id: sp.id, label: spec.label, min: spec.min, max: spec.max, step: spec.step,
        x: sp.x, y: 505, width: sp.w, color: sp.color,
        get: function () { return p[sp.id]; }, set: function (v) { setParam(sp.id, v); }
      }));
    });

    st.loc = 'desk';
    render();

    // ---------- 过程 ----------
    function settleLoc() { var v = verdict(); return v === 'sink' ? 'bottom' : v === 'float' ? 'float' : 'suspend'; }
    function simulate(phase) {
      if (phase === 'towater') {
        visible.tank = true; visible.model = true; render();
        // 提起 → 移到槽口上方 → 入水 → 按判据落位
        var lift = { x: waterX(), y: TANK.topY - MODEL.h - 16 };
        var from = modelPos();
        return LS.tween({ duration: 900, easing: 'easeInOut', onUpdate: function (t) {
          S.attr(modelG, { transform: 'translate(' + (from.x + (lift.x - from.x) * t).toFixed(1) + ',' + (from.y + (lift.y - from.y) * t).toFixed(1) + ')' });
        } }).then(function () {
          var target = settleLoc();
          var y2 = target === 'bottom' ? bottomY() : target === 'float' ? floatY() : (WATER_Y + bottomY()) / 2;
          return LS.tween({ duration: 1100, easing: 'easeInOut', onUpdate: function (t) {
            S.attr(modelG, { transform: 'translate(' + lift.x.toFixed(1) + ',' + (lift.y + (y2 - lift.y) * t).toFixed(1) + ')' });
          } }).then(function () { st.loc = target; render(); });
        });
      }
      if (phase === 'rise') {
        if (st.loc === 'desk') { st.loc = settleLoc(); render(); }
        if (verdict() === 'sink') return LS.wait(300); // 重仍大于浮力,浮不起来(语义校验会拦)
        st.loc = 'bottom';
        var y0 = bottomY(), y1 = clamp(bottomY() - p.h * PXPM, WATER_Y + 4, bottomY());
        var x0 = waterX();
        S.attr(modelG, { transform: 'translate(' + x0 + ',' + y0 + ')' });
        return LS.tween({ duration: 1400, easing: 'easeOut', onUpdate: function (t) {
          S.attr(modelG, { transform: 'translate(' + x0 + ',' + (y0 + (y1 - y0) * t).toFixed(1) + ')' });
        } }).then(function () { st.loc = 'risen'; render(); });
      }
      if (phase === 'settle') { st.loc = settleLoc(); render(); return LS.wait(300); }
      return LS.wait(0);
    }

    return {
      svg: svg,
      getParams: function () { return Object.assign({}, p); },
      setParams: function (np) {
        Object.assign(p, np);
        // 位置随场景可见性同步:水槽已显示则按判据落位(动手环节/恢复标准参数时模型应在水中)
        st.loc = visible.tank ? settleLoc() : 'desk';
        render();
      },
      setUnlocked: function (ids) { allHandles.forEach(function (hd) { hd.setLocked(ids.indexOf(hd.spec.id) < 0); }); },
      getAnchor: function (id) {
        var pos = modelPos();
        var map = {
          model: { x: pos.x + MODEL.w / 2, y: pos.y + MODEL.h / 2, r: 52 },
          forces: { x: pos.x + MODEL.w / 2, y: pos.y - 30, r: 60 },
          bars: { x: barsX + 100, y: barsY + 50, r: 96 },
          readout: { x: 814, y: 294, r: 96 },
          desk: { x: DESK.x + DESK.w / 2, y: DESK.topY - 20, r: 70 },
          tank: { x: TANK.x + TANK.w / 2, y: (WATER_Y + TANK.botY) / 2, r: 110 },
          waterline: { x: TANK.x + TANK.w / 2, y: WATER_Y, r: 40 }
        };
        return map[id] || null;
      },
      beginStep: function () {
        // 每步开始:回桌面/水中初始位(有 tank 显示则回水底判据位,否则桌面)
        st.loc = visible.tank ? settleLoc() : 'desk';
        render();
      },
      applyAction: function (act) {
        var dur = act.durationMs == null ? 700 : act.durationMs;
        switch (act.type) {
          case 'show': {
            visible[act.target] = true;
            if (act.target === 'model' && st.loc === 'desk') render();
            var node = layers[act.target];
            if (!node) { render(); return LS.wait(0); }
            render();
            return LS.tween({ duration: dur, onUpdate: function (t) { S.attr(node, { opacity: t }); } });
          }
          case 'hide': visible[act.target] = false; render(); return LS.wait(200);
          case 'move': {
            // 注:move 期间不自动按判据挪模型(排水演示要「先排水、后上浮」两拍),
            // 位置变化交给随后的 run rise/settle;学生拖滑杆(setParam)才即时落位
            var id = act.param, to = Number(act.to), from = act.from == null ? p[id] : Number(act.from);
            p[id] = from; render();
            return LS.tween({ duration: act.durationMs == null ? 1200 : act.durationMs, onUpdate: function (t) {
              p[id] = from + (to - from) * t;
              render();
            } });
          }
          case 'run': return simulate(act.phase || 'towater');
          case 'reset': st.loc = visible.tank ? settleLoc() : 'desk'; render(); return LS.wait(300);
          case 'readout': visible.readout = act.on !== false; render(); return LS.wait(300);
          default: return LS.wait(0);
        }
      },
      destroy: function () { svg.remove(); }
    };
  }
  function defaults() { var d = {}; Object.keys(PARAMS).forEach(function (k) { d[k] = PARAMS[k].def; }); return d; }

  LS.registerTemplate({
    id: 'buoyancy',
    name: '浮力与浮沉',
    subject: '物理',
    params: PARAMS,
    targets: ['desk', 'tank', 'model', 'forces', 'bars', 'readout'],
    actions: ['show', 'hide', 'move', 'run', 'reset', 'readout'],
    defaults: defaults,
    mount: mount,
    describe: '注水/排水的潜艇模型:桌面压强 p=G/S、浸没浮力 F浮=ρgV、浮沉判据(G总 vs F浮)、上浮 h 时浮力做功 W=F浮·h;可拖注水量/质量/体积/底面积滑杆与上浮高度。run 分 towater(入水按判据落位)/ rise(上浮 h)/ settle。'
  });
})(window);
