import { describe, expect, it } from 'vitest';
import {
  analysisTarget,
  hasAnalysisStep,
  isAnalysisBlockRevealed,
  isAnalysisItemRevealed,
  isMarkRevealed,
  markTarget,
  parseTarget,
  refTargets,
  takeawayTarget,
} from './targets';

describe('parseTarget · 目标字符串五种写法(schema.ts)', () => {
  it('<cardId> / <lineId> → kind:"id"', () => {
    expect(parseTarget('k_problem')).toEqual({ kind: 'id', id: 'k_problem' });
    expect(parseTarget('l1b')).toEqual({ kind: 'id', id: 'l1b' });
  });

  it('mark:<text> → kind:"mark",冒号后面全算文本(text 自己可能带冒号)', () => {
    expect(parseTarget('mark:6×10⁻⁴ m³')).toEqual({ kind: 'mark', text: '6×10⁻⁴ m³' });
    expect(parseTarget('mark:9:30 上课')).toEqual({ kind: 'mark', text: '9:30 上课' });
  });

  it('mark: 后面是空的 → 退化成 id(不是合法 mark)', () => {
    expect(parseTarget('mark:')).toEqual({ kind: 'id', id: 'mark:' });
  });

  it('analysis:<block> → kind:"analysis",不带 index', () => {
    expect(parseTarget('analysis:given')).toEqual({ kind: 'analysis', block: 'given', index: undefined });
    expect(parseTarget('analysis:hidden')).toEqual({ kind: 'analysis', block: 'hidden', index: undefined });
  });

  it('analysis:<block>:<i> → 带 index(0 起)', () => {
    expect(parseTarget('analysis:hidden:0')).toEqual({ kind: 'analysis', block: 'hidden', index: 0 });
    expect(parseTarget('analysis:ideas:2')).toEqual({ kind: 'analysis', block: 'ideas', index: 2 });
  });

  it('analysis:<不认识的块> 或 index 不是整数 → 退化成 id', () => {
    expect(parseTarget('analysis:nope')).toEqual({ kind: 'id', id: 'analysis:nope' });
    expect(parseTarget('analysis:given:x')).toEqual({ kind: 'id', id: 'analysis:given:x' });
  });

  it('takeaways:<group>:<i> → kind:"takeaway"', () => {
    expect(parseTarget('takeaways:knowledge:0')).toEqual({ kind: 'takeaway', group: 'knowledge', index: 0 });
    expect(parseTarget('takeaways:pitfalls:3')).toEqual({ kind: 'takeaway', group: 'pitfalls', index: 3 });
  });

  it('takeaways:<不认识的组> 或缺 index → 退化成 id', () => {
    expect(parseTarget('takeaways:knowledge')).toEqual({ kind: 'id', id: 'takeaways:knowledge' });
    expect(parseTarget('takeaways:nope:0')).toEqual({ kind: 'id', id: 'takeaways:nope:0' });
  });

  it('markTarget / analysisTarget / takeawayTarget 是 parseTarget 的逆运算', () => {
    expect(parseTarget(markTarget('沉入水底'))).toEqual({ kind: 'mark', text: '沉入水底' });
    expect(parseTarget(analysisTarget('find'))).toEqual({ kind: 'analysis', block: 'find', index: undefined });
    expect(parseTarget(analysisTarget('find', 1))).toEqual({ kind: 'analysis', block: 'find', index: 1 });
    expect(parseTarget(takeawayTarget('methods', 2))).toEqual({ kind: 'takeaway', group: 'methods', index: 2 });
  });
});

describe('refTargets · ref 归一成数组', () => {
  it('没写 ref → null(区别于「写了但是空」)', () => {
    expect(refTargets({ say: 'x' })).toBeNull();
  });

  it('单个字符串 ref → 长度为 1 的数组', () => {
    expect(refTargets({ say: 'x', ref: 'l1b' })).toEqual(['l1b']);
  });

  it('数组 ref → 原样返回(过滤空字符串)', () => {
    expect(refTargets({ say: 'x', ref: ['l1b', 'mark:8×10⁻³ m²'] })).toEqual(['l1b', 'mark:8×10⁻³ m²']);
    expect(refTargets({ say: 'x', ref: ['l1b', ''] })).toEqual(['l1b']);
  });

  it('ref 是空数组或全是空字符串 → null', () => {
    expect(refTargets({ say: 'x', ref: [] })).toBeNull();
    expect(refTargets({ say: 'x', ref: [''] })).toBeNull();
  });
});

