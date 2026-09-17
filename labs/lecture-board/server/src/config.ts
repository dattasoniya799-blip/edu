/**
 * 密钥与路径。
 *
 * 纪律:key 只在进程内存里,**不复制、不打印、不写进 state.json / log.ndjson / 任何错误信息**。
 * 任何要落盘或回给前端的字符串都先过 redact()。
 */
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
/** server/ 目录 */
export const SERVER_ROOT = resolve(HERE, '..')
/** _lab/讲题白板/ 目录 */
export const LAB_ROOT = resolve(SERVER_ROOT, '..')
export const DATA_ROOT = resolve(SERVER_ROOT, 'data')
export const LESSONS_ROOT = resolve(DATA_ROOT, 'lessons')
export const FIGURE_CACHE_ROOT = resolve(DATA_ROOT, 'cache', 'figures')

export const PORT = Number(process.env.PORT ?? 4310)

/** 百炼(Qwen + CosyVoice) */
export const BAILIAN_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1'
export const BAILIAN_CHAT_MODEL = 'qwen3.8-flash'
export const BAILIAN_TTS_WS_URL = 'wss://dashscope.aliyuncs.com/api-ws/v1/inference'
export const BAILIAN_TTS_MODEL = 'cosyvoice-v3-flash'
export const BAILIAN_TTS_DEFAULT_VOICE = 'longxiaochun_v3'
export const BAILIAN_TTS_VOICE_NAME = '龙小淳'

/** Seedream(火山方舟) */
export const ARK_BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3'
export const SEEDREAM_MODEL = 'doubao-seedream-5-0-260128'
export const SEEDREAM_SIZE = '2K'
/** 固定风格前缀(protocol.md「Seedream 情境图」) */
export const SEEDREAM_STYLE_PREFIX =
  '教学插画,手绘线稿加淡彩,米白纸底,构图简洁,画面里不要出现任何文字、字母、数字或标签。'

/** 超时(上游调用一律有超时) */
export const TIMEOUT_QWEN_MS = 180_000
export const TIMEOUT_SEEDREAM_MS = 120_000
export const TIMEOUT_COSYVOICE_MS = 30_000

/**
 * 生图 key 所在的 .env:优先 env `LECTURE_SEEDREAM_ENV`;否则按本目录位置猜——
 * 在 qiming/labs/lecture-board/server 时是 ../../../apps/server/.env,在 _lab/讲题白板/server 时是工作区里的 qiming/apps/server/.env。
 */
function seedreamEnvFile(): string {
  if (process.env.LECTURE_SEEDREAM_ENV) return process.env.LECTURE_SEEDREAM_ENV
  const candidates = [
    resolve(LAB_ROOT, '../../apps/server/.env'), // qiming/labs/lecture-board → qiming/apps/server/.env
    resolve(LAB_ROOT, '../../qiming/apps/server/.env') // _lab/讲题白板 → edu/qiming/apps/server/.env
  ]
  return candidates.find((p) => existsSync(p)) ?? candidates[0]
}

const KEY_FILES = {
  bailian: { path: process.env.LECTURE_BAILIAN_ENV ?? resolve(homedir(), '.config/edu/bailian.env'), name: 'DASHSCOPE_API_KEY' },
  seedream: { path: seedreamEnvFile(), name: 'IMAGE_API_KEY' }
} as const

const cache = new Map<string, string>()

function readEnvValue(file: string, name: string): string {
  if (!existsSync(file)) return ''
  const line = readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .find((l) => l.trim().startsWith(`${name}=`))
  if (!line) return ''
  return line.slice(line.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '')
}

function loadKey(which: keyof typeof KEY_FILES): string {
  const cached = cache.get(which)
  if (cached != null) return cached
  const { path, name } = KEY_FILES[which]
  const value = process.env[name]?.trim() || readEnvValue(path, name)
  cache.set(which, value)
  return value
}

/** 百炼 key(Qwen 与 CosyVoice 共用一把) */
export function bailianKey(): string {
  const key = loadKey('bailian')
  if (!key) throw new Error(`没读到百炼 key:请确认 ${KEY_FILES.bailian.path} 里有 ${KEY_FILES.bailian.name}=…`)
  return key
}

/** Seedream key(以 ark- 开头) */
export function seedreamKey(): string {
  const key = loadKey('seedream')
  if (!key) throw new Error(`没读到生图 key:请确认 qiming 的 .env 里有 ${KEY_FILES.seedream.name}=…`)
  return key
}

export function hasBailianKey(): boolean {
  return Boolean(loadKey('bailian'))
}
export function hasSeedreamKey(): boolean {
  return Boolean(loadKey('seedream'))
}

/**
 * 抹掉任何看起来像 key 的串,再截断。所有落盘 / 上报的错误信息都走它。
 * 既按已知 key 的实际值抹,也按形状抹(万一换了别的 key 也不会漏出去)。
 */
export function redact(input: unknown, maxLength = 400): string {
  let text = input instanceof Error ? input.message : String(input ?? '')
  for (const which of Object.keys(KEY_FILES) as Array<keyof typeof KEY_FILES>) {
    const key = loadKey(which)
    if (key && key.length > 6) text = text.split(key).join('***')
  }
  text = text
    .replace(/\b(?:sk|ark)-[A-Za-z0-9_-]{8,}/g, '***')
    .replace(/Bearer\s+[A-Za-z0-9._-]{8,}/gi, 'Bearer ***')
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, (m) => m) // lessonId 之类的 UUID 留着
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text
}
