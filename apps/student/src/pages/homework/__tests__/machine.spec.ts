/**
 * 答题器状态机单测:进行中/已答/已标记/续答恢复 等关键转移(任务卡 B5 验收)
 */
import { describe, expect, it } from 'vitest';
import type { AttemptDto } from '@qiming/contracts';
import {
  allAnswered, answeredCount, applyAnswer, deriveItems, firstUnanswered,
  goTo, initQuiz, nextIndex, slotTone, toggleFlag,
} from '../machine';

/** 快照:5 题,前 2 题已答(q2 答错),q3 已标记未答 */
const snapshot: Pick<AttemptDto, 'answers'> = {
  answers: [
    { questionId: 11, response: { choice: 'B' }, isCorrect: true, score: 5, flagged: false },
    { questionId: 12, response: { choice: 'A' }, isCorrect: false, score: 0, flagged: false },
    { questionId: 13, response: null, isCorrect: null, score: null, flagged: true },
    { questionId: 14, response: null, isCorrect: null, score: null, flagged: false },
    { questionId: 15, response: null, isCorrect: null, score: null, flagged: false },
  ],
};

describe('断点续答恢复(deriveItems / initQuiz)', () => {
  it('已答题恢复 response/判定,并标记为 restored(契约不重发解析)', () => {
    const items = deriveItems(snapshot);
    expect(items[0].response).toEqual({ choice: 'B' });
    expect(items[0].feedback).toMatchObject({ judged: true, isCorrect: true, restored: true });
    expect(items[1].feedback).toMatchObject({ judged: true, isCorrect: false });
    expect(items[1].feedback?.analysisLatex).toBeNull();
  });

  it('未答题 feedback=null,flagged 恢复', () => {
    const items = deriveItems(snapshot);
    expect(items[2]).toMatchObject({ response: null, feedback: null, flagged: true });
  });

  it('恢复后定位到第一道未答题', () => {
    expect(initQuiz(snapshot).current).toBe(2);
  });

  it('全部已答时定位到最后一题', () => {
    const all = { answers: snapshot.answers.map((a) => ({ ...a, response: { choice: 'B' }, isCorrect: true })) };
    expect(firstUnanswered(deriveItems(all))).toBe(4);
  });

  it('主观题已答(isCorrect=null)恢复为 judged=false(待批改)', () => {
    const s = { answers: [{ questionId: 9, response: { photoOssKey: 'k.jpg' }, isCorrect: null, score: null, flagged: false }] };
    expect(deriveItems(s)[0].feedback).toMatchObject({ judged: false, isCorrect: null });
  });
});

describe('作答与标记转移', () => {
  it('applyAnswer 写入 response 与判分反馈,且不可变更新', () => {
    const s0 = initQuiz(snapshot);
    const s1 = applyAnswer(s0, 13, { texts: ['y=2x-3'] }, { judged: true, isCorrect: true, correctAnswer: null, analysisLatex: null });
    expect(s1.items[2].response).toEqual({ texts: ['y=2x-3'] });
    expect(s1.items[2].feedback?.isCorrect).toBe(true);
    expect(s0.items[2].response).toBeNull(); // 原状态不被改写
  });

  it('答错时反馈携带正确答案与解析', () => {
    const s1 = applyAnswer(initQuiz(snapshot), 14, { choice: 'A' }, { judged: true, isCorrect: false, correctAnswer: 'B', analysisLatex: '上加下减' });
    expect(s1.items[3].feedback).toMatchObject({ isCorrect: false, correctAnswer: 'B', analysisLatex: '上加下减' });
  });

  it('toggleFlag 在同一题上来回切换', () => {
    const s0 = initQuiz(snapshot);
    const s1 = toggleFlag(s0, 14);
    expect(s1.items[3].flagged).toBe(true);
    expect(toggleFlag(s1, 14).items[3].flagged).toBe(false);
  });

  it('goTo 越界被钳制', () => {
    const s0 = initQuiz(snapshot);
    expect(goTo(s0, 99).current).toBe(4);
    expect(goTo(s0, -3).current).toBe(0);
  });

  it('nextIndex 优先跳当前题之后的未答题,否则回卷至前面的未答题', () => {
    const s0 = goTo(initQuiz(snapshot), 3);
    expect(nextIndex(s0)).toBe(4);
    // 答完 4、5 后从第 5 题回卷到第 3 题(下标 2)
    let s = applyAnswer(s0, 14, { choice: 'B' }, { judged: true, isCorrect: true, correctAnswer: null, analysisLatex: null });
    s = applyAnswer(s, 15, { choice: 'B' }, { judged: true, isCorrect: true, correctAnswer: null, analysisLatex: null });
    s = goTo(s, 4);
    expect(nextIndex(s)).toBe(2);
  });

  it('answeredCount / allAnswered', () => {
    const s0 = initQuiz(snapshot);
    expect(answeredCount(s0)).toBe(2);
    expect(allAnswered(s0)).toBe(false);
    let s = s0;
    for (const qid of [13, 14, 15]) s = applyAnswer(s, qid, { choice: 'B' }, { judged: true, isCorrect: true, correctAnswer: null, analysisLatex: null });
    expect(allAnswered(s)).toBe(true);
  });
});

describe('答题卡格子状态(当前 > 标记 > 已答 > 未答)', () => {
  it('与原型图例一致', () => {
    const s = initQuiz(snapshot); // current = 2(同时 flagged → current 优先)
    expect(slotTone(s, 2)).toBe('current');
    expect(slotTone(s, 0)).toBe('answered');
    expect(slotTone(s, 3)).toBe('todo');
    const s2 = goTo(s, 0);
    expect(slotTone(s2, 2)).toBe('flagged');
  });
});
