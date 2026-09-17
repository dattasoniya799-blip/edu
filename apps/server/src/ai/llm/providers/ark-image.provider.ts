import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AiFeature, AiTestResultDto } from '@qiming/contracts';
import type { ImageProvider, ImageResult } from '../types';

/** 火山方舟生图供应商标识(IMAGE_PROVIDER=ark_image 时 courseware=real 的 provider 名) */
export const ARK_IMAGE_PROVIDER_NAME = 'ark_image';
/** IMAGE_MODEL 未配置时的方舟生图模型(亦是 pricing 表键) */
export const ARK_DEFAULT_IMAGE_MODEL = 'doubao-seedream-5-0-260128';

/** 单页出图超时:Seedream 5.0 一张 2K 图实测约 20s,与 gpt-image 同留 120s */
const IMAGE_TIMEOUT_MS = 120_000;
/** 探活超时(只发 GET /models,不出图) */
const PROBE_TIMEOUT_MS = 10_000;

const DEFAULT_BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3';
/**
 * Seedream 5.0 要求 size ≥ 3,686,400 像素(实测 1536x1024 被 400 拒绝),
 * 档位写 "2K" 由模型按提示词自选长宽(实测课件封面回 2848x1600)。也可写显式 "宽x高"。
 */
const DEFAULT_SIZE = '2K';

interface ArkImagesResponse {
  data?: { b64_json?: string; url?: string; size?: string }[];
  usage?: { generated_images?: number; output_tokens?: number; total_tokens?: number };
}

/**
 * 火山方舟(Volcengine Ark)生图适配器 —— 与 OpenAiCompatibleImageProvider 并列的第二家真实生图供应商,
 * 由 env `IMAGE_PROVIDER=ark_image` 选中(见 route-table.imageRealProvider)。与 OpenAI 形状的差异,
 * 也是不能直接复用 openai_compatible_image 的原因(2026-09-17 实测):
 * - 必须显式 `response_format:"b64_json"`,缺省回 URL;
 * - `size` 用档位("1K"/"2K"/"4K")或 "宽x高",且有最小像素门槛;
 * - 实际尺寸在 `data[0].size`(非顶层),usage 只有 `output_tokens/total_tokens`,无 input 侧;
 * - 返回的是 **JPEG** 而非 PNG(业务侧按魔数决定落盘扩展名,见 courseware-page.service);
 * - 多出 `watermark`(默认关:教学课件不该带平台水印)与 `sequential_image_generation`(恒 disabled,一次一张)。
 * 与同目录先例相同的纪律:key 只在本类内读取、不进日志/出参;原生 fetch + AbortController;
 * 上游错误体最多截 120 字符。env 复用同一组 `IMAGE_*`(与 LLM_* 一样,一组变量、base URL 决定厂商)。
 */
@Injectable()
export class ArkImageProvider implements ImageProvider {
  readonly name = ARK_IMAGE_PROVIDER_NAME;

  constructor(private readonly cfg: ConfigService) {}

  private apiKey(): string {
    return (this.cfg.get<string>('IMAGE_API_KEY', '') ?? '').trim();
  }

  private baseUrl(): string {
    return (this.cfg.get<string>('IMAGE_BASE_URL', DEFAULT_BASE_URL) || DEFAULT_BASE_URL).replace(/\/+$/, '');
  }

  private model(): string {
    return this.cfg.get<string>('IMAGE_MODEL', ARK_DEFAULT_IMAGE_MODEL) || ARK_DEFAULT_IMAGE_MODEL;
  }

  healthy(): boolean {
    return !!this.apiKey();
  }

  async generate(req: { prompt: string; feature: AiFeature }): Promise<ImageResult> {
    const apiKey = this.apiKey();
    if (!apiKey) throw new Error('IMAGE_API_KEY 未配置,ark_image 供应商不可用');
    const size = this.cfg.get<string>('IMAGE_SIZE', DEFAULT_SIZE) || DEFAULT_SIZE;
    const watermark = (this.cfg.get<string>('IMAGE_WATERMARK', 'false') ?? 'false').trim().toLowerCase() === 'true';

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), IMAGE_TIMEOUT_MS);
    try {
      const res = await fetch(`${this.baseUrl()}/images/generations`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: this.model(),
          prompt: req.prompt,
          size,
          response_format: 'b64_json',
          watermark,
          sequential_image_generation: 'disabled',
          stream: false,
        }),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`生图上游 HTTP ${res.status}${text ? `:${text.slice(0, 120)}` : ''}`);
      }
      const body = (await res.json().catch(() => null)) as ArkImagesResponse | null;
      const first = body?.data?.[0];
      const b64 = first?.b64_json;
      if (!b64) throw new Error('生图上游未返回 data[0].b64_json');
      const usage = body?.usage;
      return {
        imageB64: b64,
        ...(usage
          ? { usage: { tokensIn: 0, tokensOut: usage.output_tokens ?? usage.total_tokens ?? 0 } }
          : {}),
        ...(first?.size ? { actualSize: first.size } : {}),
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
   * 最小探活(POST /admin/ai/test?feature=courseware 且 IMAGE_PROVIDER=ark_image 时走这里):
   * 只 GET {IMAGE_BASE_URL}/models(方舟支持,实测 200),不出图不计费;永不抛错,一律返回结构化 {ok,error}。
   */
  async testConnection(): Promise<AiTestResultDto> {
    const started = Date.now();
    const apiKey = this.apiKey();
    if (!apiKey) {
      return { ok: false, latencyMs: 0, sample: null, error: '未配置生图 API Key(IMAGE_API_KEY),无法测试连接' };
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
    try {
      const res = await fetch(`${this.baseUrl()}/models`, {
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
      return { ok: true, latencyMs: Date.now() - started, sample: `生图供应商可达(ark),model=${this.model()}`, error: null };
    } catch (e) {
      const err = e as Error;
      const msg = err.name === 'AbortError' ? `连接超时(${PROBE_TIMEOUT_MS / 1000}s)` : err.message || '连接失败';
      return { ok: false, latencyMs: Date.now() - started, sample: null, error: msg };
    } finally {
      clearTimeout(timer);
    }
  }
}
