/**
 * npm run run-problem -- <题目目录>
 *
 * 不起 HTTP,直接把一道题跑完整条流水线,产物照常落 data/lessons/<id>/,
 * 终端打印各阶段耗时、校验 errors/warnings、剧本规模与动画走的哪条路。
 * 题目目录里要有:题目.(png|jpg|jpeg) 一到三张 + 答案.md。
 */
import { readdir, readFile } from 'node:fs/promises'
import { basename, extname, isAbsolute, join, resolve } from 'node:path'
import type { BoardScript } from '../../../shared/schema'
import { animationUsage } from '../board-discipline'
import { LAB_ROOT, lessonDirLabel } from './helpers'
import { createLesson, runPipeline, type LessonInput } from '../pipeline'
import { newLessonId } from '../store'

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp'])

async function collectInput(dir: string): Promise<{ images: LessonInput['images']; answer: string }> {
  const entries = (await readdir(dir)).sort()
  const images: LessonInput['images'] = []
  let answer = ''
  for (const name of entries) {
    const ext = extname(name).toLowerCase()
    if (IMAGE_EXT.has(ext)) {
      images.push({ bytes: await readFile(join(dir, name)), ext: ext.slice(1) === 'jpeg' ? 'jpg' : ext.slice(1) })
    } else if (name === '答案.md') {
      answer = (await readFile(join(dir, name), 'utf8')).trim()
    }
  }
  if (!images.length) throw new Error(`${dir} 里没有题目截图(png/jpg)`)
  if (!answer) throw new Error(`${dir} 里没有 答案.md`)
  return { images, answer }
}

function seconds(ms?: number): string {
  return ms == null ? '—' : `${(ms / 1000).toFixed(1)} s`
}

function describeScript(script: BoardScript): string[] {
  const lines: string[] = []
  lines.push(`标题:${script.title}(${script.subject})`)
  lines.push(`列 ${script.columns.length}:${script.columns.map((c) => `${c.title}[${c.phase}]`).join(' | ')}`)
  const kindCount = new Map<string, number>()
  for (const card of script.cards) kindCount.set(card.kind, (kindCount.get(card.kind) ?? 0) + 1)
  lines.push(`卡 ${script.cards.length}:${[...kindCount].map(([k, n]) => `${k}×${n}`).join(' ')}`)
  lines.push(
    `图 ${script.figures.length}:${script.figures.map((f) => `${f.id}(${f.kind}/${f.status})`).join(' ') || '无'}`
  )
  lines.push(
    `动画 ${script.animations.length}:${
      script.animations.map((a) => `${a.id}(${a.kind}${a.template ? `:${a.template}` : ''}/${a.status})`).join(' ') || '无'
    }`
  )
  const says = script.steps.flatMap((s) => s.flow.filter((f) => 'say' in f).map((f) => (f as { say: string }).say))
  lines.push(`步 ${script.steps.length},旁白 ${says.length} 句 / ${says.join('').length} 字`)
  lines.push(`语音 ${Object.keys(script.audio?.clips ?? {}).length} 句已合成`)
  return lines
}

/** 动画上板纪律的统计:卡数 / 被几个动作驱动 / 附近有几句指向画面的旁白 */
function describeAnimations(script: BoardScript): string[] {
  const animCards = script.cards.filter((c) => c.kind === 'animation')
  const out = [`动画卡 ${animCards.length} 张,动画 ${script.animations.length} 张`]
  for (const u of animationUsage(script)) {
    out.push(
      `  ${u.id}(${u.kind}${u.template ? `:${u.template}` : ''})卡=${u.cardId ?? '无'} 列=${u.colTitle ?? '—'} ` +
        `驱动动作=${u.actions}[${u.actionNames.join(',')}] 指向画面的 say=${u.screenSays}`
    )
  }
  return out
}

async function main(): Promise<void> {
  const arg = process.argv[2]
  if (!arg) {
    console.error('用法:npm run run-problem -- <题目目录>,如 npm run run-problem -- 题目/03-浮力潜艇')
    process.exit(1)
  }
  const dir = isAbsolute(arg) ? arg : resolve(LAB_ROOT, arg)
  const label = basename(dir)
  const { images, answer } = await collectInput(dir)

  const input: LessonInput = { id: `${newLessonId()}-${label}`, images, answer }
  console.log(`\n=== ${label} ===`)
  console.log(`输入:${images.length} 张截图,答案 ${answer.length} 字`)
  const state = await createLesson(input)
  const started = Date.now()
  await runPipeline(state, input, { onNote: (note) => console.log(`  · ${note}`) })

  console.log('\n--- 阶段耗时 ---')
  for (const stage of ['recognizing', 'planning', 'scripting', 'assets'] as const) {
    console.log(`  ${stage.padEnd(12)} ${seconds(state.timings[stage]?.ms)}`)
  }
  console.log(`  ${'总计'.padEnd(11)} ${seconds(Date.now() - started)}`)

  console.log('\n--- 校验 ---')
  const v = state.validation ?? { errors: [], warnings: [] }
  const fixed = v.warnings.filter((w) => w.startsWith('已自动修正'))
  const plain = v.warnings.filter((w) => !w.startsWith('已自动修正'))
  console.log(`  errors ${v.errors.length} / warnings ${v.warnings.length}(其中自动修正 ${fixed.length} 条)`)
  for (const e of v.errors) console.log(`  [E] ${e}`)
  for (const w of fixed) console.log(`  [FIX] ${w.replace(/^已自动修正 · /, '')}`)
  for (const w of plain) console.log(`  [W] ${w}`)

  if (state.script) {
    console.log('\n--- 剧本 ---')
    for (const line of describeScript(state.script)) console.log(`  ${line}`)
    console.log('\n--- 动画上板纪律 ---')
    for (const line of describeAnimations(state.script)) console.log(`  ${line}`)
  }
  console.log(`\n产物:${lessonDirLabel(state.id)}`)
  console.log(state.stage === 'ready' ? '状态:ready ✅' : `状态:${state.stage}${state.error ? ` —— ${state.error}` : ''}`)
}

main().catch((error) => {
  console.error('run-problem 失败:', error)
  process.exit(1)
})
