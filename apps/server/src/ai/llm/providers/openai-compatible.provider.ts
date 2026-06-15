import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type Redis from 'ioredis';
import type { AiFeature } from '@qiming/contracts';
import { REDIS } from '../../../redis/redis.module';
import type { AiTestResultDto } from '@qiming/contracts';
import type { Chunk, LlmProvider, Msg } from '../types';

/** 路由表里写该 model 值时,实际模型名取运行态/env 配置(机构只换配置即可切真实模型) */
export const ENV_MODEL = 'env';

/** 运行态供应商配置 Redis 键(a7: 前缀纪律;全局一把,不带 org 前缀) */
export const PROVIDER_CONFIG_KEY = 'a7:ai:provider';

/** 默认全局并发上限(运行态未配置 concurrency 时) */
export const DEFAULT_CONCURRENCY = 8;

export interface BuiltRequest {
  url: string;
  headers: Record<string, string>;
  body: {
    model: string;
    messages: Msg[];
    stream: boolean;
    stream_options?: { include_usage: boolean };
  };
}

/** 解析出的有效供应商配置(运行态 Redis 优先,缺失/损坏回落 env) */
export interface ResolvedProviderConfig {
  baseUrl: string;
  model: string;
  apiKey: string;
  concurrency: number;
  source: 'runtime' | 'env';
}

/**
 * 真实供应商适配器(OpenAI 兼容 chat/completions 形状,不写死厂商):
 * - 运行态配置(a7:ai:provider:baseUrl/model/apiKey/concurrency)优先,env 兜底
 *   (LLM_BASE_URL / LLM_MODEL / LLM_API_KEY);机构无需重启即可换 base/model/key;
 * - 原生 fetch 实现,不引第三方 LLM SDK(全仓库 grep 不到供应商 SDK,验收项);
 * - buildRequest() 保持纯函数(env 口径),仅供单测验请求构造;chat()/testConnection()
 *   走运行态解析后的 buildRequestWith();
 * - 流式:解析 SSE data: 行;usage 优先取响应 usage 字段(stream_options.include_usage),
 *   缺失时按字符数估算(记账兜底,真实计费以供应商账单核对)。
 */
@Injectable()
export class OpenAiCompatibleProvider implements LlmProvider {
  readonly name = 'openai_compatible';

