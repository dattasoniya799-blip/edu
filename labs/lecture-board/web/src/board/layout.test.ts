import { describe, expect, it } from 'vitest';
import { BOARD_TOP, CARD_GAP, COL_GAP, COL_W, cardIdFromElement, cardLink, layoutBoard } from './layout';

describe('列布局(nextY 游标)', () => {
  const visible = new Map([
    ['c0', ['a', 'b']],
    ['c1', ['c']],
  ]);

  it('列按 445 + 60 横排,卡从 BOARD_TOP 起按实测高度 + 24 往下堆', () => {
    const heights = new Map([
      ['a', 300],
      ['b', 120],
      ['c', 200],
    ]);
    const { byCard } = layoutBoard(['c0', 'c1'], visible, heights);
    expect(byCard.get('a')).toMatchObject({ x: 0, y: BOARD_TOP, w: COL_W, h: 300 });
    expect(byCard.get('b')).toMatchObject({ x: 0, y: BOARD_TOP + 300 + CARD_GAP, h: 120 });
    expect(byCard.get('c')).toMatchObject({ x: COL_W + COL_GAP, y: BOARD_TOP, h: 200 });
  });

  it('没量到高度的卡用估高,量到之后下方卡整体上移', () => {
    const before = layoutBoard(['c0'], visible, new Map());
    const after = layoutBoard(['c0'], visible, new Map([['a', 90]]));
    expect(after.byCard.get('b')!.y).toBeLessThan(before.byCard.get('b')!.y);
  });

  it('同列相邻卡永远不重叠', () => {
    const { cards } = layoutBoard(['c0'], visible, new Map([['a', 333], ['b', 47]]));
    const [first, second] = cards;
    expect(second.y).toBeGreaterThanOrEqual(first.y + first.h);
  });

  it('列的 bottom 是最后一张卡的底边 + 卡距', () => {
    const { columns } = layoutBoard(['c0'], visible, new Map([['a', 100], ['b', 50]]));
    expect(columns[0].bottom).toBe(BOARD_TOP + 100 + CARD_GAP + 50 + CARD_GAP);
  });
});

describe('embeddable ↔ cardId', () => {
  it('link 形式(protocol.md 写的)认得出来', () => {
    expect(cardIdFromElement({ link: cardLink('k2_board') })).toBe('k2_board');
  });

  it('元素 id 前缀也认(实际用的,避免 excalidraw 画链接徽标)', () => {
    expect(cardIdFromElement({ id: 'card-k2_board', link: null })).toBe('k2_board');
  });

  it('不是卡的元素返回 null', () => {
    expect(cardIdFromElement({ id: 'coltitle-c1', link: null })).toBeNull();
    expect(cardIdFromElement({ id: 'fx-3', link: 'https://example.com' })).toBeNull();
  });
});
