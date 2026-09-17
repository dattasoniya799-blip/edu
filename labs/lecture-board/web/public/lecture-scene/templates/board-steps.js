/*
 * 模板 · 通用板书(board-steps)—— 六类交互模板之外的任何题都能讲(2026-09-16 设计 §六)
 * 舞台 = 板书区:左侧「步骤」栏(随 beginStep 高亮当前步),右侧逐行浮现的板书行(来自 script.board.lines)。
 * 行类型:text 常规 / formula 等宽居中(板书蓝)/ conclusion 带框(红笔)。公式第一版 Unicode 明文,不引 KaTeX。
 * 参数:无(getParams 返回 {});没有手柄(动手环节只留「重看总结 / 重听某步」)。
 * 动作:show(lineId) 写出一行(从左到右揭开)/ hide(lineId) 擦掉 / highlight(lineId) 荧光笔一闪
 * 锚点:任一行 id(label/focus/pulse 直接填行 id)/ board(整块板书)/ steps(左侧步骤栏)
 */
(function (global) {
  'use strict';
  var LS = global.LectureScene;
  var S = LS.svg;

  var W = 960, H = 540;
  var RAIL = { x: 0, y: 0, w: 196 };                 // 左侧步骤栏
  var BOARD = { x: 224, y: 28, w: 708, h: H - 56 };  // 右侧板书区(内容区)
  var STYLE = {
    text: { size: 19, lh: 30, family: '-apple-system, BlinkMacSystemFont, "PingFang SC", "Noto Sans SC", "Microsoft YaHei", sans-serif', fill: '#1F2328', weight: 500, mono: false },
    formula: { size: 21, lh: 34, family: '"SF Mono", Menlo, Consolas, "Noto Sans Mono CJK SC", monospace', fill: '#1D4ED8', weight: 600, mono: true },
    conclusion: { size: 19, lh: 32, family: '-apple-system, BlinkMacSystemFont, "PingFang SC", "Noto Sans SC", "Microsoft YaHei", sans-serif', fill: '#991B1B', weight: 700, mono: false }
  };
  var GAP = 10;          // 行间距
  var BOX_PAD = 10;      // conclusion 框内边距
  var MIN_SCALE = 0.72;  // 板书太长时最多缩到这个比例,再长就滚动

  /** 字宽估算(viewBox 单位):CJK/全角 1em,其余按比例;不依赖字体加载,布局确定 */
  function charW(ch, size, mono) {
    var code = ch.charCodeAt(0);
    if (code >= 0x2E80 || (code >= 0xFF00 && code <= 0xFFEF)) return size;            // CJK、全角标点、数学符号
    if (ch === ' ') return size * (mono ? 0.6 : 0.3);
    if (mono) return size * 0.6;
    if (/[0-9A-Za-z]/.test(ch)) return size * 0.56;
    if (/[(){}\[\]]/.test(ch)) return size * 0.36;
    return size * 0.5;
  }
  function textW(str, size, mono) { var w = 0; for (var i = 0; i < str.length; i++) w += charW(str[i], size, mono); return w; }
  /** 按最大宽度折行(优先在空格/标点后断,退化为逐字) */
  function wrap(str, size, mono, maxW) {
    var rows = [], cur = '', curW = 0, lastBreak = -1;
    for (var i = 0; i < str.length; i++) {
      var ch = str[i], w = charW(ch, size, mono);
      if (curW + w > maxW && cur) {
        if (lastBreak > 0 && lastBreak < cur.length - 1) { rows.push(cur.slice(0, lastBreak + 1).replace(/\s+$/, '')); cur = cur.slice(lastBreak + 1); curW = textW(cur, size, mono); }
        else { rows.push(cur); cur = ''; curW = 0; }
        lastBreak = -1;
      }
      cur += ch; curW += w;
      if (/[\s,,;;。.、)]/.test(ch)) lastBreak = cur.length - 1;
    }
    if (cur) rows.push(cur);
    return rows.length ? rows : [''];
  }

  function mount(container, params, ctx) {
    var svg = S.el('svg', { viewBox: '0 0 ' + W + ' ' + H, preserveAspectRatio: 'xMidYMid meet' });
    container.appendChild(svg);
    var player = ctx && ctx.player;
    var script = (player && player.script) || {};
    var lines = (script.board && Array.isArray(script.board.lines) ? script.board.lines : []).filter(function (l) { return l && l.id && l.text; });
    var steps = Array.isArray(script.steps) ? script.steps : [];
    var uid = 'bs' + Math.floor(Math.random() * 1e9);

    // ---- 底:纸面 + 分栏线 ----
    S.el('rect', { x: 0, y: 0, width: W, height: H, fill: '#FBFAF7' }, svg);
    var rail = S.el('g', { class: 'bs-rail' }, svg);
    S.el('rect', { x: RAIL.x, y: RAIL.y, width: RAIL.w, height: H, fill: '#F3F4F6' }, rail);
    S.el('line', { x1: RAIL.w, y1: 0, x2: RAIL.w, y2: H, stroke: '#E5E7EB', 'stroke-width': 1 }, rail);
    S.text(rail, 20, 34, '步骤', { 'font-size': 12, 'font-weight': 800, fill: '#6B7280', 'letter-spacing': '0.14em', 'font-family': STYLE.text.family });
    var railItems = [];
    steps.forEach(function (st, i) {
      var y = 58 + i * 46;
      var g = S.el('g', { class: 'bs-step', opacity: 0.85 }, rail);
      var bg = S.el('rect', { x: 12, y: y - 18, width: RAIL.w - 24, height: 38, rx: 10, fill: '#fff', stroke: '#E5E7EB' }, g);
      var num = S.el('circle', { cx: 32, cy: y + 1, r: 11, fill: '#E5E7EB' }, g);
      var numT = S.text(g, 32, y + 5, String(i + 1), { 'text-anchor': 'middle', 'font-size': 11.5, 'font-weight': 800, fill: '#6B7280', 'font-family': STYLE.text.family });
      var title = String(st.title || '');
      var maxTitle = 9;
      if (title.length > maxTitle) title = title.slice(0, maxTitle - 1) + '…';
      var t = S.text(g, 50, y + 5, title, { 'font-size': 12.5, 'font-weight': 600, fill: '#1F2328', 'font-family': STYLE.text.family });
      railItems.push({ g: g, bg: bg, num: num, numT: numT, t: t });
    });
    function setCurrentStep(i) {
      railItems.forEach(function (it, k) {
        var on = k === i, done = k < i;
        S.attr(it.bg, { fill: on ? '#1D4ED8' : '#fff', stroke: on ? '#1D4ED8' : done ? '#93C5FD' : '#E5E7EB' });
        S.attr(it.num, { fill: on ? '#fff' : done ? '#DBEAFE' : '#E5E7EB' });
        S.attr(it.numT, { fill: on ? '#1D4ED8' : done ? '#1D4ED8' : '#6B7280' });
        S.attr(it.t, { fill: on ? '#fff' : '#1F2328' });
        S.attr(it.g, { opacity: on ? 1 : 0.85 });
      });
    }

    // ---- 板书:先整体排版(确定每行位置与缩放),再逐行揭开 ----
    // 坐标约定:scrollG 内是「内容坐标」,屏幕 y = (内容 y − scrollY) × scale,屏幕 x = BOARD.x + 内容 x × scale
    var boardG = S.el('g', { class: 'bs-board' }, svg);
    var scrollG = S.el('g', null, boardG);   // 滚动容器(板书过长时平移)
    var defs = S.el('defs', null, svg);
    var layout = [];   // {line, y, h, rows, style, w}(内容坐标)
    function computeLayout(sc) {
      var y = BOARD.y / sc, out = [];
      var maxW = BOARD.w / sc;
      lines.forEach(function (l) {
        var st = STYLE[l.kind] || STYLE.text;
        var rows = wrap(String(l.text), st.size, st.mono, maxW - (l.kind === 'conclusion' ? 2 * BOX_PAD + 6 : 0));
        var h = rows.length * st.lh + (l.kind === 'conclusion' ? 2 * BOX_PAD : 0);
        var w = 0;
        rows.forEach(function (r) { w = Math.max(w, textW(r, st.size, st.mono)); });
        out.push({ line: l, y: y, h: h, rows: rows, style: st, w: w });
        y += h + GAP;
      });
      return { items: out, total: (y - GAP - BOARD.y / sc) * sc };
    }
    var scale = 1, result = computeLayout(1);
    while (result.total > BOARD.h && scale > MIN_SCALE + 1e-6) { scale = Math.max(MIN_SCALE, scale - 0.06); result = computeLayout(scale); }
    layout = result.items;
    var overflow = result.total > BOARD.h;
    var innerW = BOARD.w / scale;
    var scrollY = 0; // 当前滚动量(内容坐标)
    function applyScroll(v) { scrollY = v; S.attr(scrollG, { transform: 'translate(' + BOARD.x + ' ' + (-v * scale) + ') scale(' + scale + ')' }); }
    applyScroll(0);

    var nodes = {};  // id → { g, clipRect, hl, visible, it, fullW }
    layout.forEach(function (it) {
      var st = it.style, l = it.line;
      var g = S.el('g', { class: 'bs-line bs-' + l.kind, 'data-line': l.id, opacity: 0 }, scrollG);
      var clipId = uid + '-' + l.id.replace(/[^A-Za-z0-9_-]/g, '_');
      var clip = S.el('clipPath', { id: clipId }, defs);
      var clipRect = S.el('rect', { x: -8, y: it.y - 6, width: 0, height: it.h + 12 }, clip);
      var inner = S.el('g', { 'clip-path': 'url(#' + clipId + ')' }, g);
      var x0 = 0, anchor = 'start';
      if (l.kind === 'formula') { x0 = innerW / 2; anchor = 'middle'; }
      var yTop = it.y;
      var hl = S.el('rect', { x: -6, y: yTop - 4, width: innerW + 12, height: it.h + 8, rx: 6, fill: '#FDE68A', 'fill-opacity': 0 }, inner);
      if (l.kind === 'conclusion') {
        S.el('rect', { x: 0, y: yTop, width: Math.min(innerW, it.w + 2 * BOX_PAD + 6), height: it.h, rx: 8, fill: '#FEF2F2', stroke: '#C8102E', 'stroke-width': 1.8 }, inner);
        x0 = BOX_PAD + 3;
      }
      var text = S.el('text', { x: x0, y: yTop, 'font-size': st.size, 'font-weight': st.weight, fill: st.fill, 'font-family': st.family, 'text-anchor': anchor }, inner);
      it.rows.forEach(function (r, k) {
        var ts = S.el('tspan', { x: x0, y: yTop + (l.kind === 'conclusion' ? BOX_PAD : 0) + st.lh * (k + 0.78) }, text);
        ts.textContent = r;
      });
      nodes[l.id] = { g: g, clipRect: clipRect, hl: hl, visible: false, it: it, fullW: innerW + 16 };
    });
    if (!lines.length) {
      S.text(boardG, BOARD.x + BOARD.w / 2, H / 2, '(剧本没有板书行 board.lines)', { 'text-anchor': 'middle', 'font-size': 16, fill: '#9CA3AF', 'font-family': STYLE.text.family });
    }

    /** 让某行完整可见(板书过长时滚动) */
    function ensureVisible(node, instant) {
      if (!overflow) return LS.wait(0);
      var top = node.it.y, bottom = node.it.y + node.it.h;
      var viewTop = scrollY + BOARD.y / scale, viewBottom = scrollY + (BOARD.y + BOARD.h) / scale;
      var target = scrollY;
      if (bottom > viewBottom) target = bottom - (BOARD.y + BOARD.h) / scale + 6;
      if (top < viewTop) target = top - BOARD.y / scale;
      target = Math.max(0, target);
      if (Math.abs(target - scrollY) < 0.5) return LS.wait(0);
      var from = scrollY;
      if (instant) { applyScroll(target); return LS.wait(0); }
      return LS.tween({ duration: 420, onUpdate: function (t) { applyScroll(from + (target - from) * t); } });
    }

    function show(id, dur) {
      var n = nodes[id];
      if (!n) return LS.wait(0);
      n.visible = true;
      S.attr(n.g, { opacity: 1 });
      var w = n.fullW;
      if (dur === 0) { S.attr(n.clipRect, { width: w }); return ensureVisible(n, true); }
      S.attr(n.clipRect, { width: 0 });
      return ensureVisible(n, false).then(function () {
        return LS.tween({ duration: dur == null ? 650 : dur, easing: 'easeOut', onUpdate: function (t) { S.attr(n.clipRect, { width: w * t }); } });
      });
    }
    function hide(id) {
      var n = nodes[id];
      if (!n) return LS.wait(0);
      n.visible = false;
      return LS.tween({ duration: 220, onUpdate: function (t) { S.attr(n.g, { opacity: 1 - t }); } });
    }
    function highlight(id, dur) {
      var n = nodes[id];
      if (!n) return LS.wait(0);
      if (!n.visible) show(id, 0);
      return LS.tween({ duration: dur == null ? 1000 : dur, onUpdate: function (t) {
        var a = t < 0.35 ? (t / 0.35) * 0.45 : 0.45 * (1 - (t - 0.35) / 0.65);
        S.attr(n.hl, { 'fill-opacity': a });
      } }).then(function () { S.attr(n.hl, { 'fill-opacity': 0 }); });
    }

    setCurrentStep(-1);

    return {
      svg: svg,
      getParams: function () { return {}; },
      setParams: function () {},
      setUnlocked: function () {},
      /** 播放器每步开始时调用:高亮左侧步骤栏 */
      beginStep: function (_st, i) { setCurrentStep(i); },
      /** 通用效果锚点:行 id → 该行中心;board → 板书区;steps → 步骤栏 */
      getAnchor: function (id) {
        var n = nodes[id];
        if (n) {
          var it = n.it;
          var contentX = it.line.kind === 'formula' ? innerW / 2 : Math.min(it.w, innerW) / 2 + (it.line.kind === 'conclusion' ? BOX_PAD + 3 : 0);
          return { x: BOARD.x + contentX * scale, y: (it.y + it.h / 2 - scrollY) * scale, r: Math.max(22, (it.h * scale) / 2 + 6) };
        }
        if (id === 'board') return { x: BOARD.x + BOARD.w / 2, y: H / 2, r: 200 };
        if (id === 'steps') return { x: RAIL.w / 2, y: H / 2, r: 90 };
        return null;
      },
      applyAction: function (act) {
        switch (act.type) {
          case 'show': return show(String(act.target), act.durationMs == null ? undefined : Math.max(0, Number(act.durationMs)));
          case 'hide': return hide(String(act.target));
          case 'highlight': return highlight(String(act.target), act.durationMs == null ? undefined : Number(act.durationMs));
          default: return LS.wait(0);
        }
      },
      destroy: function () { svg.remove(); }
    };
  }

  LS.registerTemplate({
    id: 'board-steps',
    name: '通用板书',
    subject: '通用',
    params: {},
    targets: [],
    actions: ['show', 'hide', 'highlight'],
    defaults: function () { return {}; },
    mount: mount,
    describe: '通用板书:左侧步骤栏 + 右侧逐行写出的板书行(text 常规 / formula 等宽居中 / conclusion 带框),六类交互模板之外的题都用它;无参数无手柄。'
  });
})(window);
