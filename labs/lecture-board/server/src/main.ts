/**
 * HTTP + SSE 服务(端点形状严格按 protocol.md)。
 *   POST /api/lessons            multipart:images[] + answer + problemText → { id },立即返回,后台跑流水线
 *   GET  /api/lessons/:id        LessonState
 *   GET  /api/lessons/:id/events SSE
 *   GET  /api/lessons            列表(调试)
 *   GET  /assets/:lessonId/*     静态素材
 *   GET  /api/health             { ok: true }
 */
import { mkdir } from 'node:fs/promises'
import cors from '@fastify/cors'
import multipart from '@fastify/multipart'
import fastifyStatic from '@fastify/static'
import Fastify from 'fastify'
import { LESSONS_ROOT, PORT, hasBailianKey, hasSeedreamKey, redact } from './config'
import { createLesson, runPipeline, type LessonInput } from './pipeline'
import { listLessons, loadState, newLessonId, subscribe, type ServerEvent } from './store'

const MAX_IMAGE_BYTES = 8 * 1024 * 1024
const MAX_IMAGES = 3

async function main(): Promise<void> {
  await mkdir(LESSONS_ROOT, { recursive: true })
  const app = Fastify({ logger: { level: 'info', transport: undefined } })

  await app.register(cors, { origin: true })
  await app.register(multipart, { limits: { fileSize: MAX_IMAGE_BYTES, files: MAX_IMAGES } })
  await app.register(fastifyStatic, { root: LESSONS_ROOT, prefix: '/assets/', decorateReply: false })

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
          const ext = (part.filename?.split('.').pop() ?? 'png').toLowerCase().replace(/[^a-z0-9]/g, '') || 'png'
          if (!['png', 'jpg', 'jpeg', 'webp'].includes(ext)) {
            return reply.code(400).send({ error: `只收 png / jpg / webp,收到 .${ext}` })
          }
          images.push({ bytes, ext: ext === 'jpeg' ? 'jpg' : ext })
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
}

main().catch((error) => {
  console.error('server 起不来:', redact(error))
  process.exit(1)
})
