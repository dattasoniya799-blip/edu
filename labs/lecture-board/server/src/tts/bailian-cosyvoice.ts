/**
 * 阿里云百炼 CosyVoice 语音合成 provider(TtsPort 实现,纯 TS,不依赖 Electron / Python SDK)。
 *
 * 协议(WebSocket,《讲解件-识题要点与语音-设计方案-2026-09-16》§三 §七):
 *   连接 wss://dashscope.aliyuncs.com/api-ws/v1/inference(头 Authorization: Bearer <key>)
 *   → run-task(streaming: duplex,task_id = UUID)→ 等 task-started
 *   → continue-task(整句)→ finish-task → 收二进制帧拼成 mp3 → task-finished。
 *   同一任务内 task_id 不变;task-failed 带 error_message 上抛;握手 401/403 = key 无效;超时 30 s。
 *
 * 用 `ws` 包而不是 Node 全局 WebSocket:握手要带自定义 Authorization 头。
 * 串行队列(同一时刻只跑一条任务),失败重试 1 次;顺序任务复用同一条连接,空闲一段时间后关掉。
 */
import { randomUUID } from 'node:crypto'
import WebSocket from 'ws'
import { BAILIAN_TTS_MODEL, BAILIAN_TTS_WS_URL, redact } from '../config'
import type { TtsPort, TtsSynthesizeOptions, TtsSynthesizeResult } from '../ports'
import { mp3DurationMs } from './mp3-duration'

export class BailianTtsError extends Error {
  /** 服务端 task-failed 的 error_code */
  code?: string
  /** 握手阶段的 HTTP 状态码(401/403 = key 无效) */
  status?: number
  /** 是否值得换一条连接再试一次 */
  retryable: boolean
  constructor(message: string, o: { code?: string; status?: number; retryable?: boolean } = {}) {
    super(message)
    this.name = 'BailianTtsError'
    this.code = o.code
    this.status = o.status
    this.retryable = o.retryable ?? false
  }
}

export type WsFactory = (url: string, headers: Record<string, string>) => WebSocket

export interface BailianCosyVoiceOptions {
  /** 每次任务前取 key(工作台模型配置 / 环境变量),不缓存 */
  getKey: () => Promise<string>
  model?: string
  wsUrl?: string
  /** 单测注入:换掉 WebSocket 的构造方式 */
  wsFactory?: WsFactory
  /** 单个任务(连接 + 合成)的总超时,默认 30 s */
  timeoutMs?: number
  /** 任务失败后再试几次,默认 1 */
  retries?: number
  /** 队列空了以后连接保留多久,默认 3 s;0 = 立刻关 */
  idleCloseMs?: number
  sampleRate?: number
  bitRate?: number
}

export interface BailianCosyVoicePort extends TtsPort {
  /** 主动关掉复用中的连接(预渲染一批结束后调用;不调也会在空闲后自动关) */
  close(): void
}

interface ServerHeader {
  event?: string
  task_id?: string
  error_code?: string
  error_message?: string
}

