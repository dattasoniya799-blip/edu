import { Injectable } from '@nestjs/common';
import type { AiFeature } from '@qiming/contracts';
import type { ImageProvider, ImageResult } from '../types';

/** mock 生图供应商标识(路由表 courseware=mock 时的 provider 名) */
export const MOCK_IMAGE_PROVIDER_NAME = 'mock_image';
/** mock 生图的路由表模型名(单价见 ai-routes.default.json) */
export const MOCK_IMAGE_MODEL = 'mock-image-v1';

/**
 * 1x1 合法 PNG(签名 + IHDR + IDAT + IEND,Buffer 解码后即可直接落盘为 .png)。
 * 只为让无 key 环境与 e2e 走通「解码→落盘→签名 URL→回读」全链路,不追求可看性。
 */
export const MOCK_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';

/** 提示词末段的页码标记(composePagePrompt 组装),失败注入据此识别页序 */
const SEQ_IN_PROMPT = /「(\d+)\/(\d+)」/;

/**
 * 失败注入开关(**仅 e2e 用**):seqs 里的页序首次生图抛错,重试即成功 ——
 * 用于验收「单页失败不中断其他页 + retry 恢复」。fired 保证「只失败一次」。
 * 也可用 env MOCK_IMAGE_FAIL_SEQ="2,5" 在启动期注入(无 key 的手工走查场景)。
 */
export const mockImageFailOnce = {
  seqs: new Set<number>(),
  fired: new Set<number>(),
  arm(...seqs: number[]): void {
    for (const s of seqs) this.seqs.add(s);
  },
  reset(): void {
    this.seqs.clear();
    this.fired.clear();
  },
};

/**
 * mock 生图供应商(零网络、确定性):
 * - 恒返回内置 1x1 PNG,usage 固定小值 → 配合路由表单价使 ai_calls 费用可手算;
 * - 供「未配 IMAGE_API_KEY 的开发环境」与 e2e 走完整生图链路;
 * - 失败注入见 mockImageFailOnce(页序取自提示词末段的「n/N」页码标记)。
 */
@Injectable()
export class MockImageProvider implements ImageProvider {
  readonly name = MOCK_IMAGE_PROVIDER_NAME;

  constructor() {
    for (const raw of (process.env.MOCK_IMAGE_FAIL_SEQ ?? '').split(',')) {
      const n = Number(raw.trim());
      if (Number.isInteger(n) && n > 0) mockImageFailOnce.arm(n);
    }
  }

  healthy(): boolean {
    return true;
  }

  async generate(req: { prompt: string; feature: AiFeature }): Promise<ImageResult> {
    const seq = Number(SEQ_IN_PROMPT.exec(req.prompt)?.[1] ?? 0);
    if (seq > 0 && mockImageFailOnce.seqs.has(seq) && !mockImageFailOnce.fired.has(seq)) {
      mockImageFailOnce.fired.add(seq);
      throw new Error(`mock 生图故障注入(第 ${seq} 页,测试用)`);
    }
    return {
      imageB64: MOCK_PNG_B64,
      usage: { tokensIn: 32, tokensOut: 8 },
      actualSize: '1x1',
      actualQuality: 'mock',
      // 让业务侧跳过「整页幻灯片最小字节」体检:占位图只有 70 字节,是设计如此
      mock: true,
    };
  }
}
