import { describe, expect, it } from 'vitest';
import type { QuestionDto } from '@qiming/contracts';
import {
  canPublishQuestion, emptyForm, formToInput, formatDateCn, normalizeOptionLatex, questionToForm,
} from '../transform';

describe('canPublishQuestion(round3 #3:仅草稿/新题可"提交入库")', () => {
  it('新题(status=null)→ 可入库', () => {
    expect(canPublishQuestion(null)).toBe(true);
  });
  it('草稿 → 可入库', () => {
    expect(canPublishQuestion('draft')).toBe(true);
  });
  it('已入库(published)→ 不可再入库(否则后端 400)', () => {
    expect(canPublishQuestion('published')).toBe(false);
  });
  it('已下架(retired)→ 不可入库', () => {
    expect(canPublishQuestion('retired')).toBe(false);
  });
});

describe('emptyForm(新题默认值不串科)', () => {
  it('不预填章节(此前硬编码数学「第十九章 一次函数」,物理/化学新题被预填数学章节)', () => {
    const f = emptyForm();
    expect(f.chapter).toBe('');
    // 空章节提交时省略字段,不写入串科数据
    f.stemLatex = '题干';
    expect(formToInput(f).chapter).toBeUndefined();
  });
});

describe('normalizeOptionLatex', () => {
  it('裸 LaTeX 自动包 $..$(原型 renderOpt 行为)', () => {
    expect(normalizeOptionLatex('y=2x+4')).toBe('$y=2x+4$');
  });
  it('已含 $ 的源码原样保留', () => {
    expect(normalizeOptionLatex('$y=\\dfrac{1}{2}x$')).toBe('$y=\\dfrac{1}{2}x$');
  });
  it('空白返回空串', () => {
    expect(normalizeOptionLatex('  ')).toBe('');
  });
});

describe('formatDateCn', () => {
  it('ISO → 「M 月 D 日」', () => {
    expect(formatDateCn('2026-06-02T03:00:00.000Z')).toMatch(/6 月 [12] 日/);
  });
  it('非法日期兜底', () => {
    expect(formatDateCn('oops')).toBe('—');
  });
});

describe('formToInput · 题型联动', () => {
  it('单选:answer={choice},选项归一化、空选项剔除', () => {
    const f = emptyForm();
    f.stemLatex = '题干';
    f.options = [
      { label: 'A', contentLatex: 'y=2x+4', isCorrect: false },
      { label: 'B', contentLatex: '$y=2x+1$', isCorrect: true },
      { label: 'C', contentLatex: '', isCorrect: false },
      { label: 'D', contentLatex: 'y=-x+4', isCorrect: false },
    ];
    f.tags = [{ nodeId: 101, graphType: 'curriculum_knowledge', code: 'X', name: 'x' }];
    const input = formToInput(f);
    expect(input.answer).toEqual({ choice: 'B' });
    expect(input.options).toHaveLength(3);
    expect(input.options![0].contentLatex).toBe('$y=2x+4$');
    expect(input.rubric).toEqual([]);
    expect(input.tagNodeIds).toEqual([101]);
  });

  it('多选:answer={choices}', () => {
    const f = emptyForm();
    f.type = 'multi';
    f.options = f.options.map((o, i) => ({ ...o, contentLatex: `o${i}`, isCorrect: i < 2 }));
    expect(formToInput(f).answer).toEqual({ choices: ['A', 'B'] });
  });

  it('填空:answer={texts},剔除空白行;不带 options', () => {
    const f = emptyForm();
    f.type = 'blank';
    f.blankAnswers = [' y=2x+1 ', '', '36'];
    const input = formToInput(f);
    expect(input.answer).toEqual({ texts: ['y=2x+1', '36'] });
    expect(input.options).toEqual([]);
  });

  it('解答:answer={referenceLatex},带 rubric 与 figures 顺序号', () => {
    const f = emptyForm();
    f.type = 'solution';
    f.referenceLatex = '设 $y=kx+b$ …';
    f.rubric = [{ step: 1, desc: '设式', score: 3 }];
    f.figures = [{ ossKey: 'question_figure/a.svg', position: 1, previewUrl: 'blob:x', fileName: 'a.svg' }];
    const input = formToInput(f);
    expect(input.answer).toEqual({ referenceLatex: '设 $y=kx+b$ …' });
    expect(input.rubric).toEqual([{ step: 1, desc: '设式', score: 3 }]);
    // previewUrl/fileName 等前端态不入库
    expect(input.figures).toEqual([{ ossKey: 'question_figure/a.svg', position: 1 }]);
  });
});

