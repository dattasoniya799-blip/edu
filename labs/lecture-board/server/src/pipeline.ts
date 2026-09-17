/**
 * 流水线:上传 → 识题 → 规划 → 出剧本 → 校验 → 发 script → 素材并行 → complete。
 *
 * 纪律:
 *  - 阶段顺序与事件形状严格按 protocol.md;planning/scripting 虽然共用一次模型调用,阶段事件各发一次;
 *  - 剧本一落地就发 script(web 可以开讲),图/动画/音频后台并行,到一个发一条;
 *  - 任何一项素材失败只把那一项标 failed,不阻塞其它,也不让整道题挂掉;
 *  - 每次模型调用写 log.ndjson;所有对外文本过 redact。
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { BoardScript, LessonState } from '../../shared/schema'
import { buildHtmlAnimation, isAnimationReady, usedActionNames } from './assets/animation'
import { prerenderAudio } from './assets/audio'
import { generateFigure } from './assets/seedream'
import {
  BAILIAN_BASE_URL,
  BAILIAN_CHAT_MODEL,
  bailianKey,
  hasBailianKey,
  hasSeedreamKey,
  redact,
  TIMEOUT_COSYVOICE_MS,
  TIMEOUT_QWEN_MS
} from './config'
import { finalizeBoardScript, planBoardScript } from './generate'
import { createOpenAICompatChatPort } from './openai-compat-chat'
import type { ChatPort } from './ports'
import { recognizeKeypoints, type Keypoints } from './recognize'
import {
  emit,
  endStage,
  ensureLessonDirs,
  failLesson,
  lessonDir,
  logCall,
  saveState,
  startStage
} from './store'
import { createBailianCosyVoicePort } from './tts/bailian-cosyvoice'
import { ANIMATION_TEMPLATES } from './templates'

export interface LessonInput {
  id: string
  images: Array<{ bytes: Buffer; ext: string }>
  answer: string
  problemText?: string
}

export interface PipelineHooks {
  /** run-problem 打印用:每完成一件事回调一次 */
  onNote?: (note: string) => void
}

function mime(ext: string): string {
  const e = ext.toLowerCase().replace(/^\./, '')
  return e === 'png' ? 'image/png' : e === 'webp' ? 'image/webp' : 'image/jpeg'
}

function chatPort(): ChatPort {
  return createOpenAICompatChatPort({
    id: `bailian/${BAILIAN_CHAT_MODEL}`,
    baseUrl: BAILIAN_BASE_URL,
    apiKey: bailianKey(),
    model: BAILIAN_CHAT_MODEL,
    supportsVision: true
  })
}

/** 建课时:写原图、建目录、落初始 state */
export async function createLesson(input: LessonInput): Promise<LessonState> {
  await ensureLessonDirs(input.id)
  const urls: string[] = []
  for (let i = 0; i < input.images.length; i++) {
    const img = input.images[i]
    const name = `${i + 1}.${img.ext.replace(/^\./, '')}`
    await writeFile(join(lessonDir(input.id), 'input', name), img.bytes)
    urls.push(`/assets/${input.id}/input/${name}`)
  }
  const state: LessonState = {
    id: input.id,
    createdAt: new Date().toISOString(),
    stage: 'uploaded',
    timings: {},
    input: { images: urls, answer: input.answer, problemText: input.problemText }
  }
  await saveState(state)
  return state
}

