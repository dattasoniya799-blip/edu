/**
 * Seedream 情境图(形状取自 qiming/apps/server/src/ai/llm/providers/ark-image.provider.ts)。
 *  - 必须显式 response_format:"b64_json",缺省回 URL;size 用档位 "2K";回的是 JPEG 不是 PNG;
 *  - watermark 关(教学图不带平台水印),sequential_image_generation 恒 disabled;
 *  - 超时 120 s;错误体最多截 120 字符且过 redact。
 * 风格前缀由这里统一拼(剧本里的 prompt 只写画面内容),缓存键 = sha1(前缀 + prompt)。
 */
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { copyFile, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ARK_BASE_URL, FIGURE_CACHE_ROOT, redact, SEEDREAM_MODEL, SEEDREAM_SIZE, SEEDREAM_STYLE_PREFIX, seedreamKey, TIMEOUT_SEEDREAM_MS } from '../config'

export interface SeedreamResult {
  bytes: Uint8Array
  actualSize?: string
  fromCache: boolean
  ms: number
}

export function stylePrompt(content: string): string {
  return `${SEEDREAM_STYLE_PREFIX}${String(content ?? '').trim()}`
}

export function cacheKey(content: string): string {
  return createHash('sha1').update(stylePrompt(content), 'utf8').digest('hex')
}

async function callArk(prompt: string): Promise<{ bytes: Uint8Array; actualSize?: string }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_SEEDREAM_MS)
  try {
    const res = await fetch(`${ARK_BASE_URL}/images/generations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${seedreamKey()}` },
      body: JSON.stringify({
        model: SEEDREAM_MODEL,
        prompt,
        size: SEEDREAM_SIZE,
        response_format: 'b64_json',
        watermark: false,
        sequential_image_generation: 'disabled',
        stream: false
      }),
      signal: controller.signal
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`生图上游 HTTP ${res.status}${text ? `:${redact(text, 120)}` : ''}`)
    }
    const body = (await res.json().catch(() => null)) as { data?: Array<{ b64_json?: string; size?: string }> } | null
    const first = body?.data?.[0]
    if (!first?.b64_json) throw new Error('生图上游没有返回 data[0].b64_json')
    return { bytes: Buffer.from(first.b64_json, 'base64'), actualSize: first.size }
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw new Error(`生图上游超时(${TIMEOUT_SEEDREAM_MS / 1000} s)`)
    throw new Error(redact(error))
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 出一张情境图并落到 destFile。命中缓存就直接复制,不再计费。
 * 每张 2K 实测 20–33 s,约 ¥0.3,所以缓存一定要走。
 */
export async function generateFigure(content: string, destFile: string): Promise<SeedreamResult> {
  const started = Date.now()
  const key = cacheKey(content)
  const cacheFile = join(FIGURE_CACHE_ROOT, `${key}.jpg`)
  if (existsSync(cacheFile)) {
    await copyFile(cacheFile, destFile)
    const { readFile } = await import('node:fs/promises')
    return { bytes: await readFile(cacheFile), fromCache: true, ms: Date.now() - started }
  }
  const { bytes, actualSize } = await callArk(stylePrompt(content))
  await mkdir(FIGURE_CACHE_ROOT, { recursive: true })
  await writeFile(cacheFile, bytes)
  await writeFile(destFile, bytes)
  return { bytes, actualSize, fromCache: false, ms: Date.now() - started }
}
