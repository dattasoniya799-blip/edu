/**
 * 「讲到哪、亮到哪」的样式判定(protocol.md「播放器时序」第 2 条)。
 * 纯函数,不碰 excalidraw、不碰 DOM——卡片组件按 target 字符串查 speaking / kept 两个集合,
 * 拿到的 className 直接贴在对应元素上;circle 的画法在 board/ExcalidrawBoard.tsx(适配层)。
 */

export type Emph = 'mark' | 'circle';

/** 'card':整卡(左侧色条 + 卡纸微提亮);'mark':板书行/审题条目/题干片段(黄色马克笔底)。 */
export type HighlightVariant = 'card' | 'mark';

/**
 * target 此刻是「正在讲」还是「讲完留痕」,变成一个 className(都不是则空串)。
 * 同一个 target 不会同时出现在 speaking 与 kept 里(speak() 念完才会调 keep),
 * 但保险起见 speaking 优先。
 */
export function highlightClass(
  target: string,
  speaking: ReadonlySet<string>,
  kept: ReadonlyMap<string, Emph>,
  variant: HighlightVariant = 'mark',
): string {
  if (speaking.has(target)) return variant === 'card' ? 'hl-card-speaking' : 'hl-mark-speaking';
  if (kept.get(target) === 'mark') return variant === 'card' ? 'hl-card-kept' : 'hl-mark-kept';
  return '';
}
