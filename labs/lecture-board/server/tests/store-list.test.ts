import { rm } from 'node:fs/promises'
import { afterEach, describe, expect, it } from 'vitest'
import type { LessonState } from '../../shared/schema'
import { lessonDir, listLessons, saveState } from '../src/store'

const TEST_IDS: string[] = []

function makeState(patch: Partial<LessonState> & { id: string }): LessonState {
  return {
    id: patch.id,
    createdAt: patch.createdAt ?? new Date().toISOString(),
    stage: patch.stage ?? 'uploaded',
    timings: patch.timings ?? {},
    input: patch.input ?? { images: [], answer: '(1)测试答案' },
    script: patch.script,
    validation: patch.validation,
    error: patch.error
  }
}

afterEach(async () => {
  while (TEST_IDS.length) {
    const id = TEST_IDS.pop()!
    await rm(lessonDir(id), { recursive: true, force: true })
  }
})

describe('listLessons() 扩充字段(首页课程库用,非 shared 契约)', () => {
  it('script 就绪的课带 subject/thumb/summary', async () => {
    const id = `test-listlessons-ready-${Date.now()}`
    TEST_IDS.push(id)
    await saveState(
      makeState({
        id,
        stage: 'ready',
        input: { images: ['/assets/x/input/1.jpg'], answer: '(1)600 Pa' },
        script: {
          version: 2,
          title: '潜艇模型:压强浮力功',
          subject: 'physics',
          summary: '压强、浮力、做功三问。',
          problem: { text: '题干', images: ['/assets/x/input/1.jpg'], answer: '(1)600 Pa' },
          analysis: { given: [], hidden: [], find: [], ideas: [], marks: [] },
          columns: [],
          cards: [],
          figures: [],
          animations: [],
          steps: [],
          takeaways: { knowledge: [], pitfalls: [], methods: [], variants: [] }
        }
      })
    )

    const list = await listLessons()
    const item = list.find((l) => l.id === id)
    expect(item).toBeDefined()
    expect(item?.subject).toBe('physics')
    expect(item?.thumb).toBe('/assets/x/input/1.jpg')
    expect(item?.summary).toBe('压强、浮力、做功三问。')
    expect(item?.title).toBe('潜艇模型:压强浮力功')
    expect(item?.stage).toBe('ready')
  })

  it('还没出剧本的课:subject/summary 缺省,但 thumb 已经有(首图上传时就写了)', async () => {
    const id = `test-listlessons-pending-${Date.now()}`
    TEST_IDS.push(id)
    await saveState(makeState({ id, stage: 'recognizing', input: { images: ['/assets/y/input/1.png'], answer: '(1)答案' } }))

    const list = await listLessons()
    const item = list.find((l) => l.id === id)
    expect(item).toBeDefined()
    expect(item?.subject).toBeUndefined()
    expect(item?.summary).toBeUndefined()
    expect(item?.thumb).toBe('/assets/y/input/1.png')
    expect(item?.stage).toBe('recognizing')
  })

  it('按 createdAt 倒序', async () => {
    const older = `test-listlessons-older-${Date.now()}`
    const newer = `test-listlessons-newer-${Date.now() + 1}`
    TEST_IDS.push(older, newer)
    await saveState(makeState({ id: older, createdAt: new Date(Date.now() - 60_000).toISOString() }))
    await saveState(makeState({ id: newer, createdAt: new Date().toISOString() }))

    const list = await listLessons()
    const iOlder = list.findIndex((l) => l.id === older)
    const iNewer = list.findIndex((l) => l.id === newer)
    expect(iNewer).toBeLessThan(iOlder)
  })
})
