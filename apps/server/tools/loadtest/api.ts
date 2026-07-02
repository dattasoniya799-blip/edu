/**
 * D4 压测 · 轻量 API 客户端(Node 自带 fetch,零外部依赖)
 * 统一响应包约定:{code:0, message, data};非 2xx / code!==0 / 网络异常计为错误。
 */
import { Recorder } from './metrics';

export interface CallResult<T = unknown> {
  ok: boolean;
  status: number;
  code: number | null;
  data: T;
  message?: string;
}

export class ApiClient {
  token: string | null = null;

  constructor(
    private readonly baseUrl: string,
    private readonly recorder: Recorder,
    /** label 前缀(如 'setup:'),用于把准备阶段与压测阶段分开统计 */
    private readonly labelPrefix = '',
  ) {}

  /**
   * 发起请求并记录延迟。label 缺省为 `METHOD path`(path 中的数字段折叠为 :id,
   * 避免每个 attemptId 各成一行)。任何失败都不抛错,由调用方检查 ok。
   */
  async call<T = any>(
    method: string,
    path: string,
    body?: unknown,
    label?: string,
  ): Promise<CallResult<T>> {
    const lb =
      this.labelPrefix + (label ?? `${method} ${path.split('?')[0].replace(/\/\d+/g, '/:id')}`);
    const started = performance.now();
    try {
      const res = await fetch(this.baseUrl + path, {
        method,
        headers: {
          'content-type': 'application/json',
          ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const ms = performance.now() - started;
      let json: any = null;
      try {
        json = await res.json();
      } catch {
        /* 非 JSON 响应(如 502 页面) */
      }
      const ok = res.ok && json?.code === 0;
      this.recorder.record(lb, ms, ok);
      return { ok, status: res.status, code: json?.code ?? null, data: json?.data as T, message: json?.message };
    } catch (e) {
      this.recorder.record(lb, performance.now() - started, false);
      return { ok: false, status: 0, code: null, data: undefined as T, message: (e as Error).message };
    }
  }

  /** 期望成功,失败直接抛错(仅准备阶段使用;压测阶段一律用 call) */
  async must<T = any>(method: string, path: string, body?: unknown, label?: string): Promise<T> {
    const r = await this.call<T>(method, path, body, label);
    if (!r.ok) {
      throw new Error(`${method} ${path} 失败:HTTP ${r.status} code=${r.code} ${r.message ?? ''}`);
    }
    return r.data;
  }
}
