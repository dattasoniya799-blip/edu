/** REST + SSE 客户端,端点见 shared/protocol.md。server 不在时抛出可读错误。 */
import type { LessonStage, LessonState, ServerEvent, Subject } from '../types';

const OFFLINE_HINT = '连不上讲题服务(http://localhost:4310)。先在 labs/lecture-board 下 `npm run dev:server`,或直接看 /sample 离线样例。';

export async function createLesson(input: {
  images: File[];
  answer: string;
  problemText?: string;
}): Promise<{ id: string }> {
  const form = new FormData();
  for (const f of input.images) form.append('images[]', f, f.name);
  form.append('answer', input.answer);
  if (input.problemText) form.append('problemText', input.problemText);

  let res: Response;
  try {
    res = await fetch('/api/lessons', { method: 'POST', body: form });
  } catch {
    throw new Error(OFFLINE_HINT);
  }
  if (!res.ok) {
    // server 没起时 Vite 代理回的是 500,不是网络错误 —— 探一下 /api/health 才分得清
    // 「服务端不在」和「服务端报错」。
    if (res.status >= 500 && !(await checkHealth())) throw new Error(OFFLINE_HINT);
    const body = await res.text().catch(() => '');
    throw new Error(`上传失败(HTTP ${res.status})${body ? `:${body.slice(0, 300)}` : ''}`);
  }
  const json = (await res.json()) as { id?: string };
  if (!json.id) throw new Error('服务端没有返回 lessonId,协议要求 POST /api/lessons → { id }');
  return { id: json.id };
}

export async function fetchLesson(id: string): Promise<LessonState> {
  let res: Response;
  try {
    res = await fetch(`/api/lessons/${encodeURIComponent(id)}`);
  } catch {
    throw new Error(OFFLINE_HINT);
  }
  if (!res.ok) throw new Error(`读取讲题任务失败(HTTP ${res.status})`);
  return (await res.json()) as LessonState;
}

/** server 活着吗(Vite 代理会把「上游没起」翻译成 500,所以要单独探一次)。 */
export async function checkHealth(): Promise<boolean> {
  try {
    const res = await fetch('/api/health');
    return res.ok;
  } catch {
    return false;
  }
}

export interface HealthDetail {
  ok: boolean;
  bailian: boolean;
  seedream: boolean;
}

/** 首页顶栏服务状态小点用:细分到百炼(识题/出剧本)与生图两把 key 是否读到。 */
export async function fetchHealthDetail(): Promise<HealthDetail> {
  try {
    const res = await fetch('/api/health');
    if (!res.ok) return { ok: false, bailian: false, seedream: false };
    const json = (await res.json()) as Partial<HealthDetail>;
    return { ok: json.ok ?? false, bailian: json.bailian ?? false, seedream: json.seedream ?? false };
  } catch {
    return { ok: false, bailian: false, seedream: false };
  }
}

export interface SampleSummary {
  dir: string;
  title: string;
  subject: Subject;
  imageUrl: string;
  answerPreview: string;
}

/** 首页「示例题目 · 一键试讲」的 7 道题(GET /api/samples,见 server/src/samples.ts)。 */
export async function fetchSamples(): Promise<SampleSummary[]> {
  const res = await fetch('/api/samples');
  if (!res.ok) throw new Error(`读取示例题失败(HTTP ${res.status})`);
  return (await res.json()) as SampleSummary[];
}

/** 「试讲这道」:某个示例题文件夹走跟上传完全一样的流水线 → { id }。 */
export async function createLessonFromSample(dir: string): Promise<{ id: string }> {
  let res: Response;
  try {
    res = await fetch(`/api/lessons/from-sample/${encodeURIComponent(dir)}`, { method: 'POST' });
  } catch {
    throw new Error(OFFLINE_HINT);
  }
  if (!res.ok) {
    if (res.status >= 500 && !(await checkHealth())) throw new Error(OFFLINE_HINT);
    const body = await res.text().catch(() => '');
    throw new Error(`试讲失败(HTTP ${res.status})${body ? `:${body.slice(0, 300)}` : ''}`);
  }
  const json = (await res.json()) as { id?: string };
  if (!json.id) throw new Error('服务端没有返回 lessonId');
  return { id: json.id };
}

export interface LessonListItem {
  id: string;
  createdAt: string;
  stage: LessonStage;
  title?: string;
  subject?: Subject;
  thumb?: string;
  summary?: string;
}

/** 首页课程库(GET /api/lessons,按 createdAt 倒序;字段见 server/src/store.ts 的 LessonListItem)。 */
export async function fetchLessons(): Promise<LessonListItem[]> {
  const res = await fetch('/api/lessons');
  if (!res.ok) throw new Error(`读取课程库失败(HTTP ${res.status})`);
  return (await res.json()) as LessonListItem[];
}

export interface EventStream {
  close(): void;
}

/**
 * lesson 到终态之后就不会再有事件了(complete = 全部素材落定;stage=failed 的课流水线抛错时只发
 * error,从来不会再发 complete —— 见 pipeline.ts 的 catch 分支),繼续攥着这条 SSE 连接没有意义。
 * 之前的写法只在组件卸载(离开这个 lesson 页)时才关连接:用户看完一节课站在结果页不走,
 * 或者重连到一节早就失败的课(snapshot 里 stage 已经是 failed),连接会一直开着 ——
 * server 那边的 15s 心跳定时器和 listeners 订阅也跟着永远不释放(运行问题复查 2026-09-17)。
 */
function isTerminalEvent(e: ServerEvent): boolean {
  if (e.type === 'complete' || e.type === 'error') return true;
  if (e.type === 'snapshot' && (e.state.stage === 'ready' || e.state.stage === 'failed')) return true;
  return false;
}

/** 连 SSE;断线按 1s→8s 退避自动重连,重连时服务端会补发 snapshot;到终态后自动断开释放连接。 */
export function connectEvents(
  id: string,
  handlers: { onEvent(e: ServerEvent): void; onStatus?(s: 'open' | 'reconnecting'): void },
): EventStream {
  let closed = false;
  let source: EventSource | null = null;
  let delay = 1000;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const shutdown = () => {
    closed = true;
    if (timer) clearTimeout(timer);
    source?.close();
    source = null;
  };

  const open = () => {
    if (closed) return;
    source = new EventSource(`/api/lessons/${encodeURIComponent(id)}/events`);
    source.onopen = () => {
      delay = 1000;
      handlers.onStatus?.('open');
    };
    source.onmessage = (ev) => {
      let event: ServerEvent;
      try {
        event = JSON.parse(ev.data) as ServerEvent;
      } catch {
        return; /* 半条 JSON,丢弃 */
      }
      handlers.onEvent(event);
      if (isTerminalEvent(event)) shutdown();
    };
    source.onerror = () => {
      source?.close();
      source = null;
      if (closed) return;
      handlers.onStatus?.('reconnecting');
      timer = setTimeout(open, delay);
      delay = Math.min(8000, delay * 2);
    };
  };
  open();

  return {
    close: shutdown,
  };
}

export const SERVER_OFFLINE_HINT = OFFLINE_HINT;
