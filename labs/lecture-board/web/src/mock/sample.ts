/**
 * /sample 的离线夹具:直接吃 shared/sample-buoyancy.json,把素材 URL 换成本地占位。
 *
 * `?anim=html` / `?anim=static` 把那张动画卡换成另外两条路的夹具 —— 样例剧本只有 template 动画,
 * 但动画桥有三条路(protocol.md),得能各自走一遍。只在 mock 模式下生效。
 */
import sampleRaw from '../../../shared/sample-buoyancy.json';
import type { BoardScript } from '../types';

/** 自包含 HTML 动画夹具:按协议暴露 window.lecture 并在 load 时 postMessage ready。 */
const HTML_FIXTURE = `<!doctype html><html><head><meta charset="utf-8"><style>
 body{margin:0;font:14px/1.5 system-ui;background:#fcfcfc;color:#1f2328}
 #log{padding:6px 10px;color:#2563eb}
 .box{transition:all .5s}
</style></head><body>
<svg viewBox="0 0 400 180" width="100%" height="150">
  <rect id="tank" class="box" x="20" y="20" width="360" height="140" fill="#bfdbfe" opacity="0"/>
  <rect id="model" class="box" x="170" y="120" width="60" height="30" rx="8" fill="#334155" opacity="0"/>
</svg>
<div id="log">等待动作…</div>
<script>
 var n = 0;
 function show(id){ var el = document.getElementById(id); if (el) el.setAttribute('opacity', '1'); }
 window.lecture = {
   do: function (name, params) {
     n++;
     if (name === 'tank' || name === 'model') show(name);
     if (name === 'rise') document.getElementById('model').setAttribute('y', '40');
     document.getElementById('log').textContent = 'do:' + name + ' #' + n + (params ? ' ' + JSON.stringify(params) : '');
   },
   unlock: function (params) { document.getElementById('log').textContent = 'unlock:' + (params || []).join(','); },
   reset: function () { n = 0; document.getElementById('log').textContent = 'reset'; }
 };
 window.addEventListener('message', function (e) {
   var d = e.data || {};
   if (d.type === 'lecture:do') window.lecture.do(d.name, d.params);
   else if (d.type === 'lecture:unlock') window.lecture.unlock(d.params);
   else if (d.type === 'lecture:reset') window.lecture.reset();
 });
 parent.postMessage({ type: 'lecture:ready' }, '*');
</script></body></html>`;

const SVG_FIXTURE = `<svg viewBox="0 0 400 180" width="100%" xmlns="http://www.w3.org/2000/svg">
  <rect x="20" y="20" width="360" height="140" fill="#bfdbfe"/>
  <rect x="170" y="120" width="60" height="30" rx="8" fill="#334155"/>
  <text x="200" y="100" text-anchor="middle" font-size="13" fill="#6b7280">静态降级图(不可交互)</text>
</svg>`;

/** html 动画只接受 {type:'do', name, params},把模板动作翻译过去。 */
function toDoAction(action: Record<string, unknown>): Record<string, unknown> {
  const name = String(action.target ?? action.phase ?? action.param ?? action.type);
  return { type: 'do', name, params: { from: action.type } };
}

export function prepareSample(animKind?: string | null): BoardScript {
  const script = structuredClone(sampleRaw) as unknown as BoardScript;
  script.problem = { ...script.problem, images: script.problem.images.map(() => '/sample-problem.jpg') };

  if (animKind === 'html' || animKind === 'static') {
    script.animations = script.animations.map((a) =>
      a.id === 'a_buoy'
        ? animKind === 'html'
          ? { ...a, kind: 'html' as const, template: undefined, params: undefined, html: HTML_FIXTURE }
          : { ...a, kind: 'static' as const, template: undefined, params: undefined, svg: SVG_FIXTURE }
        : a,
    );
    if (animKind === 'html') {
      script.steps = script.steps.map((s) => ({
        ...s,
        flow: s.flow.map((it) => ('do' in it && it.do === 'anim' ? { ...it, action: toDoAction(it.action) } : it)),
      }));
    }
  }
  return script;
}
