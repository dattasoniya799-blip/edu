import { Injectable } from '@nestjs/common';

/** OCR 抽象(任务卡:OCR 用接口 + local stub;C3 接真实手写识别时只换 Provider 绑定) */
export interface OcrService {
  /** 识别 OSS 上的手写原稿,返回纯文本 */
  recognize(ossKey: string): Promise<string>;
}

export const OCR_SERVICE = Symbol('OCR_SERVICE');

/**
 * 本地 stub:确定性占位文本(不含 √ 步骤标记 → 预批仅得 rubric 第 1 步分,
 * 与 A5 既有用例「拍照作答 aiScore=第 1 步分」的口径一致)。
 */
@Injectable()
export class LocalOcrStub implements OcrService {
  async recognize(ossKey: string): Promise<string> {
    return `【本地OCR占位】图片 ${ossKey} 的手写识别文本`;
  }
}
