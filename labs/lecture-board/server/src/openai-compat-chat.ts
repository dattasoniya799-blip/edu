/**
 * OpenAI 兼容 chat/completions 的 ChatPort(复制自 ohmyppt-lecture/src/main/lecture/openai-compat-chat.ts,
 * 加了 response_format: json_object —— protocol.md 要求规划/出剧本走 json_object)。
 * 纯 fetch,无依赖;错误信息一律过 redact,不含 key。
 */
import { redact } from './config'
import type { ChatCompleteOptions, ChatContent, ChatMessage, ChatPort } from './ports'

export interface OpenAICompatChatConfig {
  id: string
  baseUrl: string
  apiKey: string
  model: string
  supportsVision: boolean
  fetchImpl?: typeof fetch
}

type WirePart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }

function toWireContent(content: ChatContent): string | WirePart[] {
  if (typeof content === 'string') return content
  return content.map((part) =>
    part.type === 'text' ? { type: 'text', text: part.text } : { type: 'image_url', image_url: { url: part.dataUrl } }
  )
}

export class ChatError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message)
    this.name = 'ChatError'
  }
}

export function createOpenAICompatChatPort(config: OpenAICompatChatConfig): ChatPort {
  const base = config.baseUrl.replace(/\/+$/, '')
  const doFetch = config.fetchImpl ?? fetch
  return {
    id: config.id,
    supportsVision: config.supportsVision,
    async complete(messages: ChatMessage[], options: ChatCompleteOptions = {}): Promise<string> {
      if (!config.apiKey) throw new ChatError('缺少模型 API Key')
      const body: Record<string, unknown> = {
        model: config.model,
        messages: messages.map((m) => ({ role: m.role, content: toWireContent(m.content) }))
      }
      if (options.temperature != null) body.temperature = options.temperature
      if (options.maxTokens != null) body.max_tokens = options.maxTokens
      if (options.thinking != null) body.enable_thinking = options.thinking
      if (options.jsonObject) body.response_format = { type: 'json_object' }

      const timeoutMs = options.timeoutMs ?? 120_000
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      try {
        const res = await doFetch(`${base}/chat/completions`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: controller.signal
        })
        const text = await res.text()
        let data: Record<string, unknown> = {}
        try {
          data = JSON.parse(text) as Record<string, unknown>
        } catch {
          /* 非 JSON 错误体按原文处理 */
        }
        if (!res.ok) {
          const err = data.error as { message?: string } | undefined
          throw new ChatError(`模型请求失败 ${res.status}:${redact(err?.message || text, 200)}`, res.status)
        }
        const choices = data.choices as Array<{ message?: { content?: unknown } }> | undefined
        const content = choices?.[0]?.message?.content
        if (typeof content === 'string') return content
        if (Array.isArray(content)) {
          return content
            .map((p) => (p && typeof p === 'object' && typeof (p as { text?: unknown }).text === 'string' ? (p as { text: string }).text : ''))
            .join('')
        }
        throw new ChatError('模型回复里没有文本内容')
      } catch (error) {
        if ((error as Error).name === 'AbortError') throw new ChatError(`模型请求超时(${timeoutMs} ms)`)
        if (error instanceof ChatError) throw error
        throw new ChatError(redact(error))
      } finally {
        clearTimeout(timer)
      }
    }
  }
}
