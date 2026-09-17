/**
 * mp3 时长:逐帧解析 MPEG 音频帧头,累加每帧采样数 / 采样率(CBR、VBR 都对)。
 * 解析不出(不是 mp3、没有一个合法帧)返回 undefined,播放器用 <audio>.duration 兜底。
 * 纯函数,无依赖。
 */

const BITRATES: Record<string, number[]> = {
  // [MPEG-1 | MPEG-2/2.5]-[layer]:kbps,索引 0 = free,15 = 非法
  '1-1': [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
  '1-2': [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
  '1-3': [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  '2-1': [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
  '2-2': [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
  '2-3': [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160]
}
const SAMPLE_RATES: Record<number, number[]> = {
  0b11: [44100, 48000, 32000], // MPEG-1
  0b10: [22050, 24000, 16000], // MPEG-2
  0b00: [11025, 12000, 8000] // MPEG-2.5
}

interface FrameInfo {
  size: number
  samples: number
  sampleRate: number
  /** 帧内 side info 之后的偏移(Xing/Info 标记位置) */
  sideInfoEnd: number
}

function parseFrame(buf: Uint8Array, at: number): FrameInfo | null {
  if (at + 4 > buf.length) return null
  const b1 = buf[at + 1]
  if (buf[at] !== 0xff || (b1 & 0xe0) !== 0xe0) return null
  const versionBits = (b1 >> 3) & 0b11
  if (versionBits === 0b01) return null // reserved
  const layerBits = (b1 >> 1) & 0b11
  if (layerBits === 0b00) return null // reserved
  const layer = layerBits === 0b11 ? 1 : layerBits === 0b10 ? 2 : 3
  const b2 = buf[at + 2]
  const bitrateIndex = b2 >> 4
  if (bitrateIndex === 0 || bitrateIndex === 15) return null // free / bad
  const rateIndex = (b2 >> 2) & 0b11
  if (rateIndex === 0b11) return null
  const isMpeg1 = versionBits === 0b11
  const bitrate = BITRATES[`${isMpeg1 ? 1 : 2}-${layer}`][bitrateIndex] * 1000
  const sampleRate = SAMPLE_RATES[versionBits][rateIndex]
  const padding = (b2 >> 1) & 1
  const mono = ((buf[at + 3] >> 6) & 0b11) === 0b11
  let samples: number
  let size: number
  if (layer === 1) {
    samples = 384
    size = (Math.floor((12 * bitrate) / sampleRate) + padding) * 4
  } else {
    samples = layer === 2 ? 1152 : isMpeg1 ? 1152 : 576
    size = Math.floor(((samples / 8) * bitrate) / sampleRate) + padding
  }
  if (size < 4) return null
  const sideInfo = layer === 3 ? (isMpeg1 ? (mono ? 17 : 32) : mono ? 9 : 17) : 0
  return { size, samples, sampleRate, sideInfoEnd: 4 + sideInfo }
}

function skipId3v2(buf: Uint8Array): number {
  if (buf.length < 10 || buf[0] !== 0x49 || buf[1] !== 0x44 || buf[2] !== 0x33) return 0
  const size = ((buf[6] & 0x7f) << 21) | ((buf[7] & 0x7f) << 14) | ((buf[8] & 0x7f) << 7) | (buf[9] & 0x7f)
  const footer = buf[5] & 0x10 ? 10 : 0
  return 10 + size + footer
}

function hasTag(buf: Uint8Array, at: number, tag: string): boolean {
  if (at + tag.length > buf.length) return false
  for (let i = 0; i < tag.length; i++) if (buf[at + i] !== tag.charCodeAt(i)) return false
  return true
}

/** 解析整段 mp3 的时长(毫秒);失败返回 undefined */
export function mp3DurationMs(bytes: Uint8Array): number | undefined {
  if (!bytes || bytes.length < 4) return undefined
  let pos = skipId3v2(bytes)
  let seconds = 0
  let frames = 0
  let garbage = 0
  while (pos + 4 <= bytes.length) {
    const f = parseFrame(bytes, pos)
    if (!f) {
      // 帧间垃圾字节:逐字节找下一个同步字;垃圾太多说明根本不是 mp3
      pos++
      if (++garbage > 64 * 1024 && frames === 0) return undefined
      continue
    }
    // 第一帧若是 Xing / Info 信息帧(VBR 头),不计入时长
    const isInfo = frames === 0 && (hasTag(bytes, pos + f.sideInfoEnd, 'Xing') || hasTag(bytes, pos + f.sideInfoEnd, 'Info'))
    if (!isInfo) {
      seconds += f.samples / f.sampleRate
      frames++
    }
    pos += f.size
  }
  if (frames === 0) return undefined
  return Math.round(seconds * 1000)
}
