/*
 * 模板 · 平行四边形与对角线(parallelogram-angle)
 * 案例题型:▱ABCD 对角线 BD,∠DBC/∠DCB 已知,作高求边;角平分线+垂线构造的证明可视化(2026-09-04,题 3)
 * 参数:beta(∠DBC,度)gamma(∠DCB,度)AB(=CD,长度单位)
 * 派生:BC(正弦定理)、D、A=B+D−C;(2) 构造:E=∠DCB 平分线∩BD、G=垂足、F=过 D ⊥CE 交 BC、H=AF∩BD
 * 元素:para ▱ / diagBD / angB angC 角标注 / heightDM 作高 DM(直角记号)/ cevaCE 平分线 CE(双弧记号)
 *      / perpDF 垂线 DF(垂足 G 直角记号)/ segAF(AF 与交点 H)/ angAHB(结论角)/ readout 读数
 * 动作:show/hide/draw/move/highlight/readout;手柄:beta(B 处沿弧拖)gamma(C 处沿弧拖)AB(滑杆)
 * 几何自动缩放适配画布;∠AHB 实时计算,=90° 时打 ✓(条件变了结论自动失效——探索点)
 */
(function (global) {
  'use strict';
  var LS = global.LectureScene;
  var S = LS.svg, fmt = LS.fmt, clamp = LS.clamp;

  var PARAMS = {
    beta: { label: '∠DBC(°)', min: 30, max: 60, step: 1, def: 45 },
    gamma: { label: '∠DCB(°)', min: 40, max: 75, step: 1, def: 60 },
    AB: { label: 'AB = CD', min: 4, max: 9, step: 0.5, def: 6 }
  };
  var W = 960, H = 540;
  var D2R = Math.PI / 180;

  function mount(container, params, ctx) {
    var svg = S.el('svg', { viewBox: '0 0 ' + W + ' ' + H, preserveAspectRatio: 'xMidYMid meet' });
    container.appendChild(svg);
    var p = Object.assign({}, defaults(), params || {});
    var onChange = ctx && ctx.onParamChange;
    var visible = { para: false, diagBD: false, angB: false, angC: false, heightDM: false, cevaCE: false, perpDF: false, segAF: false, angAHB: false, readout: false };
    var progress = { para: 1, diagBD: 1, heightDM: 1, cevaCE: 1, perpDF: 1, segAF: 1 };

    var layers = {
      para: S.el('g', { opacity: 0 }, svg),
      diagBD: S.el('g', { opacity: 0 }, svg),
      heightDM: S.el('g', { opacity: 0 }, svg),
      cevaCE: S.el('g', { opacity: 0 }, svg),
      perpDF: S.el('g', { opacity: 0 }, svg),
      segAF: S.el('g', { opacity: 0 }, svg),
      angles: S.el('g', null, svg),
      readout: S.el('g', { opacity: 0 }, svg),
      handles: S.el('g', null, svg)
    };

    var paraPath = S.el('path', { fill: 'none', stroke: '#1D4ED8', 'stroke-width': 2.6, 'stroke-linejoin': 'round' }, layers.para);
    var bdLine = S.el('line', { stroke: '#1F2328', 'stroke-width': 2.2 }, layers.diagBD);
    var dmLine = S.el('line', { stroke: '#059669', 'stroke-width': 2, 'stroke-dasharray': '7 4' }, layers.heightDM);
    var dmRight = S.el('path', { fill: 'none', stroke: '#059669', 'stroke-width': 1.6 }, layers.heightDM);
    var dmLab = S.text(layers.heightDM, 0, 0, 'M', { 'font-size': 14, 'font-style': 'italic', fill: '#059669', 'font-family': 'Georgia, serif', 'font-weight': 700 });
    var ceLine = S.el('line', { stroke: '#C8102E', 'stroke-width': 2.2 }, layers.cevaCE);
    var ceArc1 = S.el('path', { fill: 'none', stroke: '#C8102E', 'stroke-width': 1.6 }, layers.cevaCE);
    var ceArc2 = S.el('path', { fill: 'none', stroke: '#C8102E', 'stroke-width': 1.6 }, layers.cevaCE);
    var eDot = S.el('circle', { r: 4.5, fill: '#C8102E' }, layers.cevaCE);
    var eLab = S.text(layers.cevaCE, 0, 0, 'E', { 'font-size': 14, 'font-style': 'italic', fill: '#C8102E', 'font-family': 'Georgia, serif', 'font-weight': 700 });
    var dfLine = S.el('line', { stroke: '#7C3AED', 'stroke-width': 2.2 }, layers.perpDF);
    var gRight = S.el('path', { fill: 'none', stroke: '#7C3AED', 'stroke-width': 1.6 }, layers.perpDF);
    var gDot = S.el('circle', { r: 4, fill: '#7C3AED' }, layers.perpDF);
    var gLab = S.text(layers.perpDF, 0, 0, 'G', { 'font-size': 14, 'font-style': 'italic', fill: '#7C3AED', 'font-family': 'Georgia, serif', 'font-weight': 700 });
    var fDot = S.el('circle', { r: 4.5, fill: '#7C3AED' }, layers.perpDF);
    var fLab = S.text(layers.perpDF, 0, 0, 'F', { 'font-size': 14, 'font-style': 'italic', fill: '#7C3AED', 'font-family': 'Georgia, serif', 'font-weight': 700 });
    var afLine = S.el('line', { stroke: '#EA580C', 'stroke-width': 2.2 }, layers.segAF);
    var hDot = S.el('circle', { r: 4.5, fill: '#EA580C' }, layers.segAF);
    var hLab = S.text(layers.segAF, 0, 0, 'H', { 'font-size': 14, 'font-style': 'italic', fill: '#EA580C', 'font-family': 'Georgia, serif', 'font-weight': 700 });
    var hRight = S.el('path', { fill: 'none', stroke: '#EA580C', 'stroke-width': 1.8 }, layers.segAF);

    // 顶点字母(随 para)
    var vLabels = {};
    ['A', 'B', 'C', 'D'].forEach(function (n) {
      vLabels[n] = S.text(layers.para, 0, 0, n, { 'font-size': 16, 'font-style': 'italic', 'font-weight': 700, fill: '#1D4ED8', 'font-family': 'Georgia, serif' });
    });

    // 角标注(B、C、结论 ∠AHB)
    function angleMark(color) {
      var g = S.el('g', { opacity: 0 }, layers.angles);
      return { g: g, arc: S.el('path', { fill: 'none', stroke: color, 'stroke-width': 2 }, g), text: S.text(g, 0, 0, '', { 'font-size': 12.5, 'font-weight': 700, fill: color, 'font-family': 'system-ui, sans-serif', 'text-anchor': 'middle' }) };
    }
    var angBMark = angleMark('#1F2328'), angCMark = angleMark('#1F2328'), angAHBMark = angleMark('#EA580C');

    // 读数面板
    var ro = layers.readout;
    S.el('rect', { x: 656, y: 64, width: 286, height: 212, rx: 12, fill: '#fff', stroke: '#E5E7EB' }, ro);
    S.text(ro, 672, 90, '计算(实时)', { 'font-size': 12, fill: '#6B7280', 'font-family': 'system-ui, sans-serif' });
    var roLines = [];
    for (var li = 0; li < 6; li++) roLines.push(S.text(ro, 672, 118 + li * 27, '', { 'font-size': 13, fill: '#1F2328', 'font-family': 'system-ui, sans-serif' }));

    // ---------- 几何(单位坐标,y 向上为负;再 fit 到画布) ----------
    function geo() {
      var b = p.beta * D2R, c = p.gamma * D2R;
      var CD = p.AB;
      var BC = CD * Math.sin(Math.PI - b - c) / Math.sin(b); // 正弦定理:∠BDC = 180−β−γ
      var B = { x: 0, y: 0 };
      var C = { x: BC, y: 0 };
      var BD = CD * Math.sin(c) / Math.sin(b);
      var D = { x: BD * Math.cos(b), y: -BD * Math.sin(b) };
      var A = { x: B.x + D.x - C.x, y: B.y + D.y - C.y };
      var M = { x: D.x, y: 0 }; // DM⊥BC 垂足
      // E:∠DCB 平分线 ∩ BD
      var uCB = norm({ x: B.x - C.x, y: 0 });
      var uCD = norm({ x: D.x - C.x, y: D.y - C.y });
      var bis = norm({ x: uCB.x + uCD.x, y: uCB.y + uCD.y });
      var E = lineCross(C, bis, B, norm(D));
      // F:过 D ⊥ CE 交 BC(y=0);G:垂足
      var perp = { x: -bis.y, y: bis.x };
      var tF = perp.y !== 0 ? -D.y / perp.y : 0;
      var F = { x: D.x + tF * perp.x, y: 0 };
      var G = foot(D, C, bis);
      // H = AF ∩ BD
      var H = lineCross(A, norm({ x: F.x - A.x, y: F.y - A.y }), B, norm(D));
      return { A: A, B: B, C: C, D: D, M: M, E: E, F: F, G: G, H: H, BC: BC, BD: BD };
    }
    function norm(v) { var l = Math.hypot(v.x, v.y) || 1; return { x: v.x / l, y: v.y / l }; }
    function lineCross(p1, u1, p2, u2) {
      var det = u1.x * -u2.x * 0 + (u1.x * -u2.y) - (-u2.x * u1.y);
      det = u1.x * -u2.y + u2.x * u1.y;
      if (Math.abs(det) < 1e-9) return null;
      var qx = p2.x - p1.x, qy = p2.y - p1.y;
      var t = (qx * -u2.y + u2.x * qy) / det;
      return { x: p1.x + t * u1.x, y: p1.y + t * u1.y };
    }
    function foot(pt, lp, lu) {
      var t = (pt.x - lp.x) * lu.x + (pt.y - lp.y) * lu.y;
      return { x: lp.x + t * lu.x, y: lp.y + t * lu.y };
    }
    function angleAt(v, p1, p2) {
      var a1 = Math.atan2(p1.y - v.y, p1.x - v.x), a2 = Math.atan2(p2.y - v.y, p2.x - v.x);
      var d = Math.abs(a1 - a2);
      if (d > Math.PI) d = 2 * Math.PI - d;
      return d / D2R;
    }

    // fit:单位坐标 → 画布(留出读数面板区)
    function fitter(g) {
      var pts = [g.A, g.B, g.C, g.D];
      var minX = Math.min.apply(null, pts.map(function (q) { return q.x; })) - 0.5;
      var maxX = Math.max.apply(null, pts.map(function (q) { return q.x; })) + 0.5;
      var minY = Math.min.apply(null, pts.map(function (q) { return q.y; })) - 0.6;
      var maxY = 0.6;
      var box = { x: 60, y: 70, w: 560, h: 400 };
      var s = Math.min(box.w / (maxX - minX), box.h / (maxY - minY));
      return function (q) { return { x: box.x + (q.x - minX) * s, y: box.y + (q.y - minY) * s }; };
    }

    function arcPath(v, p1, p2, r) {
      var a1 = Math.atan2(p1.y - v.y, p1.x - v.x), a2 = Math.atan2(p2.y - v.y, p2.x - v.x);
      var d = a2 - a1;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      var q1 = { x: v.x + r * Math.cos(a1), y: v.y + r * Math.sin(a1) };
      var q2 = { x: v.x + r * Math.cos(a1 + d), y: v.y + r * Math.sin(a1 + d) };
      var mid = a1 + d / 2;
      return { d: 'M' + q1.x.toFixed(1) + ' ' + q1.y.toFixed(1) + ' A' + r + ' ' + r + ' 0 0 ' + (d > 0 ? 1 : 0) + ' ' + q2.x.toFixed(1) + ' ' + q2.y.toFixed(1), tx: v.x + (r + 15) * Math.cos(mid), ty: v.y + (r + 15) * Math.sin(mid) + 4, deg: Math.abs(d) / D2R };
    }
    function rightMark(corner, d1, d2, size) {
      var a = { x: corner.x + d1.x * size, y: corner.y + d1.y * size };
      var b2 = { x: corner.x + d1.x * size + d2.x * size, y: corner.y + d1.y * size + d2.y * size };
      var c2 = { x: corner.x + d2.x * size, y: corner.y + d2.y * size };
      return 'M' + a.x.toFixed(1) + ' ' + a.y.toFixed(1) + ' L' + b2.x.toFixed(1) + ' ' + b2.y.toFixed(1) + ' L' + c2.x.toFixed(1) + ' ' + c2.y.toFixed(1);
    }
    function partialLine(node, from, to, prog) {
      S.attr(node, { x1: from.x, y1: from.y, x2: from.x + (to.x - from.x) * (prog == null ? 1 : prog), y2: from.y + (to.y - from.y) * (prog == null ? 1 : prog) });
    }

    function render() {
      var g = geo();
      var T = fitter(g);
      var A = T(g.A), B = T(g.B), C = T(g.C), Dp = T(g.D), M = T(g.M), E = g.E && T(g.E), F = T(g.F), G = T(g.G), Hp = g.H && T(g.H);
      // ▱ 逐边:A→B→C→D→A
      var ring = [A, B, C, Dp, A];
      var upto = clamp(progress.para, 0, 1) * 4;
      var d = 'M' + A.x.toFixed(1) + ' ' + A.y.toFixed(1);
      for (var i = 1; i <= 4; i++) {
        var f = clamp(upto - (i - 1), 0, 1);
        if (f <= 0) break;
        d += ' L' + (ring[i - 1].x + (ring[i].x - ring[i - 1].x) * f).toFixed(1) + ' ' + (ring[i - 1].y + (ring[i].y - ring[i - 1].y) * f).toFixed(1);
      }
      S.attr(paraPath, { d: d });
      var vPos = { A: { x: A.x - 16, y: A.y - 8 }, B: { x: B.x - 16, y: B.y + 18 }, C: { x: C.x + 8, y: C.y + 18 }, D: { x: Dp.x + 8, y: Dp.y - 8 } };
      Object.keys(vPos).forEach(function (n) { S.attr(vLabels[n], { x: vPos[n].x, y: vPos[n].y }); });
      partialLine(bdLine, B, Dp, progress.diagBD);
      // 作高 DM
      partialLine(dmLine, Dp, M, progress.heightDM);
      S.attr(dmRight, { d: rightMark(M, { x: 0, y: -1 }, { x: -1, y: 0 }, 10) });
      S.attr(dmLab, { x: M.x - 4, y: M.y + 20 });
      // CE 平分线 + 双弧记号
      if (E) {
        partialLine(ceLine, C, E, progress.cevaCE);
        S.attr(eDot, { cx: E.x, cy: E.y });
        S.attr(eLab, { x: E.x - 18, y: E.y - 6 });
        var arc1 = arcPath(C, B, E, 30), arc2 = arcPath(C, E, Dp, 36);
        S.attr(ceArc1, { d: arc1.d }); S.attr(ceArc2, { d: arc2.d });
      }
      // DF ⊥ CE
      partialLine(dfLine, Dp, F, progress.perpDF);
      S.attr(fDot, { cx: F.x, cy: F.y });
      S.attr(fLab, { x: F.x - 4, y: F.y + 20 });
      S.attr(gDot, { cx: G.x, cy: G.y });
      S.attr(gLab, { x: G.x + 8, y: G.y - 6 });
      var uCE = norm({ x: E ? E.x - C.x : 1, y: E ? E.y - C.y : 0 });
      S.attr(gRight, { d: rightMark(G, uCE, { x: -uCE.y, y: uCE.x }, 9) });
      // AF 与 H
      if (Hp) {
        partialLine(afLine, A, F, progress.segAF);
        S.attr(hDot, { cx: Hp.x, cy: Hp.y });
        S.attr(hLab, { x: Hp.x + 8, y: Hp.y + 16 });
        var uBD = norm({ x: Dp.x - B.x, y: Dp.y - B.y });
        S.attr(hRight, { d: rightMark(Hp, uBD, { x: -uBD.y, y: uBD.x }, 9) });
        var ahb = angleAt(g.H, g.A, g.B);
        S.attr(hRight, { opacity: Math.abs(ahb - 90) < 0.8 ? 1 : 0 });
      }
      // 角标注
      var mb = arcPath(B, C, Dp, 26);
      S.attr(angBMark.g, { opacity: visible.angB ? 1 : 0 });
      S.attr(angBMark.arc, { d: mb.d }); S.attr(angBMark.text, { x: mb.tx, y: mb.ty }); angBMark.text.textContent = fmt(p.beta, 0) + '°';
      var mc = arcPath(C, Dp, B, 26);
      S.attr(angCMark.g, { opacity: visible.angC ? 1 : 0 });
      S.attr(angCMark.arc, { d: mc.d }); S.attr(angCMark.text, { x: mc.tx, y: mc.ty }); angCMark.text.textContent = fmt(p.gamma, 0) + '°';
      if (Hp) {
        var mh = arcPath(Hp, A, B, 20);
        S.attr(angAHBMark.g, { opacity: visible.angAHB ? 1 : 0 });
        S.attr(angAHBMark.arc, { d: mh.d }); S.attr(angAHBMark.text, { x: mh.tx, y: mh.ty });
        angAHBMark.text.textContent = fmt(angleAt(g.H, g.A, g.B), 0) + '°';
      } else S.attr(angAHBMark.g, { opacity: 0 });
      // 读数
      var b = p.beta * D2R, c = p.gamma * D2R;
      var DM = p.AB * Math.sin(c), CM = p.AB * Math.cos(c), BM = DM / Math.tan(b);
      var DE = g.E ? Math.hypot(g.D.x - g.E.x, g.D.y - g.E.y) : NaN;
      var BF = Math.hypot(g.F.x - g.B.x, g.F.y - g.B.y);
      var ahb2 = g.H ? angleAt(g.H, g.A, g.B) : NaN;
      roLines[0].textContent = 'CD = AB = ' + fmt(p.AB, 1) + '(▱ 对边相等)';
      roLines[1].textContent = '作 DM⊥BC:DM = CD·sin' + fmt(p.gamma, 0) + '° = ' + fmt(DM, 2) + ',CM = ' + fmt(CM, 2);
      roLines[2].textContent = 'BM = DM/tan' + fmt(p.beta, 0) + '° = ' + fmt(BM, 2) + (Math.abs(p.beta - 45) < 0.5 ? '(= DM,等腰直角)' : '');
      roLines[3].textContent = 'BC = BM + CM = ' + fmt(BM + CM, 2);
      roLines[4].textContent = 'DE = ' + fmt(DE, 2) + '  BF = ' + fmt(BF, 2) + '  DE/BF = ' + fmt(DE / BF, 2) + (Math.abs(DE / BF - Math.SQRT2) < 0.01 ? '(= √2 ✓)' : '');
      roLines[5].textContent = '∠AHB = ' + fmt(ahb2, 0) + '°' + (Math.abs(ahb2 - 90) < 0.8 ? '(AF⊥BD ✓)' : '(≠90°,结论不成立)');
      allHandles.forEach(function (hd) { hd.update(); });
    }

    // ---------- 手柄 ----------
    var allHandles = [];
    function setParam(id, v) {
      var spec = PARAMS[id];
      p[id] = LS.snap(clamp(v, spec.min, spec.max), spec.step);
      render();
      onChange && onChange(id, p[id], Object.assign({}, p));
    }
    allHandles.push(new LS.Handle(svg, layers.handles, {
      id: 'beta', label: '∠DBC', color: '#1F2328',
      get: function () {
        var g = geo(), T = fitter(g), B = T(g.B);
        var a = -p.beta * D2R / 2; // 角平分线方向(BC 沿 +x,BD 在上方)
        return { x: B.x + 56 * Math.cos(a), y: B.y + 56 * Math.sin(a) };
      },
      onDrag: function (x, y) {
        var g = geo(), T = fitter(g), B = T(g.B);
        setParam('beta', -Math.atan2(y - B.y, x - B.x) / D2R * 2);
      }
    }));
    allHandles.push(new LS.Handle(svg, layers.handles, {
      id: 'gamma', label: '∠DCB', color: '#1F2328',
      get: function () {
        var g = geo(), T = fitter(g), C = T(g.C);
        var a = Math.PI + p.gamma * D2R / 2; // 从 CB 方向(−x)向上转 γ/2
        return { x: C.x + 56 * Math.cos(a), y: C.y - 56 * Math.sin(p.gamma * D2R / 2) };
      },
      onDrag: function (x, y) {
        var g = geo(), T = fitter(g), C = T(g.C);
        setParam('gamma', Math.atan2(-(y - C.y), C.x - x) / D2R * 2);
      }
    }));
    allHandles.push(new LS.Slider(svg, layers.handles, {
      id: 'AB', label: 'AB = CD(长度)', min: PARAMS.AB.min, max: PARAMS.AB.max, step: PARAMS.AB.step, x: 700, y: 320, width: 180, color: '#1D4ED8',
      get: function () { return p.AB; }, set: function (v) { setParam('AB', v); }
    }));

    render();

    return {
      svg: svg,
      getParams: function () { return Object.assign({}, p); },
      setParams: function (np) { Object.assign(p, np); render(); },
      setUnlocked: function (ids) { allHandles.forEach(function (hd) { hd.setLocked(ids.indexOf(hd.spec.id) < 0); }); },
      getAnchor: function (id) {
        var g = geo(), T = fitter(g);
        var pts = { A: g.A, B: g.B, C: g.C, D: g.D, M: g.M, E: g.E, F: g.F, G: g.G, H: g.H };
        if (pts[id]) { var q = T(pts[id]); return { x: q.x, y: q.y, r: 26 }; }
        if (id === 'readout') return { x: 799, y: 170, r: 110 };
        return null;
      },
      beginStep: function () {},
      applyAction: function (act) {
        var d = function (def) { return act.durationMs == null ? def : act.durationMs; };
        switch (act.type) {
          case 'show': {
            visible[act.target] = true;
            var node = layers[act.target];
            render();
            if (!node) return LS.wait(250);
            return LS.tween({ duration: Math.min(d(600), 600), onUpdate: function (t) { S.attr(node, { opacity: t }); } });
          }
          case 'hide': {
            visible[act.target] = false;
            var n2 = layers[act.target];
            if (n2) S.attr(n2, { opacity: 0 });
            render();
            return LS.wait(200);
          }
          case 'draw': {
            var key = act.target;
            if (!(key in progress)) { visible[key] = true; render(); return LS.wait(300); }
            visible[key] = true; progress[key] = 0;
            S.attr(layers[key], { opacity: 1 });
            render();
            return LS.tween({ duration: d(1300), easing: 'easeInOut', onUpdate: function (t) { progress[key] = t; render(); } });
          }
          case 'move': {
            var id = act.param, to = Number(act.to), from = act.from == null ? p[id] : Number(act.from);
            p[id] = from; render();
            return LS.tween({ duration: d(1500), onUpdate: function (t) { p[id] = from + (to - from) * t; render(); } });
          }
          case 'highlight': {
            var tgt = act.target === 'diagBD' ? bdLine : act.target === 'cevaCE' ? ceLine : act.target === 'perpDF' ? dfLine : act.target === 'segAF' ? afLine : paraPath;
            return LS.tween({ duration: d(900), onUpdate: function (t) { S.attr(tgt, { 'stroke-width': 2.4 * (1 + 0.7 * Math.sin(Math.PI * t)) }); } });
          }
          case 'readout': visible.readout = act.on !== false; S.attr(layers.readout, { opacity: visible.readout ? 1 : 0 }); render(); return LS.wait(300);
          default: return LS.wait(0);
        }
      },
      destroy: function () { svg.remove(); }
    };
  }
  function defaults() { var d = {}; Object.keys(PARAMS).forEach(function (k) { d[k] = PARAMS[k].def; }); return d; }

  LS.registerTemplate({
    id: 'parallelogram-angle',
    name: '平行四边形与对角线',
    subject: '数学',
    params: PARAMS,
    targets: ['para', 'diagBD', 'angB', 'angC', 'heightDM', 'cevaCE', 'perpDF', 'segAF', 'angAHB', 'readout'],
    actions: ['show', 'hide', 'draw', 'move', 'highlight', 'readout'],
    defaults: defaults,
    mount: mount,
    describe: '▱ABCD 与对角线 BD(∠DBC、∠DCB、AB 可调):作高 DM 求 BC;角平分线 CE、垂线 DF、连线 AF 的构造逐条画出,∠AHB 实时显示(=90° 时 AF⊥BD ✓),DE/BF 比值实时(45°/60° 时 =√2);拖角可看结论何时失效。'
  });
})(window);
