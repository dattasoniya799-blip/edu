/**
 * 学生域有状态 mock 单测:断点续答幂等 / 判分口径(blank 归一化、判错才下发解析)/
 * 交卷出分 / 错题入账与「重做对 2 次移出」(口径对齐 A5,apps/server/README.md)
 */
import { beforeEach, describe, expect, it } from 'vitest';
import * as D from '../data';
import {
  StoreError, formatCorrectAnswer, getAttempt, isFormulaBlank, judge, listAssignments, listWrongBook,
  normalizeBlank, putAnswer, redoAll, redoOne, resetStore, startAttempt, submitAttempt, todayView,
} from '../student-store';

beforeEach(() => resetStore());

describe('断点续答(POST /student/attempts 幂等)', () => {
  it('开始作答 → 再次 POST 返回同一 in_progress attempt,已答数据零丢失', () => {
    const a1 = startAttempt(2);
    expect(a1.status).toBe('in_progress');
    expect(a1.attemptNo).toBe(1);
    putAnswer(a1.id, 13, { response: { choice: 'B' } });
    const a2 = startAttempt(2);
    expect(a2.id).toBe(a1.id);
    expect(a2.answers.find((x) => x.questionId === 13)?.response).toEqual({ choice: 'B' });
  });

  it('GET /student/attempts/{id} 快照含题面(questions 学生视图,无答案泄漏)', () => {
    const a = startAttempt(2);
    const snap = getAttempt(a.id);
    expect(snap.questions).toHaveLength(3);
    expect(snap.questions[0]).toMatchObject({ questionId: 13, type: 'single' });
    expect(snap.questions[0].options.length).toBe(4);
    // in_progress 不下发正确答案与解析;选项不含 isCorrect
    expect(snap.questions[0].correctAnswer).toBeNull();
    expect(snap.questions[0].analysisLatex).toBeNull();
    expect(Object.keys(snap.questions[0].options[0])).toEqual(['label', 'contentLatex']);
  });

  it('交卷后再次 POST → attempt_no+1 新开(A5 口径)', () => {
    const a1 = startAttempt(2);
    for (const q of a1.questions) {
      putAnswer(a1.id, q.questionId, { response: q.type === 'solution' ? { photoOssKey: 'k.jpg' } : q.type === 'blank' ? { texts: ['x'] } : { choice: 'A' } });
    }
    submitAttempt(a1.id);
    const a2 = startAttempt(2);
    expect(a2.id).not.toBe(a1.id);
    expect(a2.attemptNo).toBe(2);
  });
});

describe('判分口径(A5)', () => {
  it('single 答对:judged=true,不下发 correctAnswer/解析', () => {
    const a = startAttempt(2);
    const r = putAnswer(a.id, 13, { response: { choice: 'B' } }); // 题库正确项恒 B
    expect(r).toMatchObject({ judged: true, isCorrect: true, correctAnswer: null, analysisLatex: null });
  });

  it('single 答错:下发 correctAnswer 与解析', () => {
    const a = startAttempt(2);
    const r = putAnswer(a.id, 13, { response: { choice: 'A' } });
    expect(r.isCorrect).toBe(false);
    expect(r.correctAnswer).toBe('B');
    expect(r.analysisLatex).toBeTruthy();
  });

  it('blank 归一化:全角字符 + 空格,去空格全角转半角后判对', () => {
    expect(normalizeBlank(' ｙ＝２ｘ − ３ '.replace('−', '-'))).toBe('y=2x-3');
    const a = startAttempt(2);
    const q11 = D.questions[10];
    const right = (q11.answer as { texts: string[] }).texts[0]; // y=2x-3
    const messy = right.split('').join(' ').replace('=', '＝');
    const r = putAnswer(a.id, 11, { response: { texts: [messy] } });
    expect(r.isCorrect).toBe(true);
  });

  it('solution 存 photoOssKey → judged=false(预批队列)', () => {
    const a = startAttempt(2);
    const r = putAnswer(a.id, 4, { response: { photoOssKey: 'mock/uploads/1.jpg' } });
    expect(r).toMatchObject({ judged: false, isCorrect: null });
  });

  it('response 形状与题型不符 → 4000;非本卷题目 → 4040;交卷后作答 → 4502', () => {
    const a = startAttempt(2);
    expect(() => putAnswer(a.id, 13, { response: { texts: ['B'] } })).toThrowError(StoreError);
    expect(() => putAnswer(a.id, 999, { response: { choice: 'B' } })).toThrowError(/非本卷/);
    putAnswer(a.id, 13, { response: { choice: 'B' } });
    putAnswer(a.id, 11, { response: { texts: ['x'] } });
    putAnswer(a.id, 4, { response: { photoOssKey: 'k.jpg' } });
    submitAttempt(a.id);
    try {
      putAnswer(a.id, 13, { response: { choice: 'B' } });
      expect.unreachable();
    } catch (e) {
      expect((e as StoreError).code).toBe(4502);
    }
  });

  it('multi 乱序判对(judge 纯函数)', () => {
    const q = { ...D.questions[0], type: 'multi' as const, answer: { choices: ['A', 'C'] } };
    expect(judge(q, { choices: ['C', 'A'] })).toBe(true);
    expect(judge(q, { choices: ['A'] })).toBe(false);
    expect(formatCorrectAnswer(q)).toBe('A,C');
  });
});

