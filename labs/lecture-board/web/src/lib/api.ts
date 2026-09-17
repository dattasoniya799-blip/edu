/** REST + SSE 客户端,端点见 shared/protocol.md。server 不在时抛出可读错误。 */
import type { LessonState, ServerEvent } from '../types';

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

export interface EventStream {
  close(): void;
}

/** 连 SSE;断线按 1s→8s 退避自动重连,重连时服务端会补发 snapshot。 */
export function connectEvents(
  id: string,
  handlers: { onEvent(e: ServerEvent): void; onStatus?(s: 'open' | 'reconnecting'): void },
): EventStream {
  let closed = false;
  let source: EventSource | null = null;
  let delay = 1000;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const open = () => {
    if (closed) return;
    source = new EventSource(`/api/lessons/${encodeURIComponent(id)}/events`);
    source.onopen = () => {
      delay = 1000;
      handlers.onStatus?.('open');
    };
    source.onmessage = (ev) => {
      try {
        handlers.onEvent(JSON.parse(ev.data) as ServerEvent);
      } catch {
        /* 半条 JSON,丢弃 */
      }
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
    close() {
      closed = true;
      if (timer) clearTimeout(timer);
      source?.close();
    },
  };
}

export const SERVER_OFFLINE_HINT = OFFLINE_HINT;