/** 跑完整条流水线。抛错只发生在「连识题都没跑起来」这种情况,其余都记进 state */
export async function runPipeline(state: LessonState, input: LessonInput, hooks: PipelineHooks = {}): Promise<LessonState> {
  const note = (text: string): void => hooks.onNote?.(text)
  try {
    if (!hasBailianKey()) throw new Error('没读到百炼 key,识题与出剧本都跑不了')
    const port = chatPort()

    // ---------------- 1. 识题 ----------------
    await startStage(state, 'recognizing')
    const dataUrls = input.images.map((img) => `data:${mime(img.ext)};base64,${img.bytes.toString('base64')}`)
    const recognized = await recognizeKeypoints(
      port,
      { images: dataUrls, answerText: input.answer, problemText: input.problemText },
      {
        timeoutMs: TIMEOUT_QWEN_MS,
        onAttempt: (info) =>
          void logCall(state.id, {
            kind: `recognize#${info.attempt + 1}`,
            ms: info.ms,
            ok: info.ok,
            messages: info.messages,
            response: info.raw,
            error: info.error
          })
      }
    )
    const keypoints: Keypoints = recognized.keypoints
    state.keypoints = keypoints
    const recognizeMs = await endStage(state, 'recognizing', `${keypoints.outline.length} 步骨架`)
    note(`识题完成 ${(recognizeMs / 1000).toFixed(1)} s;模板候选 ${keypoints.template.id}(${keypoints.template.confidence})`)

    // ---------------- 2. 规划 ----------------
    await startStage(state, 'planning')
    const plan = await planBoardScript(port, {
      keypoints,
      imageUrls: state.input.images,
      timeoutMs: TIMEOUT_QWEN_MS,
      onCall: (info) => void logCall(state.id, { kind: info.label, ms: info.ms, ok: true, messages: info.messages, response: info.raw })
    })
    const planningMs = await endStage(state, 'planning')
    note(`规划完成 ${(planningMs / 1000).toFixed(1)} s`)

    // ---------------- 3. 出剧本 + 校验 ----------------
    await startStage(state, 'scripting')
    const finalized = await finalizeBoardScript(
      port,
      plan.parsed,
      {
        problemText: keypoints.source.problemText,
        answerText: input.answer,
        images: state.input.images,
        templates: ANIMATION_TEMPLATES
      },
      {
        messages: plan.messages,
        timeoutMs: TIMEOUT_QWEN_MS,
        onCall: (info) => void logCall(state.id, { kind: info.label, ms: info.ms, ok: true, messages: info.messages, response: info.raw })
      }
    )
    const script = finalized.script
    state.script = script
    state.validation = { errors: finalized.errors, warnings: finalized.warnings }
    const scriptingMs = await endStage(state, 'scripting', `${finalized.errors.length} 错 / ${finalized.warnings.length} 警`)
    note(
      `出剧本完成 ${(scriptingMs / 1000).toFixed(1)} s(${finalized.attempts > 1 ? '触发重写,2 轮' : '一轮过'});校验 ${
        finalized.errors.length
      } 错 ${finalized.warnings.length} 警(自动修正 ${finalized.warnings.filter((w) => w.startsWith('已自动修正')).length} 条)`
    )
    await logCall(state.id, {
      kind: 'validation',
      ok: finalized.errors.length === 0,
      extra: { errors: finalized.errors, warnings: finalized.warnings, attempts: finalized.attempts }
    })

    // 剧本就绪 → web 可以开讲
    emit(state.id, { type: 'script', script })

    // ---------------- 4. 素材并行 ----------------
    await startStage(state, 'assets')
    const results = await Promise.allSettled([
      buildFigures(state, script, note),
      buildAnimations(state, script, port, note),
      buildAudio(state, script, note)
    ])
    for (const r of results) if (r.status === 'rejected') note(`素材任务异常:${redact(r.reason, 160)}`)
    const assetsMs = await endStage(state, 'assets')
    note(`素材完成 ${(assetsMs / 1000).toFixed(1)} s`)

    state.stage = 'ready'
    state.timings.ready = { startedAt: new Date().toISOString(), endedAt: new Date().toISOString(), ms: 0 }
    await saveState(state)
    emit(state.id, { type: 'stage', stage: 'ready', status: 'done' })
    emit(state.id, { type: 'complete' })
    return state
  } catch (error) {
    await failLesson(state, error)
    return state
  }
}

// ---------------- 情境图 ----------------

