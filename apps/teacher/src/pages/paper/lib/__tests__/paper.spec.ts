import { describe, expect, it } from 'vitest';
import { defaultScore, toPaperInput, toggleQuestion, totalScore, validatePaper } from '../paper';

describe('totalScore(分值汇总)', () => {
  it('Σ分值', () => {
    expect(totalScore([{ questionId: 1, score: 5 }, { questionId: 2, score: 5 }, { questionId: 3, score: 10 }])).toBe(20);
  });
  it('空列表 = 0;非法分值按 0 计', () => {
    expect(totalScore([])).toBe(0);
    expect(totalScore([{ questionId: 1, score: Number.NaN }, { questionId: 2, score: 5 }])).toBe(5);
  });
});

describe('validatePaper(发布前校验)', () => {
  const ok = [{ questionId: 1, score: 5 }, { questionId: 2, score: 10 }];
  it('合法输入通过', () => {
    expect(validatePaper('第 4 讲课后作业', ok)).toEqual([]);
  });
  it('名称空 / 无题 / 分值非正 / 重复题各报一条', () => {
    expect(validatePaper('  ', ok)).toContain('请填写作业名称');
    expect(validatePaper('卷', [])).toContain('至少选择 1 道题');
    expect(validatePaper('卷', [{ questionId: 1, score: 0 }])).toContain('每题分值需为正数');
    expect(validatePaper('卷', [{ questionId: 1, score: 5 }, { questionId: 1, score: 5 }])).toContain('存在重复题目');
  });
});

describe('toPaperInput / defaultScore / toggleQuestion', () => {
  it('toPaperInput:题序=数组顺序,只保留 questionId/score', () => {
    expect(toPaperInput(' 卷 ', 'homework', [{ questionId: 9, score: 5 }, { questionId: 4, score: 10 }])).toEqual({
      name: '卷', type: 'homework', questions: [{ questionId: 9, score: 5 }, { questionId: 4, score: 10 }],
    });
  });
  it('defaultScore:解答 10 分,其余 5 分(seed 口径)', () => {
    expect(defaultScore('solution')).toBe(10);
    expect(defaultScore('single')).toBe(5);
    expect(defaultScore('blank')).toBe(5);
  });
  it('toggleQuestion:未选追加缺省分,已选移除', () => {
    const once = toggleQuestion([], 4, 'solution');
    expect(once).toEqual([{ questionId: 4, score: 10 }]);
    expect(toggleQuestion(once, 4, 'solution')).toEqual([]);
  });
});
