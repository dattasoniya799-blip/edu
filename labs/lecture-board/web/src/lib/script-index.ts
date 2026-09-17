/** 剧本的反查表:target(cardId | lineId | colId)→ 具体对象。 */
import type { Animation, BoardLine, BoardScript, Card, Column, Figure } from '../types';

export interface ScriptIndex {
  cards: Map<string, Card>;
  columns: Map<string, Column>;
  figures: Map<string, Figure>;
  animations: Map<string, Animation>;
  /** lineId → 所属卡 + 行本体 */
  lines: Map<string, { card: Extract<Card, { kind: 'board' }>; line: BoardLine }>;
  cardsByColumn: Map<string, Card[]>;
  /** animationId → 放它的那些卡(同一个动画可以在两列各放一张) */
  animationCards: Map<string, string[]>;
}

export function buildIndex(script: BoardScript): ScriptIndex {
  const idx: ScriptIndex = {
    cards: new Map(),
    columns: new Map(),
    figures: new Map(),
    animations: new Map(),
    lines: new Map(),
    cardsByColumn: new Map(),
    animationCards: new Map(),
  };
  for (const col of script.columns) {
    idx.columns.set(col.id, col);
    idx.cardsByColumn.set(col.id, []);
  }
  for (const card of script.cards) {
    idx.cards.set(card.id, card);
    const bucket = idx.cardsByColumn.get(card.col);
    if (bucket) bucket.push(card);
    else idx.cardsByColumn.set(card.col, [card]);
    if (card.kind === 'board') {
      for (const line of card.lines) idx.lines.set(line.id, { card, line });
    }
    if (card.kind === 'animation') {
      idx.animationCards.set(card.animationId, [...(idx.animationCards.get(card.animationId) ?? []), card.id]);
    }
  }
  for (const f of script.figures ?? []) idx.figures.set(f.id, f);
  for (const a of script.animations ?? []) idx.animations.set(a.id, a);
  return idx;
}

/** reveal 的 target 可能是卡也可能是板书行;行要先让它的卡浮现。 */
export function resolveRevealTargets(idx: ScriptIndex, target: string): string[] {
  const line = idx.lines.get(target);
  if (line) return [line.card.id, target];
  if (idx.cards.has(target)) return [target];
  return [target]; // 未知 target:原样记下,渲染层忽略(协议缺陷已记 ISSUES.md)
}

/** 某列是否开讲前就整列可见(审题列)。 */
export function isAlwaysVisibleColumn(col: Column | undefined): boolean {
  return col?.phase === 'analysis';
}
