// @vitest-environment jsdom
/**
 * QuestionPanel 渲染:题目插图(anchor 多位置)+ 公式填空「待批改」反馈态。
 * - figures 按 anchor 落到 题干 / 选项 / 解析(走 @qiming/ui QuestionFigures)
 * - 公式填空(judged=false)显示「待批改」,而非即时对错(与解答题待批改视觉一致)
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { QuestionFigure } from '@qiming/contracts';
import { QuestionPanel } from '../QuestionPanel';
import type { AttemptQuestionView } from '../types';
import type { ItemState } from '../machine';

const figures: QuestionFigure[] = [
  { ossKey: 'demo/q-stem.png', position: 1, anchor: { target: 'stem' } },
  { ossKey: 'demo/q-optA.png', position: 2, anchor: { target: 'option', ref: 'A' } },
  { ossKey: 'demo/q-analysis.png', position: 3, anchor: { target: 'analysis' } },
];

const qSingle: AttemptQuestionView = {
  seq: 1, questionId: 13, score: 5, type: 'single',
  stemLatex: '将直线 $y=2x+1$ 平移(  )', figures,
  options: ['$y=2x+4$', '$y=2x-2$'].map((c, i) => ({ label: 'ABCD'[i], contentLatex: c })),
  correctAnswer: null, analysisLatex: null,
};
const qBlankFormula: AttemptQuestionView = {
  seq: 2, questionId: 7, score: 5, type: 'blank', figures: [],
  stemLatex: '该函数的解析式为 ________。', options: [],
  correctAnswer: null, analysisLatex: null,
};

const noop = () => undefined;

describe('题目插图按 anchor 渲染', () => {
  it('题干/选项/解析三处插图各就各位(占位框含 data-figure-target)', () => {
    const item: ItemState = { questionId: 13, response: null, flagged: false, feedback: null };
    const html = renderToStaticMarkup(<QuestionPanel q={qSingle} item={item} draft={null} onDraft={noop} />);
    expect(html).toContain('data-figure-target="stem"');
    expect(html).toContain('data-figure-target="option"'); // 选项 A 内联插图
  });
});

describe('公式填空「待批改」反馈', () => {
  it('judged=false 的填空显示「待批改」,不显示即时对错', () => {
    const item: ItemState = {
      questionId: 7,
      response: { texts: ['y=\\dfrac{1}{2}x+1'] },
      flagged: false,
      feedback: { judged: false, isCorrect: null, correctAnswer: null, analysisLatex: null },
    };
    const html = renderToStaticMarkup(<QuestionPanel q={qBlankFormula} item={item} draft={null} onDraft={noop} />);
    expect(html).toContain('待批改');
    expect(html).not.toContain('回答正确');
    expect(html).not.toContain('回答错误');
  });

  it('简单填空判对仍显示「回答正确」(即时判分不变)', () => {
    const item: ItemState = {
      questionId: 7,
      response: { texts: ['36'] },
      flagged: false,
      feedback: { judged: true, isCorrect: true, correctAnswer: null, analysisLatex: null },
    };
    const html = renderToStaticMarkup(<QuestionPanel q={qBlankFormula} item={item} draft={null} onDraft={noop} />);
    expect(html).toContain('回答正确');
    expect(html).not.toContain('待批改');
  });
});
