import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { prerenderAudio } from '../src/assets/audio'
import type { TtsPort, TtsSynthesizeOptions, TtsSynthesizeResult } from '../src/ports'
import type { BoardScript } from '../../shared/schema'

/**
 * 运行问题复查(2026-09-17)· 错误路径:CosyVoice 合成失败,不打真接口,假 TtsPort 注入。
 * 覆盖 protocol.md「一句失败只丢那一句,不影响其它」那条隔离纪律。
 */

const dirs: string[] = []
afterEach(async () => {
  while (dirs.length) await rm(dirs.pop()!, { recursive: true, force: true })
})

function makeScript(): BoardScript {
  return {
    version: 2,
    title: '压强',
    subject: 'physics',
    summary: 'x',
    problem: { text: '题干', images: [], answer: '(1)600 Pa' },
    analysis: { given: [], hidden: [], find: [], ideas: [], marks: [] },
    columns: [{ id: 'c1', title: '第(1)问', phase: 'solve', subq: 1 }],
    cards: [{ id: 'k1', col: 'c1', kind: 'board', lines: [{ id: 'l1', kind: 'text', text: '一句板书' }] }],
    figures: [],
    animations: [],
    steps: [
      {
        id: 's1',
        title: '压强',
        col: 'c1',
        flow: [
          { say: '第一句,会合成成功。' },
          { say: '第二句,会合成失败。' },
          { say: '第三句,紧接着上一句之后,应该不受影响。' }
        ]
      }
    ],
    takeaways: { knowledge: [], pitfalls: [], methods: [], variants: [] }
  }
}

/** 假 TtsPort:文本里带「失败」就抛错,其余正常返回一段假 mp3 字节 */
function flakyTtsPort(): TtsPort {
  return {
    id: 'fake-tts',
    async synthesize(text: string, _o: TtsSynthesizeOptions): Promise<TtsSynthesizeResult> {
      if (text.includes('失败')) throw new Error('百炼语音合成失败:模拟的上游错误')
      return { mime: 'audio/mpeg', bytes: new Uint8Array([1, 2, 3]) }
    }
  }
}

describe('prerenderAudio · 一句失败不拖垮其它句', () => {
  it('中间一句合成失败,前后两句仍然成功,总数对得上', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lecture-audio-'))
    dirs.push(dir)
    const script = makeScript()
    const errors: Array<{ key: string; error: string }> = []
    const result = await prerenderAudio(script, flakyTtsPort(), {
      lessonId: 'test',
      audioDir: dir,
      onError: (info) => errors.push(info)
    })
    expect(result.total).toBe(3)
    expect(result.rendered).toBe(2)
    expect(result.failed).toBe(1)
    expect(errors).toHaveLength(1)
    expect(errors[0].key).toBe('steps.s1.flow.1')
  })

  it('全部句子都失败 → rendered=0,不抛出未捕获异常', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lecture-audio-'))
    dirs.push(dir)
    const script = makeScript()
    const allFail: TtsPort = {
      id: 'fake-tts',
      async synthesize(): Promise<TtsSynthesizeResult> {
        throw new Error('全部失败')
      }
    }
    const result = await prerenderAudio(script, allFail, { lessonId: 'test', audioDir: dir })
    expect(result.rendered).toBe(0)
    expect(result.failed).toBe(result.total)
    expect(result.clips).toEqual({})
  })

  it('port.close() 会被调用(不管成功还是失败都要收尾连接)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lecture-audio-'))
    dirs.push(dir)
    let closed = false
    const port: TtsPort = {
      id: 'fake-tts',
      async synthesize(): Promise<TtsSynthesizeResult> {
        throw new Error('boom')
      },
      close() {
        closed = true
      }
    }
    await prerenderAudio(makeScript(), port, { lessonId: 'test', audioDir: dir })
    expect(closed).toBe(true)
  })
})
