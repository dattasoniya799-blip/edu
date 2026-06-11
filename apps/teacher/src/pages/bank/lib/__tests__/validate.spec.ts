import { describe, expect, it } from 'vitest';
import { emptyForm, type QuestionForm } from '../transform';
import { validateQuestion } from '../validate';

const CURRICULUM_TAG = { nodeId: 101, graphType: 'curriculum_knowledge' as const, code: 'PEP-19-1', name: '一次函数的概念' };
const ABILITY_TAG = { nodeId: 201, graphType: 'problem_solving_ability' as const, code: 'ABL-1', name: '运算求解' };

function validSingle(): QuestionForm {
  const f = emptyForm();
  f.stemLatex = '将直线 $y=2x+1$ 向下平移…';
  f.options = ['$y=2x+4$', '$y=2x+1$', '$y=x$', '$y=-x$'].map((c, i) => ({
    label: 'ABCD'[i], contentLatex: c, isCorrect: i === 1,
  }));
  f.tags = [CURRICULUM_TAG];
  return f;
}

function validSolution(): QuestionForm {
  const f = emptyForm();
  f.type = 'solution';
  f.stemLatex = '如图,一次函数 $y=kx+b$ …';
  f.referenceLatex = '设 $y=kx+b$,解得 $k=2,b=1$。';
  f.rubric = [
    { step: 1, desc: '设式并代入', score: 3 },
    { step: 2, desc: '求出平移后直线', score: 4 },
  ];
  f.tags = [CURRICULUM_TAG, ABILITY_TAG];
  return f;
}

describe('validateQuestion · 草稿', () => {
  it('草稿只要求题干/学段/学科', () => {
    const f = emptyForm();
    f.stemLatex = '随便写一点';
    expect(validateQuestion(f, 'draft')).toEqual([]);
  });
  it('空题干被拦截', () => {
    expect(validateQuestion(emptyForm(), 'draft').map((e) => e.field)).toContain('stemLatex');
  });
});

describe('validateQuestion · 提交入库', () => {
  it('合法单选题通过', () => {
    expect(validateQuestion(validSingle(), 'publish')).toEqual([]);
  });

  it('tagNodeIds 至少 1 个教材知识点(只有能力标签不行)', () => {
    const f = validSingle();
    f.tags = [ABILITY_TAG];
    expect(validateQuestion(f, 'publish').map((e) => e.field)).toContain('tags');
  });

  it('单选必须恰好 1 个正确答案', () => {
    const none = validSingle();
    none.options = none.options.map((o) => ({ ...o, isCorrect: false }));
    expect(validateQuestion(none, 'publish').some((e) => e.field === 'options')).toBe(true);
    const two = validSingle();
    two.options[0].isCorrect = true;
    expect(validateQuestion(two, 'publish').some((e) => e.field === 'options')).toBe(true);
  });

  it('多选至少 2 个正确答案', () => {
    const f = validSingle();
    f.type = 'multi';
    expect(validateQuestion(f, 'publish').some((e) => e.field === 'options')).toBe(true);
    f.options[0].isCorrect = true;
    expect(validateQuestion(f, 'publish')).toEqual([]);
  });

  it('填空至少 1 个参考答案', () => {
    const f = validSingle();
    f.type = 'blank';
    f.blankAnswers = ['  '];
    expect(validateQuestion(f, 'publish').some((e) => e.field === 'answer')).toBe(true);
    f.blankAnswers = ['y=2x+1'];
    expect(validateQuestion(f, 'publish')).toEqual([]);
  });

  it('合法解答题通过;rubric 为空被拦截(必填)', () => {
    expect(validateQuestion(validSolution(), 'publish')).toEqual([]);
    const f = validSolution();
    f.rubric = [];
    expect(validateQuestion(f, 'publish').some((e) => e.field === 'rubric')).toBe(true);
  });

  it('rubric 行描述为空 / 分值 ≤ 0 被拦截', () => {
    const f = validSolution();
    f.rubric = [{ step: 1, desc: ' ', score: 0 }];
    const msgs = validateQuestion(f, 'publish').filter((e) => e.field === 'rubric');
    expect(msgs).toHaveLength(2);
  });

  it('解答题参考答案必填', () => {
    const f = validSolution();
    f.referenceLatex = '';
    expect(validateQuestion(f, 'publish').some((e) => e.field === 'answer')).toBe(true);
  });

  it('难度必须 1–3', () => {
    const f = validSingle();
    f.difficulty = 5;
    expect(validateQuestion(f, 'publish').some((e) => e.field === 'difficulty')).toBe(true);
  });
});
