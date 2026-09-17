/**
 * 音频 key(protocol.md「音频 key」):预渲染与播放器的共同约定,一字不能差。
 *   steps.<stepId>.flow.<i>           第 i 个 flow 项(0 起,按 flow 数组下标,不是 say 的序号)
 *   cards.<cardId>.lines.<lineId>     formula 行的 speech
 *   cards.<cardId>.speech             table 卡的 speech
 *   takeaways.<group>.<i>             总结四组;文本 = 去【】的条目,首条前加组名
 * 播放器拿 clip.text === 实际口播文本 判断能不能用,所以这里存的必须是「最终会念出来的那段字」。
 */
import type { BoardScript } from '../../shared/schema'

export interface Utterance {
  key: string
  text: string
}

/** 与 protocol.md 一致的组名与顺序 */
const TAKEAWAY_GROUPS: Array<{ key: keyof BoardScript['takeaways']; title: string }> = [
  { key: 'knowledge', title: '核心知识点' },
  { key: 'pitfalls', title: '考点与易错' },
  { key: 'methods', title: '方法与技巧' },
  { key: 'variants', title: '举一反三' }
]

export function collectUtterances(script: BoardScript): Utterance[] {
  const out: Utterance[] = []
  const push = (key: string, text: string): void => {
    const t = String(text ?? '').trim()
    if (t) out.push({ key, text: t })
  }

  for (const step of script.steps ?? []) {
    ;(step.flow ?? []).forEach((item, i) => {
      if (item && typeof (item as { say?: unknown }).say === 'string') {
        push(`steps.${step.id}.flow.${i}`, (item as { say: string }).say)
      }
    })
  }

  for (const card of script.cards ?? []) {
    if (card.kind === 'board') {
      for (const line of card.lines ?? []) {
        if (line.kind === 'formula' && line.speech) push(`cards.${card.id}.lines.${line.id}`, line.speech)
      }
    } else if (card.kind === 'table') {
      push(`cards.${card.id}.speech`, card.speech)
    }
  }

  const takeaways = script.takeaways ?? ({} as BoardScript['takeaways'])
  for (const group of TAKEAWAY_GROUPS) {
    const items = (takeaways[group.key] ?? []).filter(Boolean)
    items.forEach((item, i) => {
      const spoken = String(item).replace(/[【】]/g, '')
      push(`takeaways.${group.key}.${i}`, (i === 0 ? `${group.title}。` : '') + spoken)
    })
  }

  return out
}

/**
 * key → 落盘文件名。protocol 说「key 里的 `.` 原样(文件名允许)」,
 * 这里只把路径分隔符与控制字符换掉,避免 key 逃出 audio 目录。
 */
export function audioFileName(key: string): string {
  return `${String(key).replace(/[/\\:*?"<>|\u0000-\u001f]/g, '_')}.mp3`
}

/** /assets/<lessonId>/audio/<key>.mp3 */
export function audioUrl(lessonId: string, key: string): string {
  return `/assets/${lessonId}/audio/${audioFileName(key)}`
}
