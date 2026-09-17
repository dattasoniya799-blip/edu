import { describe, expect, it } from 'vitest'
import { recognizeKeypoints } from '../src/recognize'
import type { ChatMessage, ChatPort } from '../src/ports'
import { BoardValidationError } from '../src/validate'

/**
 * 运行问题复查(2026-09-17)· 错误路径:Qwen 识题返回非 JSON / 两次都不合格,不打真接口。
 */
function fakePort(replies: Array<string | Error>, supportsVision = true): ChatPort {
  let i = 0
  return {
    id: 'fake',
    supportsVision,
    async complete(_messages: ChatMessage[]): Promise<string> {
      const reply = replies[Math.min(i, replies.length - 1)]
      i++
      if (reply instanceof Error) throw reply
      return reply
    }
  }
}

const GOOD_KEYPOINTS_JSON = JSON.stringify({
  problemText: '题干',
  analysis: { given: ['V=1'], hidden: [], find: ['求压强'], ideas: ['考点定位'], marks: [] },
  outline: [
    { id: 'o1', title: '第一步', idea: '算压强', result: '600 Pa' },
    { id: 'o2', title: '第二步', idea: '核对', result: '600 Pa' }
  ],
  takeaways: { knowledge: ['压强'], keyPoints: [], methods: [], variants: [] },
  template: { id: 'board-steps', reason: 'x', confidence: 'low' }
})

describe('recognizeKeypoints · 非 JSON / 坏 JSON 触发一次修复轮', () => {
  it('第一次非 JSON,第二次合格 → 用第二次的结果,attempts=2', async () => {
    const port = fakePort(['这不是 JSON', GOOD_KEYPOINTS_JSON])
    const result = await recognizeKeypoints(port, { images: [], answerText: '(1)600 Pa', problemText: '题干' })
    expect(result.attempts).toBe(2)
    expect(result.keypoints.source.problemText).toBe('题干')
  })

  it('两次都不合格 → 抛出清楚的错误(不是裸的 SyntaxError)', async () => {
    const port = fakePort(['不是 JSON', '还是不是 JSON'])
    await expect(recognizeKeypoints(port, { images: [], answerText: '(1)x', problemText: '题干' })).rejects.toThrow(
      /识题两次都没得到合格的要点卡/
    )
  })

  it('缺 outline 字段(结构不对但是合法 JSON)也会触发修复轮', async () => {
    const port = fakePort(['{"problemText":"题干"}', GOOD_KEYPOINTS_JSON])
    const result = await recognizeKeypoints(port, { images: [], answerText: '(1)600 Pa', problemText: '题干' })
    expect(result.attempts).toBe(2)
  })

  it('模型请求超时(非 BoardValidationError/SyntaxError)→ 直接冒泡,不重试、不吞掉', async () => {
    const port = fakePort([new Error('模型请求超时(180000 ms)')])
    await expect(recognizeKeypoints(port, { images: [], answerText: '(1)x', problemText: '题干' })).rejects.toThrow('超时')
  })

  it('不支持视觉的模型 + 传了图片 → 在真正调用模型之前就报错', async () => {
    const port = fakePort([GOOD_KEYPOINTS_JSON], false)
    await expect(
      recognizeKeypoints(port, { images: ['data:image/png;base64,AAAA'], answerText: '(1)x' })
    ).rejects.toThrow(/不支持图片/)
  })
})

describe('recognizeKeypoints · 输入校验(不打模型就先拒绝)', () => {
  it('没图也没题干文字 → 报错', async () => {
    const port = fakePort([GOOD_KEYPOINTS_JSON])
    await expect(recognizeKeypoints(port, { images: [], answerText: '(1)x' })).rejects.toThrow(/上传题目截图|题干文字/)
  })
  it('答案为空 → 报错', async () => {
    const port = fakePort([GOOD_KEYPOINTS_JSON])
    await expect(recognizeKeypoints(port, { images: [], answerText: '', problemText: '题干' })).rejects.toThrow(/答案/)
  })
})
