/*
 * 模板 · 圆与圆周角(circle-angle)
 * 案例题型:⊙O 内接三角形,半径 OB 与 AC 交于 D;圆周角/圆心角、等腰(半径)、外角、切线判定(2026-09-04,题 1)
 * 参数:thetaA/thetaB/thetaC(A、B、C 在圆上的位置,屏幕角度,顺时针,度)、tE(E 在 AC 延长线上的比例,>1 在 C 外侧)
 * 元素:circle 圆与圆心 / triangle △ABC / radiusOA / radiusOB / pointD(OB∩AC)/ segBE(E 与 BE)/ arcAB 弧 AB 高亮
 *      / ang* 一组角标注(angACB angAOB angOAC angOAB angOBA angADB angCDB angOBC angCAB angOBE)/ readout 关系读数
 * 动作:show/hide/draw(circle|triangle|radiusOA|radiusOB|segBE)/move(参数动画)/highlight/readout
 * 手柄:thetaA/thetaB/thetaC 沿圆拖动三点;tE 沿延长线拖 E
 * 几何:D = 半径 OB 与弦 AC 的交点(不相交时隐藏并提示);所有角实时计算,readout 给关系检验(∠AOB=2∠ACB、
 *      ∠CDB=∠OBC?、∠ACB=2∠CAB?、BE=BA?、OB⊥BE?)
 */
