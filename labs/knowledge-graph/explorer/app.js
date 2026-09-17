const GROUPS = ['数学', '物理', '化学'];
// 2026-09-17 换色:原来三色都压得很灰(s 0.32–0.40),铺在米纸上像蒙了一层土。
// 改成传统色的三件套,饱和度提上来、明度拉开,在暖底上互相分得清又不刺眼:
//   数学 靛青 #3560B6 · 物理 朱砂 #D05C39 · 化学 松绿 #389472
const GHSL = [
  { h: 220, s: 0.55, l: 0.46 },
  { h: 14, s: 0.62, l: 0.52 },
  { h: 158, s: 0.45, l: 0.40 },
];
const GCOL = GHSL.map((b) => hslToHex(b.h, b.s, b.l));
const H = 1400;
const MID = '·';

function hash32(s) {
  let h = 2166136261;
  for (const c of String(s)) {
    h ^= c.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function hslToHex(h, s, l) {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs((h / 60) % 2 - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const hex = (v) => Math.round((v + m) * 255).toString(16).padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

function shade(g, key) {
  const b = GHSL[g];
  const n = hash32(key);
  const h = b.h + ((n % 13) - 6) * 0.7;
  const l = b.l + ((n % 5) - 2) / 140;
  return hslToHex(h, b.s, l);
}

function esc(s) {
  const d = document.createElement('div');
  d.textContent = s ?? '';
  return d.innerHTML;
}

async function api(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(path);
  return res.json();
}

function longestPathRank(n, E) {
  const pred = Array.from({ length: n }, () => []);
  for (const e of E) pred[e[0]].push(e[1]);
  const memo = new Int16Array(n).fill(-1);
  const visiting = new Uint8Array(n);
  const dfs = (i) => {
    if (memo[i] >= 0) return memo[i];
    if (visiting[i]) return 0;
    visiting[i] = 1;
    let d = 0;
    for (const p of pred[i]) d = Math.max(d, dfs(p) + 1);
    visiting[i] = 0;
    memo[i] = d;
    return d;
  };
  let max = 0;
  for (let i = 0; i < n; i++) max = Math.max(max, dfs(i));
  return { rank: memo, max };
}

function funnelLayout(N, E) {
  const { rank } = longestPathRank(N.length, E);
  const byG = GROUPS.map(() => []);
  N.forEach((n, i) => byG[n.g].push(i));
  for (const group of byG) {
    group.sort((a, b) => rank[a] - rank[b] || (hash32(N[a].id) - hash32(N[b].id)));
    const m = group.length || 1;
    for (let k = 0; k < group.length; k++) {
      const i = group[k];
      const h = hash32(N[i].id);
      const jitter = ((h % 1000) / 1000 - 0.5) * 0.09;
      const y = Math.max(0, Math.min(H, ((k + 0.5) / m + jitter) * H));
      const u = ((h >>> 8) % 1000) / 1000;
      const rMean = 100 + (y / H) * 380;
      const r = Math.min(620, rMean * (0.48 + Math.pow(u, 0.65) * 0.95));
      const ang = (h % 6283) / 1000;
      N[i].x = Math.cos(ang) * r;
      N[i].y = y;
      N[i].z = Math.sin(ang) * r;
    }
  }
}

function buildWorld(topics, links) {
  const N = topics.map((t) => {
    const g = Math.max(0, GROUPS.indexOf(t.subject));
    return {
      id: t.id,
      x: 0,
      y: 0,
      z: 0,
      g,
      a: t.ageRangeStart || 13,
      grade: t.grade || '',
      c: t.centrality || 0,
      col: shade(g, t.chapter || t.domain || t.id),
      dm: t.chapter || t.domain || t.subject,
      t: t.name,
      q: t.description || t.assessmentPrompt || '',
      prompt: t.assessmentPrompt || '',
      evidence: t.evidence || [],
    };
  });
  const idx = new Map(N.map((n, i) => [n.id, i]));
  const E = [];
  for (const l of links) {
    const a = idx.get(l.target);
    const b = idx.get(l.source);
    if (a == null || b == null) continue;
    E.push([a, b, l.strength === 'hard' ? 1 : 0]);
  }
  funnelLayout(N, E);
  return { N, E };
}

const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const wrap = document.getElementById('wrap');
const cv = document.getElementById('cv');
const ctx = cv.getContext('2d');
const tip = document.getElementById('tip');
const card = document.getElementById('card');
const emptyEl = document.getElementById('empty');
const chips = document.getElementById('chips');

let N = [];
let E = [];
let RGB = [];
let incident = [];
let directPre = [];
let directNext = [];
let P = new Float32Array(0);
const order = [];
const active = new Set(GROUPS.map((_, i) => i));
let stage = 'junior';
let hover = -1, selected = -1, lineage = null;
const hist = [];
let rotY = 0.6, tilt = -0.32, zoom = 1, spin = reduce ? 0 : 0.00018;
let rotYTarget = null, tiltTarget = null, zoomTarget = null;
let grow = reduce ? 1 : 0;
let DPR = 1, VW = 0, VH = 0;
const FOV = 1400;
const cache = new Map();

function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  VW = wrap.clientWidth;
  VH = wrap.clientHeight;
  cv.width = VW * DPR;
  cv.height = VH * DPR;
  cv.style.width = VW + 'px';
  cv.style.height = VH + 'px';
  SPR.clear(); // 精灵按 DPR 预渲染,分辨率变了要重画
}

/**
 * 节点精灵(2026-09-17 换掉「纯色圆 + 黑描边」):
 * 米纸色光环把点和线、和相邻点隔开;圆面用径向渐变做出一颗珠子的体积感
 * (左上偏白的高光 → 本色 → 同色系略深的边缘),不再用黑色描边。
 * 每种 (颜色, 半径 0.5px 档) 只画一次,之后 drawImage,比每帧建 1000 个渐变便宜得多。
 */
const SPR = new Map();
const PAPER = '244,241,235'; // 与 styles.css --bg 同色
function sprite(rgb, r) {
  const rq = Math.max(1.5, Math.round(r * 2) / 2);
  const key = rgb + '|' + rq;
  let s = SPR.get(key);
  if (s) return s;
  const pad = 3, half = rq + pad, size = Math.ceil(half * 2 * DPR);
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  g.setTransform(DPR, 0, 0, DPR, 0, 0);
  const [R, G, B] = rgb.split(',').map(Number);
  const mix = (t, tr, tg, tb) =>
    `rgb(${Math.round(R + (tr - R) * t)},${Math.round(G + (tg - G) * t)},${Math.round(B + (tb - B) * t)})`;
  g.fillStyle = `rgba(${PAPER},0.92)`;
  g.beginPath();
  g.arc(half, half, rq + 1.4, 0, 6.2832);
  g.fill();
  const grad = g.createRadialGradient(half - rq * 0.34, half - rq * 0.34, rq * 0.12, half, half, rq);
  grad.addColorStop(0, mix(0.46, 255, 255, 255));
  grad.addColorStop(0.5, mix(0.1, 255, 255, 255));
  grad.addColorStop(1, mix(0.24, 0, 0, 0));
  g.fillStyle = grad;
  g.beginPath();
  g.arc(half, half, rq, 0, 6.2832);
  g.fill();
  s = { c, half };
  SPR.set(key, s);
  return s;
}

function project() {
  const cy = Math.cos(rotY), sy = Math.sin(rotY);
  const ct = Math.cos(tilt), st = Math.sin(tilt);
  const headEl = document.getElementById('head');
  const keep = (headEl ? headEl.getBoundingClientRect().right : VW * 0.32) + 56;
  const cyy = VH * 0.52;
  let sc = Math.min(VW / 1580, VH / 1780) * zoom;
  const half = 540 * sc;
  let cx = Math.max(VW * 0.66, keep + half * 0.58);
  if (cx - half < keep) {
    cx = Math.min(VW * 0.84, keep + half);
    const room = cx - keep;
    if (room < half) sc *= Math.max(0.7, room / half);
  }
  for (let i = 0; i < N.length; i++) {
    const n = N[i];
    let x = n.x * cy + n.z * sy, z = -n.x * sy + n.z * cy, y = n.py;
    let y2 = y * ct - z * st, z2 = y * st + z * ct;
    const pf = FOV / (FOV + z2 * sc * 1.6);
    P[i * 3] = cx + x * sc * pf;
    P[i * 3 + 1] = cyy - y2 * sc * pf;
    P[i * 3 + 2] = pf;
  }
}

function nodeR(i) {
  // 半径档差收窄(原 2.3–9.8 → 2.6–7.6):大点不再像纽扣,小点不至于消失
  return (2.6 + Math.sqrt(Math.min(1, N[i].c * 0.55)) * 5.0) * P[i * 3 + 2] * Math.min(1.6, Math.max(0.9, zoom));
}

function pick(mx, my) {
  let best = -1, bd = 20 * 20;
  for (let i = 0; i < N.length; i++) {
    if (!active.has(N[i].g)) continue;
    const dx = P[i * 3] - mx, dy = P[i * 3 + 1] - my, d = dx * dx + dy * dy;
    const rr = Math.max(11, nodeR(i) + 6);
    if (d < rr * rr && d < bd) { bd = d; best = i; }
  }
  return best;
}

function buildLineage(i) {
  const nodes = new Set([i]), edges = new Set(), q = [i];
  while (q.length) {
    const u = q.shift();
    for (const idx of incident[u]) {
      const e = E[idx];
      if (e[0] === u) {
        edges.add(idx);
        if (!nodes.has(e[1])) { nodes.add(e[1]); q.push(e[1]); }
      }
    }
  }
  lineage = { nodes, edges };
}

function focusNode(i) {
  const n = N[i];
  let best = null, bestZ = Infinity;
  for (const cand of [Math.atan2(-n.x, n.z), Math.atan2(-n.x, n.z) + Math.PI]) {
    const z2 = -n.x * Math.sin(cand) + n.z * Math.cos(cand);
    if (z2 < bestZ) { bestZ = z2; best = cand; }
  }
  rotYTarget = best;
  tiltTarget = -0.18;
  zoomTarget = Math.max(zoom, 1.5);
}

function hideTip() { tip.classList.remove('on'); }

function placeTip(e) {
  const r = wrap.getBoundingClientRect();
  let x = e.clientX - r.left + 16, y = e.clientY - r.top + 16;
  const w = tip.offsetWidth, h = tip.offsetHeight;
  if (x + w > VW - 8) x = e.clientX - r.left - w - 16;
  if (y + h > VH - 8) y = e.clientY - r.top - h - 16;
  tip.style.left = x + 'px';
  tip.style.top = y + 'px';
}

function showTip(i, e) {
  const n = N[i];
  tip.querySelector('.sw').style.background = n.col;
  tip.querySelector('.ts').textContent = `${n.dm} ${MID} ${n.grade || ('年龄 ' + n.a)}`;
  tip.querySelector('.ttl').textContent = n.t;
  tip.querySelector('.q').innerHTML = n.q ? esc(n.q) : '';
  tip.classList.add('on');
  placeTip(e);
}

function fillRows(container, idxs) {
  container.innerHTML = '';
  if (!idxs.length) {
    const d = document.createElement('div');
    d.className = 'empty';
    d.textContent = '还没有';
    container.appendChild(d);
    return;
  }
  idxs.slice().sort((a, b) => N[a].a - N[b].a).forEach((j) => {
    const m = N[j], b = document.createElement('button');
    b.type = 'button';
    b.className = 'row';
    b.innerHTML = `<span class="rdot" style="background:${m.col}"></span><span class="rt">${esc(m.t)}</span><span class="ra">${esc(m.grade || '')}</span>`;
    b.addEventListener('click', () => selectNode(j, true));
    container.appendChild(b);
  });
}

function fillEvidence(items) {
  const canBox = card.querySelector('.intro.can');
  const pitBox = card.querySelector('.intro.pit');
  const canUl = card.querySelector('.ev-can');
  const pitUl = card.querySelector('.ev-pit');
  const can = [];
  const pit = [];
  for (const raw of items || []) {
    const s = String(raw).trim();
    if (!s) continue;
    if (s.startsWith('能避免')) pit.push(s.replace(/^能避免[:：]?\s*/, ''));
    else can.push(s);
  }
  canUl.innerHTML = '';
  pitUl.innerHTML = '';
  canBox.hidden = can.length === 0;
  pitBox.hidden = pit.length === 0;
  for (const text of can) {
    const li = document.createElement('li');
    li.textContent = text;
    canUl.appendChild(li);
  }
  for (const text of pit) {
    const li = document.createElement('li');
    li.textContent = text;
    pitUl.appendChild(li);
  }
}

async function showCard(i) {
  const n = N[i], cnt = lineage.nodes.size - 1;
  card.querySelector('.sw').style.background = n.col;
  card.querySelector('.cs').textContent = `${n.dm} ${MID} ${n.grade || ''}`.trim();
  card.querySelector('.ctl').textContent = n.t;
  card.querySelector('.cq').textContent = n.q || '';
  card.querySelector('.n').textContent = cnt;
  card.querySelector('.u').textContent = '步铺路';
  card.querySelector('.sub').textContent = cnt > 0
    ? '在这儿错,多半不是这一步的问题。是下面这些还没真过关——补这些,比再做十道题管用。'
    : '这是起点。从这里开始,一步都虚不得。';
  const pre = directPre[i], nxt = directNext[i];
  card.querySelector('.sec-pre .k').textContent = pre.length ? pre.length : '';
  card.querySelector('.sec-next .k').textContent = nxt.length ? nxt.length : '';
  fillRows(card.querySelector('.rows-pre'), pre);
  fillRows(card.querySelector('.rows-next'), nxt);
  card.querySelector('.back').classList.toggle('on', hist.length > 0);
  card.scrollTop = 0;
  card.classList.add('on');
  fillEvidence(n.evidence);

  try {
    let topic = cache.get(n.id);
    if (!topic) {
      topic = await api('/api/topics/' + encodeURIComponent(n.id));
      cache.set(n.id, topic);
    }
    if (selected !== i) return;
    if (topic.description && topic.description !== n.q) {
      card.querySelector('.cq').textContent = topic.description;
    }
    if (topic.evidence && topic.evidence.length) fillEvidence(topic.evidence);
  } catch {
    /* keep the summary already on the card */
  }
}

function clearSel() {
  selected = -1;
  lineage = null;
  hist.length = 0;
  rotYTarget = null;
  tiltTarget = null;
  zoomTarget = null;
  card.classList.remove('on');
  if (!reduce) spin = 0.00018;
}

function selectNode(i, push) {
  if (push && selected >= 0 && selected !== i) hist.push(selected);
  selected = i;
  buildLineage(i);
  showCard(i);
  focusNode(i);
  spin = 0;
  hideTip();
}

function goBack() {
  if (!hist.length) return;
  selectNode(hist.pop(), false);
}

function onHover(e) {
  const r = cv.getBoundingClientRect();
  const i = pick(e.clientX - r.left, e.clientY - r.top);
  if (i !== hover) {
    hover = i;
    i >= 0 ? showTip(i, e) : hideTip();
  } else if (i >= 0) placeTip(e);
  spin = (hover >= 0 || selected >= 0 || reduce) ? 0 : 0.00018;
}

function onClick(e) {
  const r = cv.getBoundingClientRect();
  const i = pick(e.clientX - r.left, e.clientY - r.top);
  if (i < 0) { clearSel(); return; }
  selectNode(i, true);
}

function draw() {
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.clearRect(0, 0, VW, VH);
  if (!N.length) return;
  project();
  const hasSel = !!lineage;

  for (let k = 0; k < E.length; k++) {
    const e = E[k], a = e[0], b = e[1];
    if (!active.has(N[a].g) || !active.has(N[b].g)) continue;
    if (!reduce && (N[a].appear > grow || N[b].appear > grow)) continue;
    let alpha, col = null, lw = 1;
    if (hasSel) {
      if (lineage.edges.has(k)) { alpha = 0.72; col = RGB[b]; lw = 1.6; }
      else alpha = 0.035;
    } else {
      alpha = e[2] ? 0.10 : 0.05;
    }
    const depth = (P[a * 3 + 2] + P[b * 3 + 2]) / 2;
    ctx.strokeStyle = col ? `rgba(${col},${alpha})` : `rgba(92,82,72,${alpha * depth})`;
    ctx.lineWidth = lw;
    ctx.beginPath();
    ctx.moveTo(P[a * 3], P[a * 3 + 1]);
    ctx.lineTo(P[b * 3], P[b * 3 + 1]);
    ctx.stroke();
  }

  order.sort((a, b) => P[a * 3 + 2] - P[b * 3 + 2]);
  // 深度归一:远处的点淡、近处的点实,给这团点云一点空气透视
  let pfMin = Infinity, pfMax = -Infinity;
  for (const i of order) {
    if (!active.has(N[i].g)) continue;
    const pf = P[i * 3 + 2];
    if (pf < pfMin) pfMin = pf;
    if (pf > pfMax) pfMax = pf;
  }
  const pfSpan = pfMax - pfMin || 1;
  for (const i of order) {
    const n = N[i];
    if (!active.has(n.g)) continue;
    if (!reduce && n.appear > grow) continue;
    const inLin = hasSel ? lineage.nodes.has(i) : true;
    const isFocus = i === selected || i === hover;
    const dim = hasSel && !inLin ? 0.12 : 1;
    const sx = P[i * 3], sy = P[i * 3 + 1], pf = P[i * 3 + 2];
    const r = nodeR(i) * (isFocus ? 1.6 : 1);
    const rgb = RGB[i];
    const depth = (pf - pfMin) / pfSpan;
    const a = dim * (hasSel && inLin ? 1 : 0.5 + 0.5 * depth);
    if (isFocus || (hasSel && inLin)) {
      ctx.shadowColor = `rgb(${rgb})`;
      ctx.shadowBlur = isFocus ? 14 : 6;
    } else ctx.shadowBlur = 0;
    const s = sprite(rgb, r);
    ctx.globalAlpha = a;
    ctx.drawImage(s.c, sx - s.half, sy - s.half, s.half * 2, s.half * 2);
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
    if (isFocus) {
      ctx.strokeStyle = `rgba(${rgb},0.9)`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(sx, sy, r + 3, 0, 6.2832);
      ctx.stroke();
    }
  }
}

let START = performance.now();
let lastTs = START;
function frame(ts) {
  if (!reduce) grow = Math.min(1.02, ((ts - START) / 2800) * 1.02);
  const dt = Math.min(64, ts - lastTs);
  lastTs = ts;
  rotY += spin * dt;
  if (rotYTarget !== null) {
    let d = ((rotYTarget - rotY + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
    rotY += d * 0.12;
    if (tiltTarget !== null) tilt += (tiltTarget - tilt) * 0.12;
    if (zoomTarget !== null) zoom += (zoomTarget - zoom) * 0.12;
    if (Math.abs(d) < 0.008) { rotYTarget = null; tiltTarget = null; zoomTarget = null; }
  }
  draw();
  requestAnimationFrame(frame);
}

function bindInput() {
  let dragging = false, moved = false, lx = 0, ly = 0;
  wrap.addEventListener('pointerdown', (e) => {
    if (e.target.closest('#card, #legend, #ctas, #empty')) return;
    dragging = true; moved = false; lx = e.clientX; ly = e.clientY;
    wrap.classList.add('drag');
    wrap.setPointerCapture(e.pointerId);
  });
  wrap.addEventListener('pointermove', (e) => {
    if (dragging) {
      const dx = e.clientX - lx, dy = e.clientY - ly;
      if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
      rotY += dx * 0.0055;
      tilt = Math.max(-1.1, Math.min(0.15, tilt - dy * 0.003));
      lx = e.clientX; ly = e.clientY;
    } else if (!e.target.closest('#card, #legend, #ctas')) onHover(e);
  });
  wrap.addEventListener('pointerup', (e) => {
    dragging = false;
    wrap.classList.remove('drag');
    if (!moved && !e.target.closest('#card, #legend, #ctas, #empty')) onClick(e);
  });
  wrap.addEventListener('pointerleave', () => { hideTip(); hover = -1; });
  wrap.addEventListener('wheel', (e) => {
    if (e.target.closest('#card, #legend')) return;
    e.preventDefault();
    zoom = Math.max(0.5, Math.min(4, zoom * Math.exp(-e.deltaY * 0.0016)));
  }, { passive: false });

  ['pointerdown', 'pointerup', 'click', 'wheel'].forEach((ev) => {
    card.addEventListener(ev, (e) => e.stopPropagation());
    document.getElementById('legend').addEventListener(ev, (e) => e.stopPropagation());
  });
  card.querySelector('.close').addEventListener('click', clearSel);
  card.querySelector('.back').addEventListener('click', goBack);
}

function renderChips(topics) {
  chips.innerHTML = '';
  const counts = GROUPS.map(() => 0);
  topics.forEach((t) => {
    const g = GROUPS.indexOf(t.subject);
    if (g >= 0) counts[g]++;
  });
  GROUPS.forEach((s, i) => {
    const el = document.createElement('div');
    el.className = 'chip';
    el.tabIndex = 0;
    el.setAttribute('role', 'button');
    el.setAttribute('aria-pressed', 'true');
    el.innerHTML = `<span class="sw" style="background:${GCOL[i]}"></span><span class="nm">${esc(s)}</span><span class="ct mono">${counts[i]}</span>`;
    const toggle = () => {
      if (active.has(i)) { active.delete(i); el.classList.add('off'); el.setAttribute('aria-pressed', 'false'); }
      else { active.add(i); el.classList.remove('off'); el.setAttribute('aria-pressed', 'true'); }
    };
    el.addEventListener('click', toggle);
    el.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); toggle(); }
    });
    chips.appendChild(el);
  });
}

async function loadStage(next) {
  stage = next;
  document.querySelectorAll('#ctas .btn').forEach((b) => b.classList.toggle('is-on', b.dataset.stage === stage));
  clearSel();
  const data = await api('/api/graph?stage=' + encodeURIComponent(stage));
  document.getElementById('nCount').textContent = data.nodes.length;
  document.getElementById('eCount').textContent = data.links.length;
  renderChips(data.nodes);
  if (!data.nodes.length) {
    N = []; E = [];
    emptyEl.hidden = false;
    return;
  }
  emptyEl.hidden = true;
  const world = buildWorld(data.nodes, data.links);
  N = world.N;
  E = world.E;
  N.forEach((n) => { n.py = n.y - H / 2; n.appear = n.y / H; });
  incident = Array.from({ length: N.length }, () => []);
  directPre = Array.from({ length: N.length }, () => []);
  directNext = Array.from({ length: N.length }, () => []);
  E.forEach((e, i) => {
    incident[e[0]].push(i);
    incident[e[1]].push(i);
    directPre[e[0]].push(e[1]);
    directNext[e[1]].push(e[0]);
  });
  RGB = N.map((n) => {
    const x = parseInt(n.col.slice(1), 16);
    return `${x >> 16},${(x >> 8) & 255},${x & 255}`;
  });
  P = new Float32Array(N.length * 3);
  order.length = 0;
  for (let i = 0; i < N.length; i++) order.push(i);
  grow = reduce ? 1 : 0;
  lastTs = performance.now();
  START = lastTs;
}

document.querySelectorAll('#ctas .btn').forEach((b) => {
  b.addEventListener('click', () => loadStage(b.dataset.stage));
});

bindInput();
window.addEventListener('resize', resize);
resize();
requestAnimationFrame(frame);
loadStage('junior').catch((err) => {
  document.querySelector('#head .kicker').textContent = '载入失败：' + err.message;
});
