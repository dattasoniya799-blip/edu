// @vitest-environment jsdom
/**
 * ResultView 读 attempt.questions(契约字段)渲染:
 * - 交卷/已判后:逐题渲染题干 + 我的答案 + 正确答案(QuestionAnswer 对象格式化)+ 解析
 * - 防作弊:correctAnswer=null 的题不渲染「正确答案」(in_progress 期间不下发)
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ResultView } from '../ResultView';
import type { AttemptWithQuestions } from '../types';

function attemptOf(correctAnswer: AttemptWithQuestions['questions'][number]['correctAnswer'], analysisLatex: string | null): AttemptWithQuestions {
  return {
    id: 1, assignmentId: 1, status: 'graded', attemptNo: 1,
    startedAt: '2026-06-10T00:00:00.000Z', submittedAt: '2026-06-10T00:10:00.000Z',
    score: 5, objectiveScore: 5, subjectiveScore: null,
    answers: [{ questionId: 13, response: { choice: 'A' }, isCorrect: false, score: 0, flagged: false }],
    questions: [{
      seq: 1, questionId: 13, score: 5, type: 'single',
      stemLatex: '将直线 $y=2x+1$ 平移(  )',
      figures: [], options: [{ label: 'A', contentLatex: '甲' }, { label: 'B', contentLatex: '乙' }],
      correctAnswer, analysisLatex,
    }],
  };
}

describe('ResultView 读 questions 渲染', () => {
  it('已判:渲染题干 / 正确答案(格式化 choice)/ 解析', () => {
    const html = renderToStaticMarkup(<ResultView attempt={attemptOf({ choice: 'B' }, '应选 $B$')} assignment={null} />);
    expect(html).toContain('正确答案');
    expect(html).toContain('解析');
    expect(html).toContain('✕ 错误'); // 我答 A,正确 B → 判错
  });

  it('防作弊:correctAnswer=null(未判/作答中)不渲染正确答案与解析', () => {
    const html = renderToStaticMarkup(<ResultView attempt={attemptOf(null, null)} assignment={null} />);
    expect(html).not.toContain('正确答案');
    expect(html).not.toContain('解析');
  });
});
