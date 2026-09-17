/**
 * HTTP + SSE 服务(端点形状严格按 protocol.md,另加两个首页用的小接口 —— 见文末)。
 *   POST /api/lessons                    multipart:images[] + answer + problemText → { id },立即返回,后台跑流水线
 *   GET  /api/lessons/:id                LessonState
 *   GET  /api/lessons/:id/events         SSE
 *   GET  /api/lessons                    列表(首页课程库用,形状见 store.ts 的 LessonListItem)
 *   GET  /assets/:lessonId/*             静态素材
 *   GET  /api/health                     { ok, bailian, seedream }
 *   GET  /api/samples                    首页「一键试讲」示例题列表(见 samples.ts)
 *   POST /api/lessons/from-sample/:dir   用某道示例题的图 + 答案.md 走同一条上传流水线 → { id }
 *   GET  /samples/:dir/*                 示例题目录的静态托管(题目图)
 */
import { readFile } from 'node:fs/promises'
import { mkdir } from 'node:fs/promises'
import cors from '@fastify/cors'
import multipart from '@fastify/multipart'
import fastifyStatic from '@fastify/static'
import Fastify from 'fastify'
import { LESSONS_ROOT, PORT, hasBailianKey, hasSeedreamKey, redact } from './config'
import { createLesson, runPipeline, type LessonInput } from './pipeline'
import { listSamples, loadSampleInput, SAMPLES_ROOT } from './samples'
import { listLessons, loadState, newLessonId, reapInterruptedLessons, subscribe, type ServerEvent } from './store'
import { sniffImageExt } from './upload'

const MAX_IMAGE_BYTES = 8 * 1024 * 1024
const MAX_IMAGES = 3

async function main(): Promise<void> {
  await mkdir(LESSONS_ROOT, { recursive: true })
  // 上次进程(比如 tsx watch 重载、或者直接被杀)留下的半成品 lesson:标 failed 并给原因,
  // 不然前端会对着一个再也不会推进的 stage 干等(运行问题复查 2026-09-17)
  const reaped = await reapInterruptedLessons()
  const app = Fastify({ logger: { level: 'info', transport: undefined } })

  await app.register(cors, { origin: true })
  await app.register(multipart, { limits: { fileSize: MAX_IMAGE_BYTES, files: MAX_IMAGES } })
  await app.register(fastifyStatic, { root: LESSONS_ROOT, prefix: '/assets/', decorateReply: false })
  await app.register(fastifyStatic, { root: SAMPLES_ROOT, prefix: '/samples/', decorateReply: false })

  app.get('/api/health', async () => ({ ok: true, bailian: hasBailianKey(), seedream: hasSeedreamKey() }))

  app.get('/api/lessons', async () => listLessons())

  app.post('/api/lessons', async (request, reply) => {
    const images: LessonInput['images'] = []
    let answer = ''
    let problemText = ''
    try {
      for await (const part of request.parts()) {
        if (part.type === 'file') {
          const bytes = await part.toBuffer()
          if (!bytes.length) continue
          // 按文件头字节判断类型,不信文件名后缀(后缀是客户端随便写的;运行问题复查 2026-09-17)
          const sniffed = sniffImageExt(bytes)
          if (!sniffed) {
            return reply.code(400).send({ error: '文件内容不是可识别的图片(按文件头判断,不看文件名):只收 png / jpg / webp' })
          }
          images.push({ bytes, ext: sniffed })
        } else if (part.fieldname === 'answer') answer = String(part.value ?? '').trim()
        else if (part.fieldname === 'problemText') problemText = String(part.value ?? '').trim()
      }
    } catch (error) {
      return reply.code(400).send({ error: redact(error, 200) })
    }
    if (!images.length) return reply.code(400).send({ error: '至少上传一张题目截图' })
    if (images.length > MAX_IMAGES) return reply.code(400).send({ error: `最多 ${MAX_IMAGES} 张截图` })
    if (!answer) return reply.code(400).send({ error: 'answer 必填:答案是这道题的 ground truth' })

    const input: LessonInput = { id: newLessonId(), images, answer, problemText: problemText || undefined }
    const state = await createLesson(input)
    // 立即返回,后台跑
    void runPipeline(state, input).catch((error) => app.log.error({ err: redact(error) }, '流水线异常'))
    return reply.code(201).send({ id: state.id })
  })

  // 首页「示例题目 · 一键试讲」:列表见 samples.ts(扫 ../题目/*/)
  app.get('/api/samples', async () => listSamples())

  // 用某道示例题的图 + 答案.md 全文,走跟 POST /api/lessons 完全一样的 createLesson/runPipeline
  app.post<{ Params: { dir: string } }>('/api/lessons/from-sample/:dir', async (request, reply) => {
    const dir = decodeURIComponent(request.params.dir)
    const sample = await loadSampleInput(dir)
    if (!sample) return reply.code(404).send({ error: `没有这道示例题:${dir}` })
    if (!sample.answerText) return reply.code(400).send({ error: `示例题缺少答案文本:${dir}/答案.md` })

    const bytes = await readFile(sample.imagePath)
    const input: LessonInput = {
      id: newLessonId(),
      images: [{ bytes, ext: sample.imageExt }],
      answer: sample.answerText
    }
    const state = await createLesson(input)
    void runPipeline(state, input).catch((error) => app.log.error({ err: redact(error) }, '流水线异常(示例题)'))
    return reply.code(201).send({ id: state.id })
  })

  app.get<{ Params: { id: string } }>('/api/lessons/:id', async (request, reply) => {
    const state = await loadState(request.params.id)
    if (!state) return reply.code(404).send({ error: '没有这个 lesson' })
    return state
  })

  app.get<{ Params: { id: string } }>('/api/lessons/:id/events', async (request, reply) => {
    const state = await loadState(request.params.id)
    if (!state) return reply.code(404).send({ error: '没有这个 lesson' })

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    })
    const send = (event: ServerEvent): void => {
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`)
    }
    send({ type: 'snapshot', state })
    if (state.stage === 'ready') send({ type: 'complete' })

    const unsubscribe = subscribe(request.params.id, send)
    const heartbeat = setInterval(() => reply.raw.write(': ping\n\n'), 15_000)
    request.raw.on('close', () => {
      clearInterval(heartbeat)
      unsubscribe()
    })
    return reply
  })

  await app.listen({ port: PORT, host: '127.0.0.1' })
  app.log.info(
    `讲题白板 server :${PORT} —— 百炼 key ${hasBailianKey() ? '已读到' : '缺失'},生图 key ${hasSeedreamKey() ? '已读到' : '缺失'}`
  )
  if (reaped.length) app.log.warn(`启动时把 ${reaped.length} 个未完成的 lesson 标了 failed:${reaped.join('、')}`)
}

main().catch((error) => {
  console.error('server 起不来:', redact(error))
  process.exit(1)
})