export function createBailianCosyVoicePort(options: BailianCosyVoiceOptions): BailianCosyVoicePort {
  const model = options.model || BAILIAN_TTS_MODEL
  const wsUrl = options.wsUrl || BAILIAN_TTS_WS_URL
  const timeoutMs = options.timeoutMs ?? 30_000
  const retries = options.retries ?? 1
  const idleCloseMs = options.idleCloseMs ?? 3_000
  const sampleRate = options.sampleRate ?? 22050
  const bitRate = options.bitRate ?? 32
  const wsFactory: WsFactory = options.wsFactory || ((url, headers) => new WebSocket(url, { headers }))

  let conn: WebSocket | null = null
  let queue: Promise<unknown> = Promise.resolve()
  let pending = 0
  let idleTimer: ReturnType<typeof setTimeout> | null = null

  function dropConn(ws: WebSocket | null, terminate: boolean): void {
    if (!ws) return
    if (conn === ws) conn = null
    try {
      if (terminate) ws.terminate()
      else ws.close()
    } catch {
      /* 已关 */
    }
  }

  function connect(key: string): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
      const ws = wsFactory(wsUrl, { Authorization: `Bearer ${key}`, 'user-agent': 'lecture-board-tts/1.0' })
      let settled = false
      const timer = setTimeout(() => {
        if (settled) return
        settled = true
        dropConn(ws, true)
        reject(new BailianTtsError(`连接百炼语音服务超时(${Math.round(timeoutMs / 1000)} s)`, { retryable: true }))
      }, timeoutMs)
      ws.once('open', () => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        // 连接生命周期内的兜底监听:被动关闭 / 出错 → 不再复用
        ws.on('close', () => { if (conn === ws) conn = null })
        ws.on('error', () => { if (conn === ws) conn = null })
        resolve(ws)
      })
      ws.once('unexpected-response', (_req, res) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        const status = res.statusCode ?? 0
        dropConn(ws, true)
        if (status === 401 || status === 403) reject(new BailianTtsError(`百炼 API key 无效或无权限(HTTP ${status})`, { status }))
        else reject(new BailianTtsError(`百炼语音服务握手失败(HTTP ${status})`, { status, retryable: status >= 500 }))
      })
      ws.once('error', (err: Error) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        dropConn(ws, true)
        reject(new BailianTtsError(`连接百炼语音服务失败:${redact(err.message, 160)}`, { retryable: true }))
      })
    })
  }

  async function getConn(): Promise<WebSocket> {
    if (conn && conn.readyState === WebSocket.OPEN) return conn
    conn = null
    const key = await options.getKey()
    if (!key) throw new BailianTtsError('缺少百炼 API key')
    const ws = await connect(key)
    conn = ws
    return ws
  }

  function runTask(ws: WebSocket, text: string, voice: string, rate: number, signal?: AbortSignal): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
      const taskId = randomUUID()
      const chunks: Buffer[] = []
      let settled = false
      const send = (action: string, payload: Record<string, unknown>): void => {
        ws.send(JSON.stringify({ header: { action, task_id: taskId, streaming: 'duplex' }, payload }))
      }
      const cleanup = (): void => {
        clearTimeout(timer)
        ws.off('message', onMessage)
        ws.off('close', onClose)
        ws.off('error', onError)
        signal?.removeEventListener('abort', onAbort)
      }
      const finish = (bytes: Uint8Array): void => {
        if (settled) return
        settled = true
        cleanup()
        resolve(bytes)
      }
      const fail = (err: BailianTtsError): void => {
        if (settled) return
        settled = true
        cleanup()
        dropConn(ws, true) // 失败 / 超时 / 中止的连接不复用
        reject(err)
      }
      const timer = setTimeout(() => fail(new BailianTtsError(`语音合成超时(${Math.round(timeoutMs / 1000)} s):${text.slice(0, 20)}…`, { retryable: true })), timeoutMs)
      const onMessage = (data: WebSocket.RawData, isBinary: boolean): void => {
        if (isBinary) {
          chunks.push(Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer))
          return
        }
        let header: ServerHeader
        try {
          header = (JSON.parse(data.toString()) as { header?: ServerHeader }).header || {}
        } catch {
          return
        }
        if (header.task_id && header.task_id !== taskId) return
        switch (header.event) {
          case 'task-started':
            send('continue-task', { input: { text } })
            send('finish-task', { input: {} })
            break
          case 'result-generated':
            break
          case 'task-finished':
            finish(chunks.length === 1 ? new Uint8Array(chunks[0]) : new Uint8Array(Buffer.concat(chunks)))
            break
          case 'task-failed':
            fail(new BailianTtsError(`百炼语音合成失败:${redact(header.error_message || header.error_code || "", 160) || '未知错误'}`, { code: header.error_code, retryable: true }))
            break
          default:
            break
        }
      }
      const onClose = (): void => fail(new BailianTtsError('百炼语音服务在任务完成前关闭了连接', { retryable: true }))
      const onError = (err: Error): void => fail(new BailianTtsError(`百炼语音连接出错:${redact(err.message, 160)}`, { retryable: true }))
      const onAbort = (): void => fail(new BailianTtsError('语音合成已中止'))
      if (signal?.aborted) {
        clearTimeout(timer)
        reject(new BailianTtsError('语音合成已中止'))
        return
      }
      ws.on('message', onMessage)
      ws.on('close', onClose)
      ws.on('error', onError)
      signal?.addEventListener('abort', onAbort)
      send('run-task', {
        task_group: 'audio',
        task: 'tts',
        function: 'SpeechSynthesizer',
        model,
        parameters: { text_type: 'PlainText', voice, format: 'mp3', sample_rate: sampleRate, bit_rate: bitRate, rate },
        input: {}
      })
    })
  }

  async function synthesizeOnce(text: string, o: TtsSynthesizeOptions): Promise<TtsSynthesizeResult> {
    const rate = Math.min(2, Math.max(0.5, o.speed ?? 1))
    let lastError: unknown
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const ws = await getConn()
        const bytes = await runTask(ws, text, o.voiceId, rate, o.signal)
        return { mime: 'audio/mpeg', bytes, durationMs: mp3DurationMs(bytes) }
      } catch (err) {
        lastError = err
        const retryable = err instanceof BailianTtsError ? err.retryable : true
        if (!retryable || attempt === retries || o.signal?.aborted) throw err
      }
    }
    throw lastError
  }

  function scheduleIdleClose(): void {
    if (idleTimer) clearTimeout(idleTimer)
    idleTimer = null
    if (pending > 0 || !conn) return
    if (idleCloseMs <= 0) {
      dropConn(conn, false)
      return
    }
    idleTimer = setTimeout(() => { idleTimer = null; if (pending === 0) dropConn(conn, false) }, idleCloseMs)
    idleTimer.unref?.()
  }

  return {
    id: 'bailian-cosyvoice',
    synthesize(text: string, o: TtsSynthesizeOptions): Promise<TtsSynthesizeResult> {
      pending++
      if (idleTimer) { clearTimeout(idleTimer); idleTimer = null }
      const run = (): Promise<TtsSynthesizeResult> => synthesizeOnce(text, o).finally(() => { pending--; scheduleIdleClose() })
      const p = queue.then(run, run)
      queue = p.catch(() => undefined)
      return p
    },
    close(): void {
      if (idleTimer) { clearTimeout(idleTimer); idleTimer = null }
      dropConn(conn, false)
    }
  }
}