  constructor(
    private readonly cfg: ConfigService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  private envKey(): string {
    return this.cfg.get<string>('LLM_API_KEY', '');
  }

  private envBaseUrl(): string {
    return this.cfg.get<string>('LLM_BASE_URL', 'https://api.openai.com/v1');
  }

  private envModel(): string {
    return this.cfg.get<string>('LLM_MODEL', '');
  }

  /** healthy:/ai/health 探活,保持 env 口径(同步、不发网络;非热点路径不强求运行态) */
  healthy(): boolean {
    return !!this.envKey();
  }

  /**
   * 当前生效配置:Redis a7:ai:provider 优先(任一字段缺失逐项回落 env),
   * 解析失败整体回落 env。apiKey 用 ?? 以允许运行态显式空串覆盖罕见,但通常运行态写入即带 key。
   */
  async resolveConfig(): Promise<ResolvedProviderConfig> {
    const raw = await this.redis.get(PROVIDER_CONFIG_KEY).catch(() => null);
    if (raw) {
      try {
        const j = JSON.parse(raw) as Partial<ResolvedProviderConfig>;
        const concurrency = Number(j.concurrency);
        return {
          baseUrl: j.baseUrl || this.envBaseUrl(),
          model: j.model || this.envModel(),
          apiKey: typeof j.apiKey === 'string' ? j.apiKey : this.envKey(),
          concurrency: concurrency > 0 ? Math.floor(concurrency) : DEFAULT_CONCURRENCY,
          source: 'runtime',
        };
      } catch {
        // 损坏内容 → 安全回落 env
      }
    }
    return {
      baseUrl: this.envBaseUrl(),
      model: this.envModel(),
      apiKey: this.envKey(),
      concurrency: DEFAULT_CONCURRENCY,
      source: 'env',
    };
  }

  /** 以指定有效配置构造请求(运行态/env 通用) */
  buildRequestWith(
    req: { model: string; messages: Msg[]; stream: boolean },
    conf: { baseUrl: string; model: string; apiKey: string },
  ): BuiltRequest {
    const base = (conf.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
    const model = req.model === ENV_MODEL ? conf.model : req.model;
    if (!model) throw new Error('未配置模型:路由表 model 为 env 时必须设置运行态/env 模型');
    return {
      url: `${base}/chat/completions`,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${conf.apiKey}`,
      },
      body: {
        model,
        messages: req.messages,
        stream: req.stream,
        ...(req.stream ? { stream_options: { include_usage: true } } : {}),
      },
    };
  }

  /** 纯函数:env 口径请求构造(单测用,不读运行态/不发网络) */
  buildRequest(req: { model: string; messages: Msg[]; stream: boolean }): BuiltRequest {
    return this.buildRequestWith(req, {
      baseUrl: this.envBaseUrl(),
      model: this.envModel(),
      apiKey: this.envKey(),
    });
  }

  async *chat(req: { model: string; messages: Msg[]; feature: AiFeature }): AsyncIterable<Chunk> {
    const conf = await this.resolveConfig();
    if (!conf.apiKey) throw new Error('LLM API Key 未配置,openai_compatible 供应商不可用');
    const built = this.buildRequestWith({ model: req.model, messages: req.messages, stream: true }, conf);
    const res = await fetch(built.url, {
      method: 'POST',
      headers: built.headers,
      body: JSON.stringify(built.body),
    });
    if (!res.ok || !res.body) {
      throw new Error(`LLM 上游响应异常:HTTP ${res.status}`);
    }
    const estIn = req.messages.reduce((s, m) => s + m.content.length, 0);
    let outChars = 0;
    let usage: Chunk['usage'] | undefined;
    const reader = (res.body as ReadableStream<Uint8Array>).getReader();
    const decoder = new TextDecoder();
    let buf = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        const data = line.startsWith('data:') ? line.slice(5).trim() : '';
        if (!data || data === '[DONE]') continue;
        let payload: {
          choices?: { delta?: { content?: string } }[];
          usage?: { prompt_tokens?: number; completion_tokens?: number };
        };
        try {
          payload = JSON.parse(data);
        } catch {
          continue;
        }
        if (payload.usage) {
          usage = {
            tokensIn: payload.usage.prompt_tokens ?? estIn,
            tokensOut: payload.usage.completion_tokens ?? outChars,
          };
        }
        const delta = payload.choices?.[0]?.delta?.content;
        if (delta) {
          outChars += delta.length;
          yield { delta };
        }
      }
    }
    yield { delta: '', usage: usage ?? { tokensIn: estIn, tokensOut: outChars } };
  }

  /**
   * 连通性测试(POST /admin/ai/test):用运行态/env 配置打一发极小非流式 prompt,计时。
   * 绕开路由表/额度(这是连通性检查);未配 key/网络错/HTTP 错都返回结构化 {ok:false,error},
   * 绝不抛错(controller 不应因此 500)。
   */
  async testConnection(prompt = '只回:ok'): Promise<AiTestResultDto> {
    const started = Date.now();
    const conf = await this.resolveConfig();
    if (!conf.apiKey) {
      return { ok: false, latencyMs: 0, sample: null, error: '未配置 API Key,无法测试连接' };
    }
    let built: BuiltRequest;
    try {
      built = this.buildRequestWith(
        { model: ENV_MODEL, messages: [{ role: 'user', content: prompt }], stream: false },
        conf,
      );
    } catch (e) {
      return { ok: false, latencyMs: Date.now() - started, sample: null, error: (e as Error).message };
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    try {
      const res = await fetch(built.url, {
        method: 'POST',
        headers: built.headers,
        body: JSON.stringify({ ...built.body, max_tokens: 16 }),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        return {
          ok: false,
          latencyMs: Date.now() - started,
          sample: null,
          error: `上游 HTTP ${res.status}${text ? `:${text.slice(0, 120)}` : ''}`,
        };
      }
      const data = (await res.json().catch(() => null)) as
        | { choices?: { message?: { content?: string } }[] }
        | null;
      const content = data?.choices?.[0]?.message?.content ?? '';
      return {
        ok: true,
        latencyMs: Date.now() - started,
        sample: String(content).slice(0, 50),
        error: null,
      };
    } catch (e) {
      const err = e as Error;
      const msg = err.name === 'AbortError' ? '连接超时(15s)' : err.message || '连接失败';
      return { ok: false, latencyMs: Date.now() - started, sample: null, error: msg };
    } finally {
      clearTimeout(timer);
    }
  }
}