describe('审题列新初态 · isMarkRevealed / isAnalysisBlockRevealed / isAnalysisItemRevealed', () => {
  it('旧剧本(analysisDriven=false)恒可见,不管 revealed 是什么', () => {
    const empty = new Set<string>();
    expect(isMarkRevealed(empty, '沉入水底', false)).toBe(true);
    expect(isAnalysisBlockRevealed(empty, 'given', false, 3)) .toBe(true);
    expect(isAnalysisItemRevealed(empty, 'given', 0, false)).toBe(true);
  });

  it('新初态(analysisDriven=true):没 reveal 就不可见', () => {
    const empty = new Set<string>();
    expect(isMarkRevealed(empty, '沉入水底', true)).toBe(false);
    expect(isAnalysisBlockRevealed(empty, 'given', true, 3)).toBe(false);
    expect(isAnalysisItemRevealed(empty, 'given', 0, true)).toBe(false);
  });

  it('mark 是逐个 reveal 的:reveal 了别的 mark 不影响这个 mark', () => {
    const revealed = new Set([markTarget('6×10⁻⁴ m³')]);
    expect(isMarkRevealed(revealed, '6×10⁻⁴ m³', true)).toBe(true);
    expect(isMarkRevealed(revealed, '沉入水底', true)).toBe(false);
  });

  it('reveal 整块(analysis:<block>) → 块可见,块里每一条也都算可见', () => {
    const revealed = new Set([analysisTarget('given')]);
    expect(isAnalysisBlockRevealed(revealed, 'given', true, 3)).toBe(true);
    expect(isAnalysisItemRevealed(revealed, 'given', 0, true)).toBe(true);
    expect(isAnalysisItemRevealed(revealed, 'given', 2, true)).toBe(true);
  });

  it('只 reveal 单条(analysis:<block>:<i>) → 块因为有条目露出而可见,但只有这一条条目可见', () => {
    const revealed = new Set([analysisTarget('hidden', 1)]);
    expect(isAnalysisBlockRevealed(revealed, 'hidden', true, 2)).toBe(true);
    expect(isAnalysisItemRevealed(revealed, 'hidden', 0, true)).toBe(false);
    expect(isAnalysisItemRevealed(revealed, 'hidden', 1, true)).toBe(true);
  });
});

describe('hasAnalysisStep · 审题列新初态只在剧本真的发过 mark:/analysis: reveal 时生效', () => {
  it('没有任何 step → false', () => {
    expect(hasAnalysisStep({ steps: [] })).toBe(false);
  });

  it('审题列有 step,但只对整卡 fx(旧剧本真实长相)→ false,退回整列可见', () => {
    // 实测 20260917-104306-yeqe-03-浮力潜艇:列 phase 是 analysis、也确实有 step 落在这一列,
    // 但只 `fx:circle/underline` 整张卡,从没 reveal 过 mark:/analysis:,按列 phase 判会误判。
    expect(
      hasAnalysisStep({
        steps: [
          { id: 's1', title: '审题', col: 'c0', flow: [{ fx: 'circle', target: 'k_analysis' }] },
          { id: 's2', title: '审题', col: 'c0', flow: [{ fx: 'underline', target: 'k_analysis' }] },
        ],
      }),
    ).toBe(false);
  });

  it('reveal 过 mark:<text> → true', () => {
    expect(
      hasAnalysisStep({
        steps: [{ id: 's0', title: '审题', col: 'c0', flow: [{ do: 'reveal', target: 'mark:沉入水底' }] }],
      }),
    ).toBe(true);
  });

  it('reveal 过 analysis:<block> → true', () => {
    expect(
      hasAnalysisStep({
        steps: [{ id: 's0', title: '审题', col: 'c0', flow: [{ do: 'reveal', target: 'analysis:given' }] }],
      }),
    ).toBe(true);
  });

  it('只 reveal 普通 cardId/lineId,不带 mark:/analysis: 前缀 → false', () => {
    expect(
      hasAnalysisStep({
        steps: [{ id: 's0', title: '审题', col: 'c0', flow: [{ do: 'reveal', target: 'k_problem' }] }],
      }),
    ).toBe(false);
  });
});
