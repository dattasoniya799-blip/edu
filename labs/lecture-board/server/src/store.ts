/**
 * 课时状态与事件总线。
 *  - 落盘:data/lessons/<id>/{input,figures,audio,state.json,log.ndjson}
 *  - state.json 每次变更整体重写(体量小,几十 KB);log.ndjson 每次模型调用追加一行
 *  - SSE:内存订阅者列表,连上先补一条 snapshot
 * 日志里只留 prompt 摘要 + response 原文,绝不含 key(统一过 redact)。
 */
import { appendFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { BoardScript, LessonStage, LessonState, Subject } from '../../shared/schema'
import { LESSONS_ROOT, redact } from './config'
import type { ChatMessage } from './ports'

export type ServerEvent =
  | { type: 'snapshot'; state: LessonState }
  | { type: 'stage'; stage: LessonStage; status: 'start' | 'done' | 'error'; message?: string; ms?: number }
  | { type: 'script'; script: BoardScript }
  | { type: 'figure'; id: string; status: 'ready' | 'failed'; src?: string; error?: string }
  | { type: 'animation'; id: string; status: 'ready' | 'failed'; kind?: 'template' | 'html' | 'static'; html?: string; svg?: string; error?: string }
  | { type: 'audio'; key: string; src: string; durationMs?: number; text: string }
  | { type: 'complete' }
  | { type: 'error'; message: string }

type Listener = (event: ServerEvent) => void

const states = new Map<string, LessonState>()
const listeners = new Map<string, Set<Listener>>()

export function lessonDir(id: string): string {
  return join(LESSONS_ROOT, id)
}

export async function ensureLessonDirs(id: string): Promise<void> {
  for (const sub of ['input', 'figures', 'audio']) await mkdir(join(lessonDir(id), sub), { recursive: true })
}

export function newLessonId(): string {
  const now = new Date()
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(
    now.getHours()
  ).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`
  return `${stamp}-${Math.random().toString(36).slice(2, 6)}`
}

export function putState(state: LessonState): void {
  states.set(state.id, state)
}

export async function saveState(state: LessonState): Promise<void> {
  states.set(state.id, state)
  await mkdir(lessonDir(state.id), { recursive: true })
  await writeFile(join(lessonDir(state.id), 'state.json'), JSON.stringify(state, null, 2), 'utf8')
}

export async function loadState(id: string): Promise<LessonState | undefined> {
  const cached = states.get(id)
  if (cached) return cached
  const file = join(lessonDir(id), 'state.json')
  if (!existsSync(file)) return undefined
  try {
    const state = JSON.parse(await readFile(file, 'utf8')) as LessonState
    states.set(id, state)
    return state
  } catch {
    return undefined
  }
}

/**
 * 首页课程库要的列表形状(**不是** shared 契约,只是这个调试/列表接口自己的返回体,
 * 两侧都不依赖 shared/schema.ts 里没有的字段)。
 */
export interface LessonListItem {
  id: string
  createdAt: string
  stage: LessonStage
  title?: string
  /** 学科标签,script 到位前是 undefined(生成中/失败) */
  subject?: Subject
  /** 首张输入题目图 URL,给列表卡片当缩略图 */
  thumb?: string
  /** 一句话讲什么(script.summary) */
  summary?: string
}

export async function listLessons(): Promise<LessonListItem[]> {
  if (!existsSync(LESSONS_ROOT)) return []
  const dirs = await readdir(LESSONS_ROOT, { withFileTypes: true })
  const out: LessonListItem[] = []
  for (const d of dirs) {
    if (!d.isDirectory()) continue
    const state = await loadState(d.name)
    if (state)
      out.push({
        id: state.id,
        createdAt: state.createdAt,
        stage: state.stage,
        title: state.script?.title,
        subject: state.script?.subject,
        thumb: state.input.images[0],
        summary: state.script?.summary
      })
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

// ---------------- SSE ----------------

export function subscribe(id: string, listener: Listener): () => void {
  const set = listeners.get(id) ?? new Set<Listener>()
  set.add(listener)
  listeners.set(id, set)
  return () => {
    set.delete(listener)
    if (!set.size) listeners.delete(id)
  }
}

export function emit(id: string, event: ServerEvent): void {
  for (const listener of listeners.get(id) ?? []) {
    try {
      listener(event)
    } catch {
      /* 一个订阅者炸了不影响别人 */
    }
  }
}

// ---------------- 阶段计时 ----------------

type TimedStage = Exclude<LessonStage, 'uploaded' | 'failed'>

export async function startStage(state: LessonState, stage: TimedStage): Promise<void> {
  state.stage = stage
  state.timings[stage] = { startedAt: new Date().toISOString() }
  await saveState(state)
  emit(state.id, { type: 'stage', stage, status: 'start' })
}

export async function endStage(state: LessonState, stage: TimedStage, message?: string): Promise<number> {
  const entry = state.timings[stage] ?? { startedAt: new Date().toISOString() }
  const endedAt = new Date().toISOString()
  const ms = Date.parse(endedAt) - Date.parse(entry.startedAt)
  state.timings[stage] = { ...entry, endedAt, ms }
  await saveState(state)
  emit(state.id, { type: 'stage', stage, status: 'done', ms, message })
  return ms
}

export async function failLesson(state: LessonState, error: unknown): Promise<void> {
  const message = redact(error)
  state.stage = 'failed'
  state.error = message
  await saveState(state)
  emit(state.id, { type: 'error', message })
}

const TERMINAL_STAGES: LessonStage[] = ['ready', 'failed']

/**
 * server 重启(比如 `tsx watch` 因为改代码重载)时,原来在跑的 lesson 的流水线 Promise 跟着进程一起
 * 没了,但 `state.json` 还停在 recognizing/planning/scripting/assets 某一步 —— 没有任何东西会再把它
 * 推进,前端只会永远看着进度条转(运行问题复查 2026-09-17)。
 * 启动时扫一遍 `data/lessons/`,把所有非终态(不是 ready/failed)的课直接标 failed 并写清原因,
 * 前端能看到「服务重启,请重新上传」而不是干等。返回被标记的 lessonId 列表,给启动日志用。
 */
export async function reapInterruptedLessons(): Promise<string[]> {
  if (!existsSync(LESSONS_ROOT)) return []
  const dirs = await readdir(LESSONS_ROOT, { withFileTypes: true })
  const reaped: string[] = []
  for (const d of dirs) {
    if (!d.isDirectory()) continue
    const file = join(lessonDir(d.name), 'state.json')
    if (!existsSync(file)) continue
    let state: LessonState
    try {
      state = JSON.parse(await readFile(file, 'utf8')) as LessonState
    } catch {
      continue
    }
    if (TERMINAL_STAGES.includes(state.stage)) continue
    const interruptedStage = state.stage
    state.stage = 'failed'
    state.error = `服务在「${interruptedStage}」阶段重启,流水线没跑完,请重新上传这道题`
    states.set(state.id, state)
    await writeFile(file, JSON.stringify(state, null, 2), 'utf8')
    reaped.push(state.id)
  }
  return reaped
}

// ---------------- 调用日志 ----------------

export interface CallLogRecord {
  at?: string
  kind: string
  ms?: number
  ok?: boolean
  /** prompt 摘要:角色 + 字数 + 开头一段,不写全文(全文太大,也容易把图片 base64 写进去) */
  messages?: ChatMessage[]
  /** 模型回复原文 */
  response?: string
  error?: string
  extra?: Record<string, unknown>
}

function summarizeMessages(messages: ChatMessage[]): Array<Record<string, unknown>> {
  return messages.map((m) => {
    if (typeof m.content === 'string') {
      return { role: m.role, chars: m.content.length, head: redact(m.content.slice(0, 400), 400) }
    }
    const text = m.content.filter((p) => p.type === 'text').map((p) => (p as { text: string }).text).join('\n')
    const images = m.content.filter((p) => p.type === 'image').length
    return { role: m.role, images, chars: text.length, head: redact(text.slice(0, 400), 400) }
  })
}

/** 每次模型调用写一行 NDJSON(prompt 摘要 + response 原文,不含 key) */
export async function logCall(lessonId: string, record: CallLogRecord): Promise<void> {
  const line = {
    at: record.at ?? new Date().toISOString(),
    kind: record.kind,
    ms: record.ms,
    ok: record.ok,
    prompt: record.messages ? summarizeMessages(record.messages) : undefined,
    response: record.response ? redact(record.response, 200_000) : undefined,
    error: record.error ? redact(record.error) : undefined,
    ...(record.extra ? { extra: record.extra } : {})
  }
  try {
    await mkdir(lessonDir(lessonId), { recursive: true })
    await appendFile(join(lessonDir(lessonId), 'log.ndjson'), `${JSON.stringify(line)}\n`, 'utf8')
  } catch {
    /* 日志写不进去不该挡住流水线 */
  }
}
