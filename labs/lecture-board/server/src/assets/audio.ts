/**
 * CosyVoice 逐句预渲染:剧本里每一句会念出来的话 → 一个 mp3 文件。
 * key 方案见 audio-keys.ts(protocol.md「音频 key」);合成前经 speak-text 规范化,
 * 但 clip.text 存的是**原文**(播放器拿原文比对,老师改词后旧音频自动失效)。
 * 串行合成(同一条 WebSocket 复用),一句失败只丢那一句,不影响其它。
 */
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { AudioClip, BoardScript } from '../../../shared/schema'
import { BAILIAN_TTS_DEFAULT_VOICE, BAILIAN_TTS_VOICE_NAME, redact } from '../config'
import { audioFileName, audioUrl, collectUtterances } from '../audio-keys'
import type { TtsPort } from '../ports'
import { toSpeakText } from '../tts/speak-text'

export interface PrerenderOptions {
  lessonId: string
  audioDir: string
  voiceId?: string
  voiceName?: string
  onClip?: (clip: { key: string; text: string; src: string; durationMs?: number }) => void
  onError?: (info: { key: string; error: string }) => void
}

export interface PrerenderResult {
  voice: { provider: string; voiceId: string; name: string }
  clips: Record<string, AudioClip>
  total: number
  rendered: number
  failed: number
  bytes: number
  ms: number
}

export async function prerenderAudio(script: BoardScript, port: TtsPort, o: PrerenderOptions): Promise<PrerenderResult> {
  const started = Date.now()
  const voiceId = o.voiceId ?? BAILIAN_TTS_DEFAULT_VOICE
  const utterances = collectUtterances(script)
  const clips: Record<string, AudioClip> = {}
  let rendered = 0
  let failed = 0
  let bytes = 0

  for (const u of utterances) {
    try {
      const result = await port.synthesize(toSpeakText(u.text), { voiceId })
      const file = join(o.audioDir, audioFileName(u.key))
      await writeFile(file, result.bytes)
      const clip: AudioClip = { text: u.text, src: audioUrl(o.lessonId, u.key) }
      if (Number.isFinite(result.durationMs)) clip.durationMs = Math.round(result.durationMs as number)
      clips[u.key] = clip
      rendered++
      bytes += result.bytes.length
      o.onClip?.({ key: u.key, text: u.text, src: clip.src, durationMs: clip.durationMs })
    } catch (error) {
      failed++
      o.onError?.({ key: u.key, error: redact(error, 160) })
    }
  }

  port.close?.()
  return {
    voice: { provider: port.id, voiceId, name: o.voiceName ?? BAILIAN_TTS_VOICE_NAME },
    clips,
    total: utterances.length,
    rendered,
    failed,
    bytes,
    ms: Date.now() - started
  }
}