describe('交卷与出分', () => {
  it('含 solution 的卷:交卷 → submitted,汇总 objectiveScore,score 待出分;重复交卷 → 4502', () => {
    const a = startAttempt(2); // 订正卷:q13(5) q11(5) q4(10)
    putAnswer(a.id, 13, { response: { choice: 'B' } }); // 对 5
    putAnswer(a.id, 11, { response: { texts: ['不对'] } }); // 错 0
    putAnswer(a.id, 4, { response: { photoOssKey: 'k.jpg' } });
    const done = submitAttempt(a.id);
    expect(done.status).toBe('submitted');
    expect(done.objectiveScore).toBe(5);
    expect(done.score).toBeNull();
    expect(() => submitAttempt(a.id)).toThrowError(/重复交卷/);
  });

  it('交卷后快照下发 correctAnswer 与解析(看解析)', () => {
    const a = startAttempt(2);
    for (const q of a.questions) {
      putAnswer(a.id, q.questionId, { response: q.type === 'solution' ? { photoOssKey: 'k.jpg' } : q.type === 'blank' ? { texts: ['x'] } : { choice: 'B' } });
    }
    submitAttempt(a.id);
    const snap = getAttempt(a.id);
    expect(snap.questions[0].correctAnswer).toEqual({ choice: 'B' }); // 契约 QuestionAnswer 对象
    expect(snap.questions[0].analysisLatex).toBeTruthy();
  });

  it('纯客观题卷(错题重做)自动 graded 出分', () => {
    const asg = redoOne(1); // 错题1 = q13 单选
    expect(asg.kind).toBe('wrong_redo');
    expect(asg.scoreCounted).toBe(false);
    const a = startAttempt(asg.id);
    putAnswer(a.id, 13, { response: { choice: 'B' } });
    const done = submitAttempt(a.id);
    expect(done.status).toBe('graded');
    expect(done.score).toBe(5); // redo 卷分值沿用来源卷面分
  });
});

describe('错题本闭环', () => {
  it('seed 6 条错题(口径)', () => {
    expect(listWrongBook()).toHaveLength(6);
    expect(listWrongBook('open')).toHaveLength(6);
  });

  it('重做对 2 次 → cleared 自动移出;已 cleared 再 redo → 4503', () => {
    for (let round = 0; round < 2; round++) {
      const asg = redoOne(1);
      const a = startAttempt(asg.id);
      putAnswer(a.id, 13, { response: { choice: 'B' } });
      submitAttempt(a.id);
      const w = listWrongBook().find((x) => x.id === 1)!;
      expect(w.correctRedoCount).toBe(round + 1);
      expect(w.status).toBe(round === 1 ? 'cleared' : 'open');
    }
    try {
      redoOne(1);
      expect.unreachable();
    } catch (e) {
      expect((e as StoreError).code).toBe(4503);
    }
  });

  it('重做再错:wrong_count+1、保持 open 并重置 correct_redo_count', () => {
    let asg = redoOne(1);
    let a = startAttempt(asg.id);
    putAnswer(a.id, 13, { response: { choice: 'B' } });
    submitAttempt(a.id);
    expect(listWrongBook().find((x) => x.id === 1)?.correctRedoCount).toBe(1);
    asg = redoOne(1);
    a = startAttempt(asg.id);
    putAnswer(a.id, 13, { response: { choice: 'A' } }); // 再错
    submitAttempt(a.id);
    const w = listWrongBook().find((x) => x.id === 1)!;
    expect(w).toMatchObject({ status: 'open', wrongCount: 2, correctRedoCount: 0 });
  });

  it('普通作业判错 → 新错题入账;已有错题不重复建条只 +1', () => {
    const before = listWrongBook().length;
    const a = startAttempt(1); // 第3讲作业重做一遍(attempt_no=2):q9 不在错题本
    putAnswer(a.id, 9, { response: { choice: 'A' } });  // 新错
    putAnswer(a.id, 10, { response: { choice: 'B' } }); // 对
    putAnswer(a.id, 11, { response: { texts: ['不对'] } }); // 已有错题再错
    putAnswer(a.id, 13, { response: { choice: 'B' } });
    putAnswer(a.id, 4, { response: { photoOssKey: 'k.jpg' } });
    submitAttempt(a.id);
    const list = listWrongBook();
    expect(list.length).toBe(before + 1);
    expect(list.find((w) => w.questionId === 9)).toMatchObject({ wrongCount: 1, status: 'open' });
    expect(list.find((w) => w.questionId === 11)).toMatchObject({ wrongCount: 2, status: 'open' });
  });

  it('一键重练:生成全部 open 错题的重练卷', () => {
    expect(redoAll().questionCount).toBe(6);
  });
});

