import type { AiFeature } from '@qiming/contracts';

/** 对话消息(OpenAI 兼容形状,设计文档 §8.1 Msg) */
export interface Msg {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** 流式输出块;usage 仅在最后一块给出(设计文档 §8.1 Chunk) */
export interface Chunk {
  delta: string;
  usage?: Usage;
}

export interface Usage {
  tokensIn: number;
  tokensOut: number;
}

/**
 * 调用归因(设计文档 §8.1 AiTrace → ai_calls 归因维度)。
 * 各能力按可得信息填充:QA 有 userId(可经 attemptId 富化 courseId/lessonId);
 * 预批经 A5 的 PreGradeContext 进来仅有 orgId(该接口为 A5 契约,禁改);
 * 课堂伴学由 classroom 接线时传 sessionId。
 */
export interface AiTrace {
  userId?: number | null;
  sessionId?: number | null;
  courseId?: number | null;
  lessonId?: number | null;
}

/** LlmGateway.chat 请求(设计文档 §8.1) */
export interface LlmChatRequest {
  feature: AiFeature;
  messages: Msg[];
  stream?: boolean;
  orgId: number;
  trace?: AiTrace;
  /**
   * [2026-08-22 courseware] 显式路由条目(给定时**绕过路由表**,额度/并发/计量照旧)。
   * 唯一用途:AI 生成课件一个 feature 同时用两种供应商 —— 逐页出图走路由表里的生图条目,
   * 而「文字稿 → 逐页大纲」那一步需要文本供应商,无法从同一条目取到。
   */
  route?: RouteEntry;
}

/**
 * 生图结果(AI 生成课件:一页幻灯片 = 一张整页图片)。
 * actualSize/actualQuality 为**上游实际使用**的参数 —— 中转网关常把请求的
 * 1536x1024/medium 归一成别的档位(实测),记账与页面元数据一律以响应实际值为准。
 */
export interface ImageResult {
  imageB64: string;
  usage?: Usage;
  actualSize?: string;
  actualQuality?: string;
  /**
   * [2026-08-22 audit-fix-server · P0-1] 该结果来自 mock 供应商(占位 1×1 PNG)。
   * 业务侧据此跳过「整页幻灯片最小字节」体检 —— 真实链路回来的极小图片一律判异常,
   * 而 mock 的 70 字节占位图是设计如此,不能被同一把尺子量。
   */
  mock?: boolean;
}

/** LlmGateway.image 请求(与 chat 同构:额度/路由/并发闸/计量全在网关内) */
export interface LlmImageRequest {
  feature: AiFeature;
  orgId: number;
  prompt: string;
  /** 归因到具体教师(ai_calls.user_id);更细的归因维度用 trace */
  userId?: number | null;
  trace?: AiTrace;
}

/** 生图供应商适配器统一接口(mock_image / openai_compatible_image) */
export interface ImageProvider {
  readonly name: string;
  generate(req: { prompt: string; feature: AiFeature }): Promise<ImageResult>;
  /** /ai/health 用:配置是否可用(不发真实网络探活) */
  healthy(): boolean;
}

/** LlmGateway 接口(设计文档 §8.1 原文形状) */
export interface LlmGateway {
  chat(req: LlmChatRequest): AsyncIterable<Chunk>;
}

/** 路由表条目:feature → {provider, model, fallback}(§8.1) */
export interface RouteEntry {
  provider: string;
  model: string;
  fallback?: { provider: string; model: string } | null;
}

/** 单价(元/1k token),配置驱动 → 费用 = 单价 × token 可手算 */
export interface Pricing {
  inPer1k: number;
  outPer1k: number;
  /**
   * [2026-08-22 audit-fix-server · P1-5] 按张计费维度(元/张),生图专用。
   * 生图无法只用 inPer1k/outPer1k 表达(上游 usage 口径各家不一、中转网关常少报),
   * 故最终 cost = max(perImage × 张数, token 估算),缺省(未配)时退化为纯 token 计价。
   */
  perImage?: number;
}

export interface RouteTable {
  routes: Record<AiFeature, RouteEntry>;
  pricing: Record<string, Pricing>;
}

/** 供应商适配器统一接口(mock / openai-compatible) */
export interface LlmProvider {
  readonly name: string;
  chat(req: { model: string; messages: Msg[]; feature: AiFeature }): AsyncIterable<Chunk>;
  /** /ai/health 用:配置是否可用(不发真实网络探活) */
  healthy(): boolean;
}
