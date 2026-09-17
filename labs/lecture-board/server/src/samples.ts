/**
 * 首页「示例题目 · 一键试讲」:扫 ../题目/ 下的每个题目文件夹(验收题 + 中考真题夹具),
 * 给每道题算一个学科标签 + 答案预览,供 `GET /api/samples` 用;
 * `loadSampleInput` 把某一道示例题的图 + 答案.md 读出来,交给 `pipeline.ts`
 * 里**同一条**的 `createLesson`/`runPipeline` 走完整流水线(不另写一套上传逻辑)。
 */
import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import type { Subject } from '../../shared/schema'
import { LAB_ROOT } from './config'

/** labs/lecture-board/题目/ */
export const SAMPLES_ROOT = resolve(LAB_ROOT, '题目')

export interface SampleSummary {
  /** 文件夹名(原样),从 dir 里的图 + 答案.md 建课时要用它 */
  dir: string
  /** 去掉数字序号前缀的标题 */
  title: string
  subject: Subject
  /** 静态托管的题目图 URL,如 /samples/03-浮力潜艇/题目.jpg */
  imageUrl: string
  /** 答案.md 第一条结论,截断 */
  answerPreview: string
}

const PHYSICS_HINTS = [
  '压强',
  '浮力',
  '滑轮',
  '电路',
  '电流',
  '电压',
  '电功率',
  '功率',
  '欧姆',
  '伏特',
  '安培',
  '焦耳',
  '牛顿',
  '并联',
  '串联',
  '机械效率',
  '密度',
  '速度',
  '加速度'
]
const CHEMISTRY_HINTS = ['摩尔', '化学式', '溶液', 'pH', '氧化', '还原', '化合价', '燃烧', '反应物', '生成物', '酸碱', '化学方程式']

/** 按标题 + 答案文本里的关键词猜学科;猜不出来的一律算数学(样本目录目前也确实没有化学题)。 */
export function guessSubject(text: string): Subject {
  if (CHEMISTRY_HINTS.some((k) => text.includes(k))) return 'chemistry'
  if (PHYSICS_HINTS.some((k) => text.includes(k))) return 'physics'
  return 'math'
}

/** 「01-圆与圆周角」→「圆与圆周角」 */
export function sampleTitle(dirName: string): string {
  return dirName.replace(/^\d+-/, '') || dirName
}

/** 取 答案.md 里第一条非标题非引用的行,截断成一句预览。 */
export function answerPreview(markdown: string, maxLen = 56): string {
  const line = markdown
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.length > 0 && !l.startsWith('#') && !l.startsWith('>'))
  if (!line) return ''
  return line.length > maxLen ? `${line.slice(0, maxLen)}…` : line
}

const IMAGE_RE = /^题目\.(png|jpg|jpeg|webp)$/i

async function findImageFile(dir: string): Promise<string | undefined> {
  if (!existsSync(dir)) return undefined
  const entries = await readdir(dir)
  return entries.find((f) => IMAGE_RE.test(f))
}

/** 扫 SAMPLES_ROOT 下的每个题目文件夹,按目录名排序(即按序号)。 */
export async function listSamples(): Promise<SampleSummary[]> {
  if (!existsSync(SAMPLES_ROOT)) return []
  const entries = await readdir(SAMPLES_ROOT, { withFileTypes: true })
  const dirs = entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort()

  const out: SampleSummary[] = []
  for (const dir of dirs) {
    const full = join(SAMPLES_ROOT, dir)
    const image = await findImageFile(full)
    if (!image) continue // 没有题目图的文件夹不算一道可试讲的题
    const answerPath = join(full, '答案.md')
    const answerMd = existsSync(answerPath) ? await readFile(answerPath, 'utf8') : ''
    const title = sampleTitle(dir)
    out.push({
      dir,
      title,
      subject: guessSubject(`${title}\n${answerMd}`),
      imageUrl: `/samples/${dir}/${image}`,
      answerPreview: answerPreview(answerMd)
    })
  }
  return out
}

export interface SampleInput {
  imagePath: string
  imageExt: string
  answerText: string
}

/**
 * `POST /api/lessons/from-sample/:dir` 的 dir 是用户可控的 URL 段(实测 `../../../server/src` 这种
 * 能让 `join(SAMPLES_ROOT, dir)` 逃出 `题目/` 目录,虽然目前只会去找一个叫「题目.png」的文件、命中率低,
 * 但这仍是一条不该开着的路径穿越口子)。白名单校验:必须是 `SAMPLES_ROOT` 直接子目录里的一个,
 * 不含路径分隔符、不含 `..`,解析后的绝对路径也必须真的落在 `SAMPLES_ROOT` 里面。
 */
export function resolveSampleDir(dir: string): string | undefined {
  const name = String(dir ?? '')
  if (!name || name === '.' || name === '..' || name.includes('/') || name.includes('\\') || name.includes('\0')) return undefined
  const root = resolve(SAMPLES_ROOT)
  const full = resolve(root, name)
  if (full !== root && !full.startsWith(root + sep)) return undefined
  if (!existsSync(full)) return undefined
  return full
}

/** 给「试讲这道」用:找到该文件夹的题目图 + 答案.md 全文。 */
export async function loadSampleInput(dir: string): Promise<SampleInput | undefined> {
  const full = resolveSampleDir(dir)
  if (!full) return undefined
  const image = await findImageFile(full)
  if (!image) return undefined
  const answerPath = join(full, '答案.md')
  const answerText = existsSync(answerPath) ? (await readFile(answerPath, 'utf8')).trim() : ''
  const ext = image.split('.').pop()?.toLowerCase() ?? 'png'
  return { imagePath: join(full, image), imageExt: ext === 'jpeg' ? 'jpg' : ext, answerText }
}
