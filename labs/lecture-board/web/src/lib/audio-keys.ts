/**
 * 音频 key 推导 + clip 可用性判定。
 * 口径全部来自 shared/protocol.md「音频 key」一节,改动必须先改协议。
 */
import type { AudioClip, BoardScript, TakeawayGroup } from '../types';

/** 第 i 个 flow 项(0 起,按 flow 数组下标,不是 say 的序号)。 */
export function stepFlowKey(stepId: string, flowIndex: number): string {
  return `steps.${stepId}.flow.${flowIndex}`;
}

/** formula 行的 speech。 */
export function lineSpeechKey(cardId: string, lineId: string): string {
  return `cards.${cardId}.lines.${lineId}`;
}

/** table 卡的 speech。 */
export function cardSpeechKey(cardId: string): string {
  return `cards.${cardId}.speech`;
}

export function takeawayKey(group: TakeawayGroup, index: number): string {
  return `takeaways.${group}.${index}`;
}

export const TAKEAWAY_GROUPS: TakeawayGroup[] = ['knowledge', 'pitfalls', 'methods', 'variants'];

/** 组名前缀,只加在每组首条前面(protocol.md)。 */
export const TAKEAWAY_GROUP_LEAD: Record<TakeawayGroup, string> = {
  knowledge: '核心知识点。',
  pitfalls: '考点与易错。',
  methods: '方法与技巧。',
  variants: '举一反三。',
};

/** 总结条目的显示标题(白板四色块的块名)。 */
export const TAKEAWAY_GROUP_TITLE: Record<TakeawayGroup, string> = {
  knowledge: '核心知识点',
  pitfalls: '考点与易错',
  methods: '方法与技巧',
  variants: '举一反三',
};

/** 口播文本 = 去掉【】的条目,首条前加组名。 */
export function takeawaySpeechText(group: TakeawayGroup, item: string, index: number): string {
  const plain = item.replace(/[【】]/g, '');
  return index === 0 ? TAKEAWAY_GROUP_LEAD[group] + plain : plain;
}

/**
 * clip 可用判定:key 命中且 clip.text 与实际口播文本逐字相同才用预渲染音频,
 * 否则返回 null → 播放器回退浏览器 Web Speech。
 */
export function pickClip(audio: BoardScript['audio'] | undefined, key: string, text: string): AudioClip | null {
  const clip = audio?.clips?.[key];
  if (!clip || !clip.src) return null;
  return clip.text === text ? clip : null;
}
