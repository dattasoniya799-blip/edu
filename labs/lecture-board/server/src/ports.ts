/**
 * 外部能力端口(形状沿用 ohmyppt-lecture/src/main/lecture/ports.ts,单测可注入假实现)。
 * 流水线只依赖这三个接口,不直接 import 任何供应商实现。
 */

export interface ChatTextPart {
  type: 'text'
  text: string
}
export interface ChatImagePart {
  type: 'image'
  /** data:image/...;base64,… */
  dataUrl: string
}
export type ChatContent = string | Array<ChatTextPart | ChatImagePart>

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: ChatContent
}

export interface ChatCompleteOptions {
  temperature?: number
  timeoutMs?: number
  maxTokens?: number
  /** Qwen3.x 思考开关:识题 true(抄对数值优先),出剧本 false(结构化、快) */
  thinking?: boolean
  /** 出剧本用 json_object,逼模型只吐 JSON */
  jsonObject?: boolean
}

export interface ChatPort {
  id: string
  supportsVision: boolean
  complete(messages: ChatMessage[], options?: ChatCompleteOptions): Promise<string>
}

export interface TtsSynthesizeOptions {
  voiceId: string
  speed?: number
  signal?: AbortSignal
}
export interface TtsSynthesizeResult {
  mime: 'audio/mpeg'
  bytes: Uint8Array
  durationMs?: number
}
export interface TtsPort {
  id: string
  synthesize(text: string, options: TtsSynthesizeOptions): Promise<TtsSynthesizeResult>
  close?(): void
}

export interface ImagePort {
  id: string
  /** prompt 已含风格前缀;回 JPEG 字节 */
  generate(prompt: string, options?: { timeoutMs?: number }): Promise<{ bytes: Uint8Array; actualSize?: string }>
}
