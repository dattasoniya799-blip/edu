import { render, screen } from '@testing-library/react';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BoardContext } from '../../board-context';
import { takeawayTarget } from '../../lib/flow';
import type { BoardScript, Card } from '../../types';
import { CardView } from './Cards';

const script: BoardScript = {
  version: 2,
  title: 'T',
  subject: 'physics',
  summary: 's',
  problem: { text: '模型体积为 6×10⁻⁴ m³,吸水后沉入水底。', images: [], answer: 'a' },
  analysis: {
    given: [],
    hidden: [],
    find: [],
    ideas: [],
    marks: [
      { text: '6×10⁻⁴ m³', kind: 'data' },
      { text: '沉入水底', kind: 'hidden' },
    ],
  },
  columns: [{ id: 'c0', title: '审题', phase: 'analysis' }],
  cards: [],
  figures: [],
  animations: [],
  steps: [],
  takeaways: { knowledge: ['浸没时【V排等于V】'], pitfalls: [], methods: [], variants: [] },
};

function renderCard(
  card: Card,
  revealed: string[] = [],
  opts: { speaking?: string[]; kept?: Array<[string, 'mark' | 'circle']> } = {},
) {
  return renderCardWithScript(script, card, revealed, opts);
}

function renderCardWithScript(
  s: BoardScript,
  card: Card,
  revealed: string[] = [],
  opts: { speaking?: string[]; kept?: Array<[string, 'mark' | 'circle']> } = {},
) {
  return render(
    <BoardContext.Provider
      value={{
        script: s,
        revealed: new Set(revealed),
        explore: null,
        registerAnim: () => () => {},
        speaking: new Set(opts.speaking ?? []),
        kept: new Map(opts.kept ?? []),
      }}
    >
      <CardView card={card} />
    </BoardContext.Provider>,
  );
}

/**
 * 真的发过 mark:/analysis: reveal 的剧本(新初态生效,见 lib/targets.ts 的 hasAnalysisStep);
 * 其余字段与 `script` 共用。
 */
const analysisScript: BoardScript = {
  ...script,
  columns: [{ id: 'c0', title: '审题', phase: 'analysis' }],
  steps: [
    {
      id: 's0',
      title: '审题',
      col: 'c0',
      flow: [{ say: '这道题…' }, { do: 'reveal', target: 'analysis:given' }],
    },
  ],
};

describe('problem 卡 · 三色高亮', () => {
  it('marks 按 kind 上红蓝绿,其余文字原样', () => {
    const { container } = renderCard({ id: 'k', col: 'c0', kind: 'problem' });
    expect(container.querySelector('.mark-data')?.textContent).toBe('6×10⁻⁴ m³');
    expect(container.querySelector('.mark-hidden')?.textContent).toBe('沉入水底');
    expect(container.textContent).toContain('模型体积为');
  });

  it('右上角有三色图例', () => {
    const { container } = renderCard({ id: 'k', col: 'c0', kind: 'problem' });
    expect(container.querySelectorAll('.problem-legend span')).toHaveLength(3);
  });
});

describe('board 卡 · 板书行', () => {
  const card: Card = {
    id: 'kb',
    col: 'c0',
    kind: 'board',
    title: '第一步',
    lines: [
      { id: 'l1', kind: 'text', text: '压力等于重力' },
      { id: 'l2', kind: 'formula', tex: 'p = \\frac{F}{S}', speech: '压强等于压力除以面积' },
      { id: 'l3', kind: 'conclusion', text: 'p = 600 Pa' },
    ],
  };

  it('没 reveal 的行不出现', () => {
    const { container } = renderCard(card, []);
    expect(container.querySelectorAll('.board-line')).toHaveLength(0);
  });

  it('reveal 了的行按 kind 分类;formula 走 KaTeX,conclusion 带框', () => {
    const { container } = renderCard(card, ['l1', 'l2', 'l3']);
    expect(container.querySelectorAll('.board-line')).toHaveLength(3);
    expect(container.querySelector('.kind-formula .katex')).not.toBeNull();
    expect(container.querySelector('.kind-conclusion')?.textContent).toBe('p = 600 Pa');
  });

  it('每行带 data-fx-target,红圈才圈得到', () => {
    const { container } = renderCard(card, ['l3']);
    expect(container.querySelector('[data-fx-target="l3"]')).not.toBeNull();
  });
});