describe('今日任务进度联动', () => {
  it('订正任务进度随作答推进:not_started → in_progress → submitted', () => {
    const t0 = todayView().tasks.find((t) => t.assignmentId === 2)!;
    expect(t0.progress).toMatchObject({ answered: 0, total: 3, status: 'not_started' });
    const a = startAttempt(2);
    putAnswer(a.id, 13, { response: { choice: 'B' } });
    expect(todayView().tasks.find((t) => t.assignmentId === 2)!.progress).toMatchObject({ answered: 1, status: 'in_progress' });
    putAnswer(a.id, 11, { response: { texts: ['x'] } });
    putAnswer(a.id, 4, { response: { photoOssKey: 'k.jpg' } });
    submitAttempt(a.id);
    expect(todayView().tasks.find((t) => t.assignmentId === 2)!.progress.status).toBe('submitted');
  });

  it('assignments 列表 pending/done 过滤', () => {
    expect(listAssignments('pending').map((a) => a.id)).toContain(2);
    expect(listAssignments('done').map((a) => a.id)).toContain(1); // 第3讲作业已 graded
  });
});

describe('公式填空混合判分(2026-06-13 行为约定)', () => {
  it('isFormulaBlank:参考答案含 LaTeX 控制符判为公式填空;简单填空/单选为否', () => {
    expect(isFormulaBlank(D.questions[6])).toBe(true);  // qid 7:y=\dfrac{1}{2}x+1
    expect(isFormulaBlank(D.questions[10])).toBe(false); // qid 11:y=2x-3(简单)
    expect(isFormulaBlank(D.questions[12])).toBe(false); // qid 13:单选
  });

  it('公式填空提交:不即时判分(judged=false、isCorrect=null、不泄漏正确答案/解析)', () => {
    const a = startAttempt(3); // 自检卷:[13 单选, 11 简单填空, 7 公式填空]
    const r = putAnswer(a.id, 7, { response: { texts: ['y=\\dfrac{1}{2}x+1'] } });
    expect(r).toMatchObject({ judged: false, isCorrect: null, correctAnswer: null, analysisLatex: null });
    // 快照里该空 isCorrect 仍为 null、score 为 null(待复核)
    const slot = getAttempt(a.id).answers.find((x) => x.questionId === 7)!;
    expect(slot.isCorrect).toBeNull();
    expect(slot.score).toBeNull();
  });

  it('简单填空仍即时判分(同卷对照,口径不变)', () => {
    const a = startAttempt(3);
    const r = putAnswer(a.id, 11, { response: { texts: ['y=2x-3'] } });
    expect(r).toMatchObject({ judged: true, isCorrect: true });
  });

  it('含公式填空 → 交卷置 submitted(待教师复核),客观题分照常结算', () => {
    const a = startAttempt(3);
    putAnswer(a.id, 13, { response: { choice: 'B' } });           // 单选对 5
    putAnswer(a.id, 11, { response: { texts: ['y=2x-3'] } });     // 简单填空对 5
    putAnswer(a.id, 7, { response: { texts: ['y=\\dfrac{1}{2}x+1'] } }); // 公式填空 → 待批改
    const done = submitAttempt(a.id);
    expect(done.status).toBe('submitted'); // 无解答题,仍因公式填空进复核
    expect(done.objectiveScore).toBe(10);  // 仅两道客观题计分,公式填空不计入
  });
});