async function buildFigures(state: LessonState, script: BoardScript, note: (t: string) => void): Promise<void> {
  const scenes = script.figures.filter((f) => f.kind === 'scene')
  for (const fig of script.figures) {
    if (fig.kind === 'diagram') {
      fig.status = 'ready'
      emit(state.id, { type: 'figure', id: fig.id, status: 'ready' })
    }
  }
  if (!scenes.length) return
  if (!hasSeedreamKey()) {
    for (const fig of scenes) {
      fig.status = 'failed'
      fig.error = '没读到生图 key'
      emit(state.id, { type: 'figure', id: fig.id, status: 'failed', error: fig.error })
    }
    await saveState(state)
    return
  }
  await mkdir(join(lessonDir(state.id), 'figures'), { recursive: true })
  await Promise.all(
    scenes.map(async (fig) => {
      try {
        const dest = join(lessonDir(state.id), 'figures', `${fig.id}.jpg`)
        const result = await generateFigure(fig.prompt ?? '', dest)
        fig.src = `/assets/${state.id}/figures/${fig.id}.jpg`
        fig.status = 'ready'
        emit(state.id, { type: 'figure', id: fig.id, status: 'ready', src: fig.src })
        note(`情境图 ${fig.id} ${result.fromCache ? '命中缓存' : `生成 ${(result.ms / 1000).toFixed(1)} s`}${result.actualSize ? ` ${result.actualSize}` : ''}`)
      } catch (error) {
        fig.status = 'failed'
        fig.error = redact(error, 200)
        emit(state.id, { type: 'figure', id: fig.id, status: 'failed', error: fig.error })
        note(`情境图 ${fig.id} 失败:${fig.error}`)
      }
      await saveState(state)
    })
  )
}

// ---------------- 动画 ----------------

export interface AnimationOutcome {
  id: string
  kind: string
  path: string
  attempts: number
  ms: number
  issues: string[]
}

async function buildAnimations(state: LessonState, script: BoardScript, port: ChatPort, note: (t: string) => void): Promise<void> {
  for (const anim of script.animations) {
    if (isAnimationReady(anim)) {
      anim.status = 'ready'
      emit(state.id, { type: 'animation', id: anim.id, status: 'ready', kind: anim.kind, svg: anim.svg })
      note(`动画 ${anim.id}:${anim.kind}${anim.template ? `(${anim.template})` : ''} 直接就绪`)
      continue
    }
    try {
      const result = await buildHtmlAnimation(port, {
        purpose: anim.purpose,
        actionNames: usedActionNames(script, anim.id),
        problemText: script.problem.text,
        answerText: script.problem.answer,
        timeoutMs: TIMEOUT_QWEN_MS,
        onCall: (info) => void logCall(state.id, { kind: info.label, ms: info.ms, ok: true, messages: info.messages, response: info.raw })
      })
      anim.kind = result.kind
      anim.status = 'ready'
      if (result.html) anim.html = result.html
      if (result.svg) anim.svg = result.svg
      if (result.issues.length) anim.error = redact(result.issues.join(';'), 400)
      // 动画是生成完才知道好坏的,把问题并进校验报告,run-problem / 调试面板看得到
      for (const issue of result.issues) {
        if (issue.includes('一次都没调用')) state.validation?.warnings.push(`动画 ${anim.id}:${issue}`)
      }
      emit(state.id, { type: 'animation', id: anim.id, status: 'ready', kind: result.kind, html: result.html, svg: result.svg })
      note(
        `动画 ${anim.id}:${result.path}(${result.attempts} 次生成,${(result.ms / 1000).toFixed(1)} s)${
          result.issues.length ? `;问题:${result.issues.slice(0, 2).join(' | ')}` : ''
        }`
      )
      await logCall(state.id, { kind: 'animation-result', ok: true, extra: { id: anim.id, path: result.path, attempts: result.attempts, issues: result.issues } })
    } catch (error) {
      anim.status = 'failed'
      anim.error = redact(error, 200)
      emit(state.id, { type: 'animation', id: anim.id, status: 'failed', error: anim.error })
      note(`动画 ${anim.id} 失败:${anim.error}`)
    }
    await saveState(state)
  }
}

// ---------------- 语音 ----------------

async function buildAudio(state: LessonState, script: BoardScript, note: (t: string) => void): Promise<void> {
  if (!hasBailianKey()) return
  const port = createBailianCosyVoicePort({ getKey: async () => bailianKey(), timeoutMs: TIMEOUT_COSYVOICE_MS })
  const result = await prerenderAudio(script, port, {
    lessonId: state.id,
    audioDir: join(lessonDir(state.id), 'audio'),
    onClip: (clip) => emit(state.id, { type: 'audio', key: clip.key, src: clip.src, durationMs: clip.durationMs, text: clip.text })
  })
  script.audio = { voice: result.voice, clips: result.clips }
  await saveState(state)
  note(
    `语音 ${result.rendered}/${result.total} 句,${(result.bytes / 1024 / 1024).toFixed(2)} MB,${(result.ms / 1000).toFixed(1)} s${
      result.failed ? `;失败 ${result.failed} 句` : ''
    }`
  )
}
