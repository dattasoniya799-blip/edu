/**
 * 列布局(纯函数,不碰 excalidraw):列宽 445 / 列距 60 / 卡距 24,每列一个 nextY 游标。
 * 数值来自 OpenHyperKnow 量到的 HyperKnow 真机值(WhiteboardPage.tsx)。
 */

export const COL_W = 445;
export const COL_GAP = 60;
export const CARD_GAP = 24;
/** 列标题占的高度,卡从这儿往下排 */
export const BOARD_TOP = 60;

export interface CardPlacement {
  cardId: string;
  col: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ColumnPlacement {
  colId: string;
  x: number;
  y: number;
  /** 本列最后一张卡的底边(给 scrollToContent 与新卡定位用) */
  bottom: number;
}

export interface BoardLayout {
  columns: ColumnPlacement[];
  cards: CardPlacement[];
  byCard: Map<string, CardPlacement>;
}

/** 卡没量到真高之前的估高(按卡型给,量到后由 ResizeObserver 覆盖)。 */
export const DEFAULT_CARD_H = 200;

export function layoutBoard(
  columnIds: string[],
  visibleCardsByColumn: ReadonlyMap<string, string[]>,
  heights: ReadonlyMap<string, number>,
): BoardLayout {
  const columns: ColumnPlacement[] = [];
  const cards: CardPlacement[] = [];
  columnIds.forEach((colId, i) => {
    const x = i * (COL_W + COL_GAP);
    let y = BOARD_TOP;
    for (const cardId of visibleCardsByColumn.get(colId) ?? []) {
      const h = heights.get(cardId) ?? DEFAULT_CARD_H;
      cards.push({ cardId, col: colId, x, y, w: COL_W, h });
      y += h + CARD_GAP;
    }
    columns.push({ colId, x, y: 0, bottom: y });
  });
  const byCard = new Map(cards.map((c) => [c.cardId, c]));
  return { columns, cards, byCard };
}

/** 场景元素 id 约定(适配层内部用)。 */
export const elementIds = {
  card: (cardId: string) => `card-${cardId}`,
  /** 卡纸(米白底 + 手绘描边),画在 embeddable 之下 */
  paper: (cardId: string) => `paper-${cardId}`,
  colTitle: (colId: string) => `coltitle-${colId}`,
  colMark: (colId: string) => `colmark-${colId}`,
  fx: (uid: number) => `fx-${uid}`,
  /** emph:'circle' 留下的红圈(讲到哪、亮到哪),独立于 fx/clearFx 那套临时机制,不会被清掉 */
  keep: (target: string) => `keep-${encodeURIComponent(target)}`,
};

/**
 * embeddable 元素 ↔ cardId(renderEmbeddable 只拿得到元素本身)。
 * protocol.md 写的是 `link: card://<cardId>`,但带 link 的元素 Excalidraw 会在右上角画一个
 * 「↗」链接徽标(画在画布上,CSS 盖不掉),所以改用元素 id 前缀 `card-` 认卡;
 * 两条路都认,link 形式仍然兼容(已记 shared/ISSUES.md)。
 */
export const CARD_LINK_PREFIX = 'card://';
const CARD_ID_PREFIX = 'card-';

export function cardLink(cardId: string): string {
  return `${CARD_LINK_PREFIX}${cardId}`;
}

export function cardIdFromElement(el: { id?: string; link?: string | null }): string | null {
  if (el.link?.startsWith(CARD_LINK_PREFIX)) return el.link.slice(CARD_LINK_PREFIX.length) || null;
  if (el.id?.startsWith(CARD_ID_PREFIX)) return el.id.slice(CARD_ID_PREFIX.length) || null;
  return null;
}