describe('问题卡 · 审题列新初态(schema.ts Card 注释)', () => {
  const problemCard: Card = { id: 'k_problem', col: 'c0', kind: 'problem' };
  const analysisCard: Card = { id: 'k_analysis', col: 'c0', kind: 'analysis' };

  it('有 analysis step 时,未 reveal 的 mark 文字照常但不上色;已 reveal 的才上色', () => {
    const { container } = renderCardWithScript(analysisScript, problemCard, []);
    // 文字都在,只是没有三色 class
    expect(container.textContent).toContain('6×10⁻⁴ m³');
    expect(container.textContent).toContain('沉入水底');
    expect(container.querySelector('.mark-data')).toBeNull();
    expect(container.querySelector('.mark-hidden')).toBeNull();
    // 但 span 已经挂了 data-fx-target,reveal 一来就能定位
    expect(container.querySelector('[data-fx-target="mark:6×10⁻⁴ m³"]')).not.toBeNull();
  });

  it('reveal 了某个 mark 之后,只有它上色,其余仍然素色', () => {
    const { container } = renderCardWithScript(analysisScript, problemCard, ['mark:沉入水底']);
    expect(container.querySelector('.mark-hidden')?.textContent).toBe('沉入水底');
    expect(container.querySelector('.mark-data')).toBeNull();
  });

  it('没有 analysis step(旧剧本)时,不管 revealed 是什么,marks 一直全上色', () => {
    const { container } = renderCard(problemCard, []); // `script` 的 steps 是 []
    expect(container.querySelector('.mark-data')?.textContent).toBe('6×10⁻⁴ m³');
    expect(container.querySelector('.mark-hidden')?.textContent).toBe('沉入水底');
  });

  it('审题卡:有 analysis step 时,没 reveal 任何块 → 四块都不出现', () => {
    const withAnalysis: BoardScript = {
      ...analysisScript,
      analysis: {
        given: ['V = 6×10⁻⁴ m³'],
        hidden: ['沉入水底 → 完全浸没'],
        find: ['浮力'],
        ideas: ['F浮 = ρgV'],
        marks: analysisScript.analysis.marks,
      },
    };
    const { container } = renderCardWithScript(withAnalysis, analysisCard, []);
    expect(container.querySelectorAll('.analysis-block')).toHaveLength(0);
  });

  it('审题卡:reveal 整块 → 块内条目全出现;reveal 单条 → 只出现那一条', () => {
    const withAnalysis: BoardScript = {
      ...analysisScript,
      analysis: {
        given: ['a1', 'a2'],
        hidden: ['h1', 'h2'],
        find: ['浮力'],
        ideas: ['F浮 = ρgV'],
        marks: [],
      },
    };
    const { container } = renderCardWithScript(withAnalysis, analysisCard, ['analysis:given', 'analysis:hidden:1']);
    expect(container.querySelectorAll('.analysis-block')).toHaveLength(2); // given 整块 + hidden(有条目露出)
    expect(container.querySelectorAll('.is-given .ab-item')).toHaveLength(2); // 整块 reveal → 两条都出现
    expect(container.querySelectorAll('.is-hidden .ab-item')).toHaveLength(1); // 只 reveal 了第 1 条
    expect(container.querySelector('.is-hidden .ab-item')?.textContent).toContain('h2');
  });

  it('没有 analysis step(旧剧本)时,四块不用 reveal 就都在', () => {
    const oldScript: BoardScript = {
      ...script,
      analysis: { given: ['a'], hidden: ['h'], find: ['f'], ideas: ['i'], marks: script.analysis.marks },
    };
    const { container } = renderCardWithScript(oldScript, analysisCard, []);
    expect(container.querySelectorAll('.analysis-block')).toHaveLength(4);
  });
});

describe('讲到哪、亮到哪 · speaking / kept 的高亮 class', () => {
  const boardCard: Card = {
    id: 'kb2',
    col: 'c0',
    kind: 'board',
    lines: [{ id: 'lx', kind: 'text', text: '压力等于重力' }],
  };

  it('speaking 命中的行有 hl-mark-speaking', () => {
    const { container } = renderCard(boardCard, ['lx'], { speaking: ['lx'] });
    expect(container.querySelector('[data-fx-target="lx"]')?.className).toContain('hl-mark-speaking');
  });

  it('kept mark 命中的行有 hl-mark-kept,不会同时带 speaking 的 class', () => {
    const { container } = renderCard(boardCard, ['lx'], { kept: [['lx', 'mark']] });
    const el = container.querySelector('[data-fx-target="lx"]');
    expect(el?.className).toContain('hl-mark-kept');
    expect(el?.className).not.toContain('hl-mark-speaking');
  });

  it('整卡引用(target=cardId)带 hl-card-speaking,不是 hl-mark-speaking', () => {
    const { container } = renderCard(boardCard, ['lx'], { speaking: ['kb2'] });
    expect(container.querySelector('[data-fx-target="kb2"]')?.className).toContain('hl-card-speaking');
  });

  it('普通 mark 三色底不受 speaking 影响照常显示,同时叠加黄底 class', () => {
    const { container } = renderCard(
      { id: 'k', col: 'c0', kind: 'problem' },
      [],
      { speaking: ['mark:沉入水底'] },
    );
    const el = container.querySelector('[data-fx-target="mark:沉入水底"]');
    expect(el?.className).toContain('mark-hidden');
    expect(el?.className).toContain('hl-mark-speaking');
  });
});

describe('takeaways 卡 · 【】胶囊', () => {
  it('【】里的词渲染成胶囊,括号本身不显示', () => {
    const { container } = renderCard({ id: 'kt', col: 'c0', kind: 'takeaways' }, [takeawayTarget('knowledge', 0)]);
    expect(container.querySelector('.accent-pill')?.textContent).toBe('V排等于V');
    expect(container.textContent).not.toContain('【');
    expect(screen.getByText('核心知识点')).toBeInTheDocument();
  });

  it('没 reveal 的条目不出现', () => {
    const { container } = renderCard({ id: 'kt', col: 'c0', kind: 'takeaways' }, []);
    expect(container.querySelectorAll('.takeaway-item')).toHaveLength(0);
  });
});

describe('纪律:卡片组件不碰 excalidraw(protocol.md「画布底座」)', () => {
  it('components/cards/* 里没有任何 excalidraw import', () => {
    const dir = join(process.cwd(), 'src/components/cards');
    const offenders = readdirSync(dir)
      .filter((f: string) => /\.tsx?$/.test(f) && !f.includes('.test.'))
      .filter((f: string) => readFileSync(join(dir, f), 'utf8').includes('@excalidraw'));
    expect(offenders).toEqual([]);
  });
});
