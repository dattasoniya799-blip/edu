/**
 * 课堂状态机单测(任务卡验收:快照恢复 reducer 等关键逻辑 vitest 单测)
 * 覆盖:join 快照渲染 / 重连快照无感合并(已答不丢、回到原题)/ 作答与预批 /
 *       AI 流式渐进拼接 / control 暂停⇄恢复/下课 / 环节切换钳位
 */
import { describe, expect, it } from 'vitest';
import type { AnswerResult } from '@qiming/contracts';
import {
  initialClassState, practiceStats, quizFromSnapshot, reduceClass, type ClassState,
} from '../machine';
import type { ClassJoinSnapshot } from '../types';
import { CLASS_COURSEWARE, CLASS_QUESTIONS, CLASS_SEGMENTS, CLASS_MODE, CLASS_SESSION_ID, CLASS_LESSON_TITLE } from '../../../mocks/class-data';

function snap(partialMe: Partial<ClassJoinSnapshot['me']> = {}, status: 'live' | 'paused' | 'ended' = 'live'): ClassJoinSnapshot {
  return {
    session: {
      id: CLASS_SESSION_ID, status, lessonTitle: CLASS_LESSON_TITLE,
      segments: CLASS_SEGMENTS, currentSegmentSeq: 1, elapsedSec: 120, mode: CLASS_MODE,
    },
    me: {
      segment: 1, currentQuestion: null, answers: [], wrongBookAdded: [], aiChatTail: [],
      ...partialMe,
    },
    questions: CLASS_QUESTIONS,
    courseware: CLASS_COURSEWARE,
  };
}

const joined = (s = initialClassState, me: Partial<ClassJoinSnapshot['me']> = {}): ClassState =>
  reduceClass(s, { type: 'snapshot', snap: snap(me), resumed: false });

const okResult = (questionId: number): AnswerResult =>
  ({ questionId, judged: true, isCorrect: true, correctAnswer: null, narration: '答对啦' });
const wrongResult = (questionId: number): AnswerResult =>
  ({ questionId, judged: true, isCorrect: false, correctAnswer: 'B', narration: '记住上加下减' });

describe('join 快照渲染', () => {
  it('快照 → session/题面/课件/环节/旁白通道就绪;空作答 → 第 1 题', () => {
    const s = joined();
    expect(s.conn).toBe('live');
    expect(s.session?.lessonTitle).toBe(CLASS_LESSON_TITLE);
    expect(s.questions).toHaveLength(5);
    expect(s.courseware).toHaveLength(3);
    expect(s.seg).toBe(1);
    expect(s.quiz.items).toHaveLength(5);
    expect(s.quiz.current).toBe(0);
  });

  it('快照已有判定(中途加入)→ 已答恢复为 restored 反馈,当前题= me.currentQuestion', () => {
    const s = joined(initialClassState, {
      segment: 3,
      currentQuestion: 3,
      answers: [
        { questionId: 1, isCorrect: true, score: 5 },
        { questionId: 2, isCorrect: false, score: 0 },
      ],
      wrongBookAdded: [2],
    });
    expect(s.seg).toBe(3);
    expect(s.quiz.current).toBe(2); // questionId 3 是卷面第 3 题
    const [a1, a2] = s.quiz.items;
    expect(a1.feedback).toMatchObject({ isCorrect: true, restored: true });
    expect(a2.feedback).toMatchObject({ isCorrect: false, restored: true });
    expect(practiceStats(s)).toEqual({ answered: 2, correct: 1, total: 5 });
    expect(s.wrongAdded).toEqual([2]);
  });

  it('题面缺失(契约 B6-1 未落地)→ 不白屏,quiz 空(组件降级占位)', () => {
    const noQ = { ...snap(), questions: undefined, courseware: undefined };
    const s = reduceClass(initialClassState, { type: 'snapshot', snap: noQ, resumed: false });
    expect(s.questions).toEqual([]);
    expect(s.quiz.items).toEqual([]);
    expect(s.courseware).toEqual([]);
  });
});

