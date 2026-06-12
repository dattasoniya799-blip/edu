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
