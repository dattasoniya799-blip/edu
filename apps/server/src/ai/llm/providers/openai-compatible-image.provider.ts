import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AiFeature, AiTestResultDto } from '@qiming/contracts';
import type { ImageProvider, ImageResult } from '../types';

/** 生图供应商标识(路由表 courseware=real 时的 provider 名) */
export const IMAGE_PROVIDER_NAME = 'openai_compatible_image';

/** 单页出图超时:GPT Image 一张整页幻灯片实测数十秒,留 120s */
export const IMAGE_TIMEOUT_MS = 120_000;
/** 探活超时(只发 GET /models,不出图 → 不烧钱、不占 120s) */
const PROBE_TIMEOUT_MS = 10_000;

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_MODEL = 'gpt-image-2';
const DEFAULT_SIZE = '1536x1024';
const DEFAULT_QUALITY = 'medium';

interface ImagesResponse {
  data?: { b64_json?: string }[];
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    prompt_tokens?: number;
    completion_tokens?: number;
  };
  size?: string;
  quality?: string;
}

/**
 * 真实生图适配器(OpenAI 兼容 images/generations 形状,不写死厂商):
 * - env 配置:IMAGE_BASE_URL / IMAGE_API_KEY / IMAGE_MODEL / IMAGE_SIZE / IMAGE_QUALITY;
 *   key **只在本类内部读取**,任何出参/日志都不含 key(宪法 §7);
 * - 原生 fetch + AbortController(不引第三方 SDK,与 OpenAiCompatibleProvider 同口径);
 * - 返回 data[0].b64_json 为整页 PNG;usage/size/quality 取**响应顶层实际值** ——
 *   中转网关会归一参数(实测请求 1536x1024/medium 可能回 1264x848/low),
 *   故记账与页面元数据一律以上游实际值为准,不回填请求值;
 * - 上游 HTTP 错误的响应体最多截 120 字符(仿 testConnection 先例),避免把上游报文全量入日志。
 */
@Injectable()
export class OpenAiCompatibleImageProvider implements ImageProvider {
  readonly name = IMAGE_PROVIDER_NAME;

  constructor(private readonly cfg: ConfigService) {}

  private apiKey(): string {
    return (this.cfg.get<string>('IMAGE_API_KEY', '') ?? '').trim();
  }

  healthy(): boolean {
    return !!this.apiKey();
  }

  async generate(req: { prompt: string; feature: AiFeature }): Promise<ImageResult> {
    const apiKey = this.apiKey();
    if (!apiKey) throw new Error('IMAGE_API_KEY 未配置,openai_compatible_image 供应商不可用');
    const base = (this.cfg.get<string>('IMAGE_BASE_URL', DEFAULT_BASE_URL) || DEFAULT_BASE_URL).replace(/\/+$/, '');
    const model = this.cfg.get<string>('IMAGE_MODEL', DEFAULT_MODEL) || DEFAULT_MODEL;
    const size = this.cfg.get<string>('IMAGE_SIZE', DEFAULT_SIZE) || DEFAULT_SIZE;
    const quality = this.cfg.get<string>('IMAGE_QUALITY', DEFAULT_QUALITY) || DEFAULT_QUALITY;

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), IMAGE_TIMEOUT_MS);
    try {
      const res = await fetch(`${base}/images/generations`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, prompt: req.prompt, size, quality, n: 1 }),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`生图上游 HTTP ${res.status}${text ? `:${text.slice(0, 120)}` : ''}`);
      }
      const body = (await res.json().catch(() => null)) as ImagesResponse | null;
      const b64 = body?.data?.[0]?.b64_json;
      if (!b64) throw new Error('生图上游未返回 data[0].b64_json');
      const usage = body?.usage;
      return {
        imageB64: b64,
        ...(usage
          ? {
              usage: {
                tokensIn: usage.input_tokens ?? usage.prompt_tokens ?? 0,
                tokensOut: usage.output_tokens ?? usage.completion_tokens ?? 0,
              },
            }
          : {}),
        ...(body?.size ? { actualSize: body.size } : {}),
        ...(body?.quality ? { actualQuality: body.quality } : {}),
      };
    } catch (e) {
      const err = e as Error;
      if (err.name === 'AbortError') throw new Error(`生图上游超时(${IMAGE_TIMEOUT_MS / 1000}s)`);
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * 最小探活([2026-08-22 audit-fix-server · P1-11],POST /admin/ai/test?feature=courseware)。
   * 此前该端点恒测**文本**供应商:管理员把「课件生成」切真实后点「测试连接」看到正常,
   * 实际验的是 LLM_API_KEY,生图 key 没配也毫无信号。
   *
   * 只 GET {IMAGE_BASE_URL}/models —— 不发 images/generations(一次真实出图数十秒且按张计费,
   * 不该由一次连通性检查产生账单)。与文本 testConnection 同口径:永不抛错,一律返回
   * 结构化 {ok,error};上游报文截 120 字符,key 不进出参也不进日志。
   */
  async testConnection(): Promise<AiTestResultDto> {
    const started = Date.now();
    const apiKey = this.apiKey();
    if (!apiKey) {
      return { ok: false, latencyMs: 0, sample: null, error: '未配置生图 API Key(IMAGE_API_KEY),无法测试连接' };
    }
    const base = (this.cfg.get<string>('IMAGE_BASE_URL', DEFAULT_BASE_URL) || DEFAULT_BASE_URL).replace(/\/+$/, '');
    const model = this.cfg.get<string>('IMAGE_MODEL', DEFAULT_MODEL) || DEFAULT_MODEL;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
    try {
      const res = await fetch(`${base}/models`, {
        headers: { authorization: `Bearer ${apiKey}` },
        signal: ctrl.signal,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        return {
          ok: false,
          latencyMs: Date.now() - started,
          sample: null,
          error: `生图上游 HTTP ${res.status}${text ? `:${text.slice(0, 120)}` : ''}`,
        };
      }
      return { ok: true, latencyMs: Date.now() - started, sample: `生图供应商可达,model=${model}`, error: null };
    } catch (e) {
      const err = e as Error;
      const msg = err.name === 'AbortError' ? `连接超时(${PROBE_TIMEOUT_MS / 1000}s)` : err.message || '连接失败';
      return { ok: false, latencyMs: Date.now() - started, sample: null, error: msg };
    } finally {
      clearTimeout(timer);
    }
  }
}