describe('questionToForm ↔ formToInput 往返(编辑回填)', () => {
  const dto: QuestionDto = {
    id: 7, type: 'solution', stage: '初中', subject: '数学',
    textbookVersion: '人教版', chapter: '第十九章 一次函数',
    stemLatex: '如图,一次函数 $y=kx+b\\ (k\\neq 0)$ …',
    figures: [{ ossKey: 'question_figure/fig-1.svg', position: 1 }],
    options: [],
    answer: { referenceLatex: '设 $y=kx+b$,解得 $k=2$。' },
    rubric: [{ step: 1, desc: '设式并代入', score: 3 }, { step: 2, desc: '求解', score: 4 }],
    analysisBriefLatex: null, analysisLatex: '解析…', analysisDetailLatex: null, difficulty: 3, status: 'published',
    tags: [
      { nodeId: 103, graphType: 'curriculum_knowledge', code: 'PEP-19-3', name: '待定系数法' },
      { nodeId: 201, graphType: 'problem_solving_ability', code: 'ABL-1', name: '运算求解' },
    ],
    stats: { correctRate: 58, usedInPapers: 12 }, ownerName: '张明', createdAt: '2026-05-28T03:00:00.000Z',
  };

  it('解答题往返字段不丢', () => {
    const form = questionToForm(dto);
    expect(form.referenceLatex).toBe('设 $y=kx+b$,解得 $k=2$。');
    expect(form.rubric).toHaveLength(2);
    expect(form.tags.map((t) => t.nodeId)).toEqual([103, 201]);
    const input = formToInput(form);
    expect(input.stemLatex).toBe(dto.stemLatex);
    expect(input.answer).toEqual(dto.answer);
    expect(input.rubric).toEqual(dto.rubric);
    expect(input.figures).toEqual(dto.figures);
    expect(input.tagNodeIds).toEqual([103, 201]);
    expect(input.difficulty).toBe(3);
  });

  it('单选回填:answer.choice 标记 isCorrect,不足 4 项补空行', () => {
    const single: QuestionDto = {
      ...dto, type: 'single',
      options: [
        { label: 'A', contentLatex: '$1$' },
        { label: 'B', contentLatex: '$2$' },
      ],
      answer: { choice: 'B' }, rubric: [],
    };
    const form = questionToForm(single);
    expect(form.options).toHaveLength(4);
    expect(form.options.find((o) => o.label === 'B')?.isCorrect).toBe(true);
    expect(form.options.find((o) => o.label === 'A')?.isCorrect).toBe(false);
  });

  it('填空回填 texts', () => {
    const blank: QuestionDto = { ...dto, type: 'blank', options: [], answer: { texts: ['36'] }, rubric: [] };
    expect(questionToForm(blank).blankAnswers).toEqual(['36']);
  });
});

describe('图片插图 anchor(方案 A)往返', () => {
  it('formToInput:非题干 anchor 保留(option 带 ref),题干 anchor 省略', () => {
    const f = emptyForm();
    f.stemLatex = '题干';
    f.tags = [{ nodeId: 101, graphType: 'curriculum_knowledge', code: 'X', name: 'x' }];
    f.figures = [
      { ossKey: 'k/stem.png', position: 1, anchor: { target: 'stem' }, previewUrl: 'blob:s' },
      { ossKey: 'k/optA.png', position: 2, anchor: { target: 'option', ref: 'A' } },
      { ossKey: 'k/analysis.png', position: 3, anchor: { target: 'analysis' } },
      { ossKey: 'k/rubric2.png', position: 4, anchor: { target: 'rubric', ref: '2' } },
    ];
    const out = formToInput(f).figures!;
    expect(out[0]).toEqual({ ossKey: 'k/stem.png', position: 1 }); // 题干:anchor 省略(向后兼容)
    expect(out[1]).toEqual({ ossKey: 'k/optA.png', position: 2, anchor: { target: 'option', ref: 'A' } });
    expect(out[2]).toEqual({ ossKey: 'k/analysis.png', position: 3, anchor: { target: 'analysis' } });
    expect(out[3]).toEqual({ ossKey: 'k/rubric2.png', position: 4, anchor: { target: 'rubric', ref: '2' } });
  });

  it('questionToForm:anchor 原样回填(选项/解析)', () => {
    const q: QuestionDto = {
      id: 9, type: 'single', stage: '初中', subject: '数学', textbookVersion: '人教版', chapter: null,
      stemLatex: '题', figures: [
        { ossKey: 'k/optA.png', position: 1, anchor: { target: 'option', ref: 'A' } },
        { ossKey: 'k/stem.png', position: 2 },
      ],
      options: [{ label: 'A', contentLatex: '$1$' }], answer: { choice: 'A' }, rubric: [],
      analysisBriefLatex: null, analysisLatex: null, analysisDetailLatex: null, difficulty: 2, status: 'published', tags: [],
      stats: { correctRate: null, usedInPapers: 0 }, ownerName: '张明', createdAt: '2026-06-02T03:00:00.000Z',
    };
    const form = questionToForm(q);
    expect(form.figures[0].anchor).toEqual({ target: 'option', ref: 'A' });
    expect(form.figures[1].anchor).toBeUndefined(); // 缺省=题干
  });
});
