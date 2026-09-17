/**
 * 模板动画运行时(同源直挂,不走 iframe)。
 * runtime/scene-base.js 与 templates/*.js 是 IIFE 脚本,挂 window.LectureScene;
 * 原样复制到 public/lecture-scene/ 后用 <script> 注入,拿 LectureScene.templates[id].mount()。
 * 见 shared/protocol.md「动画桥 · template 动画」。
 */

export interface LectureSceneHandle {
  svg: SVGSVGElement;
  getParams(): Record<string, number>;
  setParams(p: Record<string, unknown>): void;
  setUnlocked(ids: string[]): void;
  applyAction(action: Record<string, unknown>, ctx?: unknown): Promise<void> | void;
  beginStep?(step: unknown, index: number): void;
  getAnchor?(id: string): { x: number; y: number; r?: number } | null;
  destroy?(): void;
}

export interface LectureTemplate {
  id: string;
  name: string;
  actions?: string[];
  targets?: string[];
  defaults(): Record<string, number>;
  mount(container: HTMLElement, params: Record<string, unknown>, ctx?: unknown): LectureSceneHandle;
}

interface LectureSceneNamespace {
  templates: Record<string, LectureTemplate>;
  Clock: { pause(): void; resume(): void; isPaused(): boolean };
  cancelAllTweens(): void;
}

declare global {
  interface Window {
    LectureScene?: LectureSceneNamespace;
  }
}

export const TEMPLATE_IDS = [
  'buoyancy',
  'circle-angle',
  'parallelogram-angle',
  'quadratic-line',
  'linear-shift',
  'cart-collision',
  'board-steps',
] as const;

const BASE = '/lecture-scene';

function injectScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[data-ls="${src}"]`);
    if (existing) {
      if (existing.dataset.loaded === '1') resolve();
      else existing.addEventListener('load', () => resolve(), { once: true });
      return;
    }
    const el = document.createElement('script');
    el.src = src;
    el.async = false;
    el.dataset.ls = src;
    el.addEventListener('load', () => {
      el.dataset.loaded = '1';
      resolve();
    });
    el.addEventListener('error', () => reject(new Error(`动画运行时加载失败:${src}`)));
    document.head.appendChild(el);
  });
}

let pending: Promise<LectureSceneNamespace> | null = null;

export function loadLectureScene(): Promise<LectureSceneNamespace> {
  if (window.LectureScene?.templates?.buoyancy) return Promise.resolve(window.LectureScene);
  if (pending) return pending;
  pending = (async () => {
    await injectScript(`${BASE}/runtime/scene-base.js`);
    for (const id of TEMPLATE_IDS) await injectScript(`${BASE}/templates/${id}.js`);
    const ns = window.LectureScene;
    if (!ns) throw new Error('LectureScene 未挂载');
    return ns;
  })();
  return pending;
}

interface ManifestEntry {
  id: string;
  targets?: Record<string, string>;
  actions?: Record<string, string>;
}

let manifestPending: Promise<ManifestEntry[]> | null = null;

function manifest(): Promise<ManifestEntry[]> {
  manifestPending ??= fetch(`${BASE}/templates/manifest.json`)
    .then((r) => r.json() as Promise<{ templates?: ManifestEntry[] }>)
    .then((j) => j.templates ?? [])
    .catch(() => []);
  return manifestPending;
}

/**
 * 模板的「底图」层 = manifest 里 draw 动作枚举的那几个
 * (circle-angle:circle / triangle / radiusOA / radiusOB / segBE)。
 * manifest 没写 draw(如 buoyancy)就返回空数组 —— 表示「分不出哪些是底图」,
 * 调用方只在剧本完全没管显隐时才整套放出来。
 */
export async function baseTargetsFor(templateId: string): Promise<string[]> {
  const entry = (await manifest()).find((t) => t.id === templateId);
  const draw = entry?.actions?.draw;
  if (!entry || !draw) return [];
  const named = new Set([...draw.matchAll(/'([^']+)'/g)].map((m) => m[1]));
  return Object.keys(entry.targets ?? {}).filter((t) => named.has(t));
}

/** 时钟暂停对所有模板动画一致生效(scene-base.js 的 Clock)。 */
export function setSceneClockPaused(paused: boolean): void {
  const clock = window.LectureScene?.Clock;
  if (!clock) return;
  if (paused) clock.pause();
  else clock.resume();
}
