import { describe, expect, it } from 'vitest'
import { sniffImageExt } from '../src/upload'

/**
 * 运行问题复查(2026-09-17)· 安全:上传文件类型按魔数(文件头字节)判断,不看文件名后缀
 * ——把任意文件改名成 .png 上传,老校验(只看文件名)照样会收。
 */
describe('sniffImageExt · 按文件头字节判断图片类型', () => {
  it('PNG 头(89 50 4E 47 0D 0A 1A 0A)→ png', () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
    expect(sniffImageExt(bytes)).toBe('png')
  })

  it('JPEG 头(FF D8 FF)→ jpg', () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0])
    expect(sniffImageExt(bytes)).toBe('jpg')
  })

  it('WEBP 头(RIFF….WEBP)→ webp', () => {
    const bytes = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])
    expect(sniffImageExt(bytes)).toBe('webp')
  })

  it('文件名写成 .png 但内容是别的东西(如脚本 / 文本)→ undefined', () => {
    const fakeScript = new TextEncoder().encode('#!/bin/sh\necho pwned\n')
    expect(sniffImageExt(fakeScript)).toBeUndefined()
    const html = new TextEncoder().encode('<html><body>not an image</body></html>')
    expect(sniffImageExt(html)).toBeUndefined()
  })

  it('RIFF 但不是 WEBP(比如 WAV)→ undefined', () => {
    const wav = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45])
    expect(sniffImageExt(wav)).toBeUndefined()
  })

  it('太短的文件 → undefined,不越界读', () => {
    expect(sniffImageExt(new Uint8Array([0x89, 0x50]))).toBeUndefined()
    expect(sniffImageExt(new Uint8Array())).toBeUndefined()
  })
})