(function (global) {
  'use strict';
  var LS = global.LectureScene;
  var S = LS.svg, fmt = LS.fmt, clamp = LS.clamp;

  var PARAMS = {
    thetaA: { label: 'A 位置(°)', min: 95, max: 175, step: 1, def: 120 },
    thetaB: { label: 'B 位置(°)', min: 5, max: 85, step: 1, def: 40 },
    thetaC: { label: 'C 位置(°)', min: 270, max: 360, step: 1, def: 330 },
    tE: { label: 'E 位置(AC 延长)', min: 1.15, max: 2.2, step: 0.01, def: 1.6 }
  };
  var W = 960, H = 540;
  var CX = 320, CY = 255, R = 185;

  var D2R = Math.PI / 180;
  function ptOn(theta) { return { x: CX + R * Math.cos(theta * D2R), y: CY + R * Math.sin(theta * D2R) }; }
  function dist(p, q) { return Math.hypot(p.x - q.x, p.y - q.y); }
  /** 顶点 v 处,两射线(指向 p、q)的夹角(度,0..180) */
  function angleAt(v, p, q) {
    var a1 = Math.atan2(p.y - v.y, p.x - v.x), a2 = Math.atan2(q.y - v.y, q.x - v.x);
    var d = Math.abs(a1 - a2);
    if (d > Math.PI) d = 2 * Math.PI - d;
    return d / D2R;
  }

  function mount(container, params, ctx) {
    var svg = S.el('svg', { viewBox: '0 0 ' + W + ' ' + H, preserveAspectRatio: 'xMidYMid meet' });
    container.appendChild(svg);
    var p = Object.assign({}, defaults(), params || {});
    var onChange = ctx && ctx.onParamChange;

    var ANGLE_DEFS = {
      angACB: { at: 'C', from: 'A', to: 'B', color: '#C8102E', name: '∠ACB' },
      angAOB: { at: 'O', from: 'A', to: 'B', color: '#1D4ED8', name: '∠AOB' },
      angOAC: { at: 'A', from: 'O', to: 'C', color: '#059669', name: '∠OAC' },
      angOAB: { at: 'A', from: 'O', to: 'B', color: '#7C3AED', name: '∠OAB' },
      angOBA: { at: 'B', from: 'O', to: 'A', color: '#7C3AED', name: '∠OBA' },
      angADB: { at: 'D', from: 'A', to: 'B', color: '#C8102E', name: '∠ADB' },
      angCDB: { at: 'D', from: 'C', to: 'B', color: '#EA580C', name: '∠CDB' },
      angOBC: { at: 'B', from: 'O', to: 'C', color: '#EA580C', name: '∠OBC' },
      angCAB: { at: 'A', from: 'C', to: 'B', color: '#0891B2', name: '∠CAB' },
      angOBE: { at: 'B', from: 'O', to: 'E', color: '#DC2626', name: '∠OBE' }
    };
    var visible = { circle: false, triangle: false, radiusOA: false, radiusOB: false, pointD: false, segBE: false, arcAB: false, readout: false };
    Object.keys(ANGLE_DEFS).forEach(function (k) { visible[k] = false; });
    var progress = { circle: 1, triangle: 1, radiusOA: 1, radiusOB: 1, segBE: 1 };

    var layers = {
      base: S.el('g', { opacity: 1 }, svg),
      circle: S.el('g', { opacity: 0 }, svg),
      arcAB: S.el('g', { opacity: 0 }, svg),
      triangle: S.el('g', { opacity: 0 }, svg),
      radiusOA: S.el('g', { opacity: 0 }, svg),
      radiusOB: S.el('g', { opacity: 0 }, svg),
      segBE: S.el('g', { opacity: 0 }, svg),
      pointD: S.el('g', { opacity: 0 }, svg),
      angles: S.el('g', null, svg),
      readout: S.el('g', { opacity: 0 }, svg),
      handles: S.el('g', null, svg)
    };

    var circleEl = S.el('circle', { cx: CX, cy: CY, r: R, fill: 'none', stroke: '#1F2328', 'stroke-width': 2.2 }, layers.circle);
    var oDot = S.el('circle', { cx: CX, cy: CY, r: 4, fill: '#1F2328' }, layers.circle);
    S.text(layers.circle, CX - 6, CY - 10, 'O', { 'font-size': 15, 'font-style': 'italic', fill: '#1F2328', 'font-family': 'Georgia, serif', 'text-anchor': 'end' });
    var arcABEl = S.el('path', { fill: 'none', stroke: '#F59E0B', 'stroke-width': 5, 'stroke-linecap': 'round', opacity: 0.9 }, layers.arcAB);
    var triPath = S.el('path', { fill: 'none', stroke: '#1D4ED8', 'stroke-width': 2.4, 'stroke-linejoin': 'round' }, layers.triangle);
    var oaLine = S.el('line', { stroke: '#059669', 'stroke-width': 2.2, 'stroke-dasharray': '7 4' }, layers.radiusOA);
    var obLine = S.el('line', { stroke: '#7C3AED', 'stroke-width': 2.4 }, layers.radiusOB);
    var beLine = S.el('line', { stroke: '#DC2626', 'stroke-width': 2.2 }, layers.segBE);
    var aeLine = S.el('line', { stroke: '#9CA3AF', 'stroke-width': 1.6, 'stroke-dasharray': '5 4' }, layers.segBE);
    var dDot = S.el('circle', { r: 4.5, fill: '#EA580C' }, layers.pointD);
    var dLabel = S.text(layers.pointD, 0, 0, 'D', { 'font-size': 15, 'font-style': 'italic', fill: '#EA580C', 'font-family': 'Georgia, serif', 'font-weight': 700 });
    var dMissing = S.text(layers.pointD, CX, CY + R + 34, '', { 'font-size': 12.5, fill: '#EA580C', 'text-anchor': 'middle', 'font-family': 'system-ui, sans-serif' });

    // 顶点点与字母(随 triangle 层)
    function vertexDot(color) {
      var g = S.el('g', null, layers.triangle);
      var dot = S.el('circle', { r: 5, fill: color, stroke: '#fff', 'stroke-width': 1.5 }, g);
      var lab = S.text(g, 0, 0, '', { 'font-size': 16, 'font-style': 'italic', 'font-weight': 700, fill: color, 'font-family': 'Georgia, serif' });
      return { g: g, dot: dot, lab: lab };
    }
    var vA = vertexDot('#1D4ED8'), vB = vertexDot('#1D4ED8'), vC = vertexDot('#1D4ED8');
    var eDot = S.el('circle', { r: 5, fill: '#DC2626', stroke: '#fff', 'stroke-width': 1.5 }, layers.segBE);
    var eLab = S.text(layers.segBE, 0, 0, 'E', { 'font-size': 16, 'font-style': 'italic', 'font-weight': 700, fill: '#DC2626', 'font-family': 'Georgia, serif' });

    // 角标注节点
    var angleNodes = {};
    Object.keys(ANGLE_DEFS).forEach(function (k) {
      var g = S.el('g', { opacity: 0 }, layers.angles);
      angleNodes[k] = {
        g: g,
        arc: S.el('path', { fill: 'none', 'stroke-width': 2.2, stroke: ANGLE_DEFS[k].color }, g),
        text: S.text(g, 0, 0, '', { 'font-size': 12.5, 'font-weight': 700, fill: ANGLE_DEFS[k].color, 'font-family': 'system-ui, sans-serif', 'text-anchor': 'middle' })
      };
    });

    // 读数面板
    var ro = layers.readout;
    S.el('rect', { x: 650, y: 60, width: 292, height: 246, rx: 12, fill: '#fff', stroke: '#E5E7EB' }, ro);
    S.text(ro, 666, 86, '角度与关系(实时)', { 'font-size': 12, fill: '#6B7280', 'font-family': 'system-ui, sans-serif' });
    var roLines = [];
    for (var li = 0; li < 7; li++) roLines.push(S.text(ro, 666, 114 + li * 27, '', { 'font-size': 13, fill: '#1F2328', 'font-family': 'system-ui, sans-serif' }));

    // ---------- 派生几何 ----------
    function geo() {
      var A = ptOn(p.thetaA), B = ptOn(p.thetaB), C = ptOn(clamp(p.thetaC, 0, 360)), O = { x: CX, y: CY };
      // D = 半径 OB 与弦 AC 的交点(线段相交才算)
      var D = null;
      var r1x = B.x - O.x, r1y = B.y - O.y, r2x = C.x - A.x, r2y = C.y - A.y;
      var det = r1x * (-r2y) - (-r2x) * r1y;
      if (Math.abs(det) > 1e-9) {
        var qx = A.x - O.x, qy = A.y - O.y;
        var t = (qx * (-r2y) + r2x * qy) / det;      // O + t·OB
        var s = (r1x * qy - r1y * qx) / det;          // A + s·AC
        if (t > 0.02 && t < 0.98 && s > 0.02 && s < 0.98) D = { x: O.x + t * r1x, y: O.y + t * r1y };
      }
      var E = { x: A.x + p.tE * (C.x - A.x), y: A.y + p.tE * (C.y - A.y) };
      return { A: A, B: B, C: C, O: O, D: D, E: E };
    }
    function angleValue(key, g) {
      var def = ANGLE_DEFS[key];
      var pts = { A: g.A, B: g.B, C: g.C, O: g.O, D: g.D, E: g.E };
      var v = pts[def.at], q1 = pts[def.from], q2 = pts[def.to];
      if (!v || !q1 || !q2) return null;
      return angleAt(v, q1, q2);
    }

    function labelOutward(pt, other, gap) {
      // 字母放在远离 other 的一侧
      var dx = pt.x - other.x, dy = pt.y - other.y;
      var len = Math.hypot(dx, dy) || 1;
      return { x: pt.x + (dx / len) * gap, y: pt.y + (dy / len) * gap + 5 };
    }

    // 同一顶点的多个角标注按「当前可见」的序号分层(半径递增),避免弧线与数值互相叠压
    function anglePath(key, g) {
      var def = ANGLE_DEFS[key];
      var pts = { A: g.A, B: g.B, C: g.C, O: g.O, D: g.D, E: g.E };
      var v = pts[def.at], q1 = pts[def.from], q2 = pts[def.to];
      if (!v || !q1 || !q2) return null;
      var tier = 0;
      for (var kk in ANGLE_DEFS) {
        if (kk === key) break;
        if (ANGLE_DEFS[kk].at === def.at && visible[kk]) tier++;
      }
      var a1 = Math.atan2(q1.y - v.y, q1.x - v.x), a2 = Math.atan2(q2.y - v.y, q2.x - v.x);
      var d = a2 - a1;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      var r = (def.at === 'O' ? 26 : 20) + tier * 11;
      var p1 = { x: v.x + r * Math.cos(a1), y: v.y + r * Math.sin(a1) };
      var p2 = { x: v.x + r * Math.cos(a1 + d), y: v.y + r * Math.sin(a1 + d) };
      var mid = a1 + d / 2;
      return {
        d: 'M' + p1.x.toFixed(1) + ' ' + p1.y.toFixed(1) + ' A' + r + ' ' + r + ' 0 0 ' + (d > 0 ? 1 : 0) + ' ' + p2.x.toFixed(1) + ' ' + p2.y.toFixed(1),
        tx: v.x + (r + 15) * Math.cos(mid),
        ty: v.y + (r + 15) * Math.sin(mid) + 4,
        value: Math.abs(d) / D2R
      };
    }

    function render() {
      var g = geo();
      // 三角形与顶点
      S.attr(triPath, { d: triangleD(g, progress.triangle) });
      [[vA, g.A, 'A'], [vB, g.B, 'B'], [vC, g.C, 'C']].forEach(function (item) {
        var vd = item[0], pt = item[1];
        S.attr(vd.dot, { cx: pt.x, cy: pt.y });
        var lp = labelOutward(pt, g.O, 18);
        S.attr(vd.lab, { x: lp.x - 5, y: lp.y });
        vd.lab.textContent = item[2];
      });
      // 半径
      S.attr(oaLine, { x1: g.O.x, y1: g.O.y, x2: g.O.x + (g.A.x - g.O.x) * progress.radiusOA, y2: g.O.y + (g.A.y - g.O.y) * progress.radiusOA });
      S.attr(obLine, { x1: g.O.x, y1: g.O.y, x2: g.O.x + (g.B.x - g.O.x) * progress.radiusOB, y2: g.O.y + (g.B.y - g.O.y) * progress.radiusOB });
      // 弧 AB(不含 C 的那段)
      var aA = p.thetaA * D2R, aB = p.thetaB * D2R;
      var sweepUp = p.thetaA > p.thetaB; // 从 B 到 A 不经过 C(C 在 270..360)
      S.attr(arcABEl, { d: 'M' + ptOn(p.thetaB).x.toFixed(1) + ' ' + ptOn(p.thetaB).y.toFixed(1) + ' A' + R + ' ' + R + ' 0 0 1 ' + ptOn(p.thetaA).x.toFixed(1) + ' ' + ptOn(p.thetaA).y.toFixed(1) });
      void aA; void aB; void sweepUp;
      // D 与 E
      if (g.D) {
        S.attr(dDot, { cx: g.D.x, cy: g.D.y });
        S.attr(dLabel, { x: g.D.x + 8, y: g.D.y + 18 });
        dMissing.textContent = '';
        S.attr(dDot, { opacity: 1 }); S.attr(dLabel, { opacity: 1 });
      } else {
        S.attr(dDot, { opacity: 0 }); S.attr(dLabel, { opacity: 0 });
        dMissing.textContent = '当前位置下半径 OB 与 AC 不相交(拖动 A、B、C 调整)';
      }
      S.attr(beLine, { x1: g.B.x, y1: g.B.y, x2: g.B.x + (g.E.x - g.B.x) * progress.segBE, y2: g.B.y + (g.E.y - g.B.y) * progress.segBE });
      S.attr(aeLine, { x1: g.C.x, y1: g.C.y, x2: g.E.x, y2: g.E.y });
      S.attr(eDot, { cx: g.E.x, cy: g.E.y });
      S.attr(eLab, { x: g.E.x + 10, y: g.E.y + 5 });
      // 角标注
      Object.keys(ANGLE_DEFS).forEach(function (k) {
        var node = angleNodes[k];
        if (!visible[k]) { S.attr(node.g, { opacity: 0 }); return; }
        var ap = anglePath(k, g);
        if (!ap) { S.attr(node.g, { opacity: 0 }); return; }
        S.attr(node.g, { opacity: 1 });
        S.attr(node.arc, { d: ap.d });
        S.attr(node.text, { x: ap.tx, y: ap.ty });
        node.text.textContent = fmt(ap.value, 0) + '°';
      });
      // 读数
      var acb = angleValue('angACB', g), aob = angleValue('angAOB', g);
      var oac = angleValue('angOAC', g), adb = g.D ? angleValue('angADB', g) : null;
      var cdb = g.D ? angleValue('angCDB', g) : null, obc = angleValue('angOBC', g), cab = angleValue('angCAB', g);
      var be = dist(g.B, g.E), ba = dist(g.B, g.A), obe = angleValue('angOBE', g);
      roLines[0].textContent = '∠ACB = ' + fmt(acb, 0) + '°  ∠AOB = ' + fmt(aob, 0) + '°' + (Math.abs(aob - 2 * acb) < 0.8 ? '(= 2∠ACB ✓)' : '');
      roLines[1].textContent = 'OA = OB = OC = R → △OAB 等腰';
      roLines[2].textContent = '∠OAC = ' + fmt(oac, 0) + '°  ∠CAB = ' + fmt(cab, 0) + '°';
      roLines[3].textContent = g.D ? '∠ADB = ' + fmt(adb, 0) + '°  ∠CDB = ' + fmt(cdb, 0) + '°' : 'D 不存在(OB 与 AC 不相交)';
      roLines[4].textContent = '∠OBC = ' + fmt(obc, 0) + '°' + (g.D && Math.abs(cdb - obc) < 0.8 ? '(= ∠CDB ✓)' : '');
      roLines[5].textContent = g.D && Math.abs(cdb - obc) < 0.8 ? '此时 ∠ACB = ' + fmt(acb, 0) + '° = 2∠CAB ' + (Math.abs(acb - 2 * cab) < 0.8 ? '✓' : '✗') : '';
      roLines[6].textContent = visible.segBE ? 'BE/BA = ' + fmt(be / ba, 2) + (Math.abs(be - ba) < 3 ? '(BE = BA ✓)' : '') + '  ∠OBE = ' + fmt(obe, 0) + '°' + (Math.abs(obe - 90) < 0.8 ? '(OB⊥BE ✓)' : '') : '';
      allHandles.forEach(function (hd) { hd.update(); });
    }
    function triangleD(g, prog) {
      // 逐边画出:A→B→C→A
      var pts = [g.A, g.B, g.C, g.A];
      var total = 3;
      var upto = clamp(prog == null ? 1 : prog, 0, 1) * total;
      var d = 'M' + g.A.x.toFixed(1) + ' ' + g.A.y.toFixed(1);
      for (var i = 1; i <= 3; i++) {
        var f = clamp(upto - (i - 1), 0, 1);
        if (f <= 0) break;
        var from = pts[i - 1], to = pts[i];
        d += ' L' + (from.x + (to.x - from.x) * f).toFixed(1) + ' ' + (from.y + (to.y - from.y) * f).toFixed(1);
      }
      return d;
    }

    // ---------- 手柄 ----------
    var allHandles = [];
    function setParam(id, v) {
      var spec = PARAMS[id];
      p[id] = LS.snap(clamp(v, spec.min, spec.max), spec.step);
      render();
      onChange && onChange(id, p[id], Object.assign({}, p));
    }
    function thetaHandle(id, label) {
      allHandles.push(new LS.Handle(svg, layers.handles, {
        id: id, label: label, color: '#1D4ED8',
        get: function () { return ptOn(p[id]); },
        onDrag: function (x, y) {
          var deg = Math.atan2(y - CY, x - CX) / D2R;
          if (deg < 0) deg += 360;
          if (id === 'thetaC' && deg < 90) deg += 360; // C 靠近 360 时跨零处理
          setParam(id, deg);
        }
      }));
    }
    thetaHandle('thetaA', 'A'); thetaHandle('thetaB', 'B'); thetaHandle('thetaC', 'C');
    allHandles.push(new LS.Handle(svg, layers.handles, {
      id: 'tE', label: 'E', color: '#DC2626',
      get: function () { var g = geo(); return g.E; },
      onDrag: function (x, y) {
        var g = geo();
        var dx = g.C.x - g.A.x, dy = g.C.y - g.A.y;
        var t = ((x - g.A.x) * dx + (y - g.A.y) * dy) / (dx * dx + dy * dy);
        setParam('tE', t);
      }
    }));

    render();

    return {
      svg: svg,
      getParams: function () { return Object.assign({}, p); },
      setParams: function (np) { Object.assign(p, np); render(); },
      setUnlocked: function (ids) { allHandles.forEach(function (hd) { hd.setLocked(ids.indexOf(hd.spec.id) < 0); }); },
      getAnchor: function (id) {
        var g = geo();
        var map = {
          A: { x: g.A.x, y: g.A.y, r: 26 }, B: { x: g.B.x, y: g.B.y, r: 26 }, C: { x: g.C.x, y: g.C.y, r: 26 },
          O: { x: g.O.x, y: g.O.y, r: 24 }, E: { x: g.E.x, y: g.E.y, r: 24 },
          D: g.D ? { x: g.D.x, y: g.D.y, r: 24 } : null,
          arcAB: (function () { var m = ptOn((p.thetaA + p.thetaB) / 2); return { x: m.x, y: m.y, r: 34 }; })(),
          readout: { x: 796, y: 183, r: 120 }
        };
        return map[id] || null;
      },
      beginStep: function () {},
      applyAction: function (act) {
        var dur = act.durationMs == null ? 900 : act.durationMs;
        var d = function (def) { return act.durationMs == null ? def : act.durationMs; };
        switch (act.type) {
          case 'show': {
            visible[act.target] = true;
            var node = layers[act.target] || (angleNodes[act.target] && angleNodes[act.target].g);
            render();
            if (!node) return LS.wait(200);
            if (angleNodes[act.target]) return LS.wait(250); // 角标注的显隐在 render 里按 visible 控制
            return LS.tween({ duration: Math.min(dur, 600), onUpdate: function (t) { S.attr(node, { opacity: t }); } });
          }
          case 'hide': {
            visible[act.target] = false;
            var node2 = layers[act.target];
            if (node2) S.attr(node2, { opacity: 0 });
            render();
            return LS.wait(200);
          }
          case 'draw': {
            var key = act.target;
            if (!(key in progress)) { visible[key] = true; render(); return LS.wait(300); }
            visible[key] = true; progress[key] = 0;
            var layer = layers[key];
            S.attr(layer, { opacity: 1 });
            render();
            return LS.tween({ duration: d(1400), easing: 'easeInOut', onUpdate: function (t) { progress[key] = t; render(); } });
          }
          case 'move': {
            var id = act.param, to = Number(act.to), from = act.from == null ? p[id] : Number(act.from);
            p[id] = from; render();
            return LS.tween({ duration: d(1400), onUpdate: function (t) { p[id] = from + (to - from) * t; render(); } });
          }
          case 'highlight': {
            var tgt = act.target === 'arcAB' ? arcABEl : act.target === 'triangle' ? triPath : act.target === 'radiusOB' ? obLine : act.target === 'segBE' ? beLine : circleEl;
            return LS.tween({ duration: d(900), onUpdate: function (t) { S.attr(tgt, { 'stroke-width': (act.target === 'arcAB' ? 5 : 2.4) * (1 + 0.7 * Math.sin(Math.PI * t)) }); } });
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
    id: 'circle-angle',
    name: '圆与圆周角',
    subject: '数学',
    params: PARAMS,
    targets: ['circle', 'triangle', 'radiusOA', 'radiusOB', 'pointD', 'segBE', 'arcAB', 'readout', 'angACB', 'angAOB', 'angOAC', 'angOAB', 'angOBA', 'angADB', 'angCDB', 'angOBC', 'angCAB', 'angOBE'],
    actions: ['show', 'hide', 'draw', 'move', 'highlight', 'readout'],
    defaults: defaults,
    mount: mount,
    describe: '⊙O 内接 △ABC,半径 OB 与 AC 交于 D,E 在 AC 延长线上;A/B/C 沿圆可拖,E 沿延长线可拖;一组角标注实时显值,读数面板给关系检验(圆心角=2×圆周角、∠CDB=∠OBC?、BE=BA?、OB⊥BE?)。'
  });
})(window);
