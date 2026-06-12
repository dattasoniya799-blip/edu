import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AiFeature } from '@qiming/contracts';
import type { Chunk, LlmProvider, Msg } from '../types';

/** 路由表里写该 model 值时,实际模型名取 env LLM_MODEL(机构只换 env 即可切真实模型) */
export const ENV_MODEL = 'env';

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

/**
 * 真实供应商适配器(OpenAI 兼容 chat/completions 形状,不写死厂商):
 * - 一切参数来自 env:LLM_API_KEY / LLM_BASE_URL / LLM_MODEL(C3 接 key 时只填 env);
 * - 原生 fetch 实现,不引第三方 LLM SDK(全仓库 grep 不到供应商 SDK,验收项);
 * - buildRequest() 为纯函数,单测只验请求构造 —— 当前无真实 key,不做真实网络调用;
 * - 流式:解析 SSE data: 行;usage 优先取响应 usage 字段(stream_options.include_usage),
 *   缺失时按字符数估算(记账兜底,真实计费以供应商账单核对)。
 */
@Injectable()
export class OpenAiCompatibleProvider implements LlmProvider {
  readonly name = 'openai_compatible';

  constructor(private readonly cfg: ConfigService) {}

  private apiKey(): string {
    return this.cfg.get<string>('LLM_API_KEY', '');
  }

  healthy(): boolean {
    return !!this.apiKey();
  }

  buildRequest(req: { model: string; messages: Msg[]; stream: boolean }): BuiltRequest {
    const base = this.cfg.get<string>('LLM_BASE_URL', 'https://api.openai.com/v1').replace(/\/+$/, '');
    const model = req.model === ENV_MODEL ? this.cfg.get<string>('LLM_MODEL', '') : req.model;
    if (!model) throw new Error('未配置模型:路由表 model 为 env 时必须设置 LLM_MODEL');
    return {
      url: `${base}/chat/completions`,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.apiKey()}`,
      },
      body: {
        model,
        messages: req.messages,
        stream: req.stream,
        ...(req.stream ? { stream_options: { include_usage: true } } : {}),
      },
    };
  }

  async *chat(req: { model: string; messages: Msg[]; feature: AiFeature }): AsyncIterable<Chunk> {
    if (!this.apiKey()) throw new Error('LLM_API_KEY 未配置,openai_compatible 供应商不可用');
    const built = this.buildRequest({ model: req.model, messages: req.messages, stream: true });
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
}