describe('断线重连:快照无感恢复(验收:回到原题且已答不丢)', () => {
  it('本地完整作答优先保留(响应负载/判分反馈不被快照占位覆盖)', () => {
    let s = joined();
    s = reduceClass(s, { type: 'answered', questionId: 1, response: { choice: 'B' }, result: okResult(1) });
    s = reduceClass(s, { type: 'answered', questionId: 2, response: { choice: 'A' }, result: wrongResult(2) });
    s = reduceClass(s, { type: 'goto', index: 2 });

    // 重连:服务端快照含两题判定 + 当前题 q3
    const resumeSnap = snap({
      currentQuestion: 3,
      answers: [
        { questionId: 1, isCorrect: true, score: 5 },
        { questionId: 2, isCorrect: false, score: 0 },
      ],
      wrongBookAdded: [2],
    });
    s = reduceClass(s, { type: 'snapshot', snap: resumeSnap, resumed: true });

    expect(s.resumed).toBe(true);
    expect(s.quiz.current).toBe(2);                                  // 回到原题
    expect(s.quiz.items[0].response).toEqual({ choice: 'B' });       // 本地负载保留(无感)
    expect(s.quiz.items[1].response).toEqual({ choice: 'A' });
    expect(s.quiz.items[1].feedback?.correctAnswer).toBe('B');       // 本地判分反馈保留
    expect(s.quiz.items[1].feedback?.restored).toBeUndefined();
    expect(practiceStats(s)).toEqual({ answered: 2, correct: 1, total: 5 });
  });

  it('刷新后重进(无本地状态)→ 以快照恢复 restored 反馈,已答计数一致', () => {
    const q = quizFromSnapshot(
      snap({ currentQuestion: 2, answers: [{ questionId: 1, isCorrect: true, score: 5 }] }),
      CLASS_QUESTIONS,
    );
    expect(q.current).toBe(1);
    expect(q.items[0].response).not.toBeNull();
    expect(q.items[0].feedback).toMatchObject({ judged: true, isCorrect: true, restored: true });
  });

  it('重连快照的 aiChatTail 不回退本地更全的对话', () => {
    let s = joined();
    s = reduceClass(s, { type: 'ai_user', text: '提示一下' });
    s = reduceClass(s, { type: 'ai_chunk', requestId: 'r1', delta: '想想 b 怎么变', done: true });
    const resume = snap({ aiChatTail: [{ role: 'user', text: '提示一下' }] });
    s = reduceClass(s, { type: 'snapshot', snap: resume, resumed: true });
    expect(s.chat).toHaveLength(2); // 本地 2 条 > 快照 1 条 → 保留本地
  });
});

describe('作答与大题预批', () => {
  it('客观题判错:反馈带 correctAnswer,narration 上旁白条,错题进 wrongAdded', () => {
    let s = joined();
    s = reduceClass(s, { type: 'answered', questionId: 1, response: { choice: 'A' }, result: wrongResult(1) });
    expect(s.quiz.items[0].feedback).toMatchObject({ judged: true, isCorrect: false, correctAnswer: 'B' });
    expect(s.narration).toBe('记住上加下减');
    expect(s.wrongAdded).toEqual([1]);
  });

  it('解答题(大题):judged=false → narration 存入 preGrade(预批结果卡)', () => {
    let s = joined();
    const r: AnswerResult = { questionId: 4, judged: false, isCorrect: null, correctAnswer: null, narration: 'AI 预批 · 8/10\n✓ 步骤 1\n✕ 步骤 3' };
    s = reduceClass(s, { type: 'answered', questionId: 4, response: { photoOssKey: 'mock/up/1.jpg' }, result: r });
    expect(s.preGrade[4]).toContain('✕ 步骤 3');
    expect(s.quiz.items[4].feedback?.judged).toBe(false);
  });
});

describe('control 与环节', () => {
  it('pause → paused;resume → 恢复;end → ended 并落到末环节(小结)', () => {
    let s = joined();
    s = reduceClass(s, { type: 'control', control: { action: 'pause' } });
    expect(s.paused).toBe(true);
    s = reduceClass(s, { type: 'control', control: { action: 'resume' } });
    expect(s.paused).toBe(false);
    s = reduceClass(s, { type: 'control', control: { action: 'end' } });
    expect(s.ended).toBe(true);
    expect(s.seg).toBe(CLASS_SEGMENTS.length);
  });

  it('force_segment / 本地切环节均钳位在 1..环节数', () => {
    let s = joined();
    s = reduceClass(s, { type: 'control', control: { action: 'force_segment', segmentSeq: 99 } });
    expect(s.seg).toBe(CLASS_SEGMENTS.length);
    s = reduceClass(s, { type: 'segment', seq: 0 });
    expect(s.seg).toBe(1);
  });
});

describe('AI 流式(class:ai_chunk 渐进拼接)', () => {
  it('同一 requestId 分片渐进追加;done 关闭 streaming;新 requestId 另起消息', () => {
    let s = joined();
    s = reduceClass(s, { type: 'ai_user', text: '给我一点提示' });
    const grow: string[] = [];
    for (const [delta, done] of [['想一想:', false], ['k 和 b ', false], ['谁会变?', true]] as const) {
      s = reduceClass(s, { type: 'ai_chunk', requestId: 'r1', delta, done });
      grow.push(s.chat.at(-1)!.text);
    }
    expect(grow).toEqual(['想一想:', '想一想:k 和 b ', '想一想:k 和 b 谁会变?']); // 渐进渲染
    expect(s.chat.at(-1)!.streaming).toBe(false);
    s = reduceClass(s, { type: 'ai_chunk', requestId: 'r2', delta: '新问题', done: false });
    expect(s.chat).toHaveLength(3);
    expect(s.chat.at(-1)).toMatchObject({ role: 'assistant', text: '新问题', streaming: true });
  });
});
