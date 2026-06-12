/**
 * 答题器状态机(纯函数,vitest 单测覆盖)
 * 状态:进行中 / 已答 / 已标记 / 续答恢复(restored);全部不可变更新。
 */
import type { AnswerResponse, AttemptDto } from '@qiming/contracts';

/** 单题确认后的判分反馈(来源:PUT answers 的 SubmitAnswerResult,或续答快照) */
export interface Feedback {
  /** 客观题 true 即时判分;主观题 false(进预批队列) */
  judged: boolean;
  isCorrect: boolean | null;
  /** 判错后下发 */
  correctAnswer: string | null;
  /** 判错后下发 */
  analysisLatex: string | null;
  /** 续答恢复出来的历史判定(契约不重发解析文本,交卷后可看) */
  restored?: boolean;
}

export interface ItemState {
  questionId: number;
  /** 已确认提交的作答;null = 未答 */
  response: AnswerResponse | null;
  flagged: boolean;
  feedback: Feedback | null;
}

export interface QuizState {
  current: number;
  items: ItemState[];
}

/** 从 /student/attempts/{id} 快照恢复每题状态(断点续答) */
export function deriveItems(attempt: Pick<AttemptDto, 'answers'>): ItemState[] {
  return attempt.answers.map((a) => ({
    questionId: a.questionId,
    response: a.response,
    flagged: a.flagged,
    feedback:
      a.response == null
        ? null
        : { judged: a.isCorrect != null, isCorrect: a.isCorrect, correctAnswer: null, analysisLatex: null, restored: true },
  }));
}

/** 第一道未答题的下标;全部已答 → 最后一题 */
export function firstUnanswered(items: ItemState[]): number {
  const i = items.findIndex((it) => it.response == null);
  return i === -1 ? Math.max(items.length - 1, 0) : i;
}

export function initQuiz(attempt: Pick<AttemptDto, 'answers'>): QuizState {
  const items = deriveItems(attempt);
  return { items, current: firstUnanswered(items) };
}

/** 确认答案成功后写入作答与判分反馈 */
export function applyAnswer(s: QuizState, questionId: number, response: AnswerResponse, feedback: Feedback): QuizState {
  return {
    ...s,
    items: s.items.map((it) => (it.questionId === questionId ? { ...it, response, feedback } : it)),
  };
}

export function toggleFlag(s: QuizState, questionId: number): QuizState {
  return {
    ...s,
    items: s.items.map((it) => (it.questionId === questionId ? { ...it, flagged: !it.flagged } : it)),
  };
}

export function goTo(s: QuizState, index: number): QuizState {
  const clamped = Math.max(0, Math.min(s.items.length - 1, index));
  return clamped === s.current ? s : { ...s, current: clamped };
}

/** 当前题之后的下一道未答题;没有则顺延下一题;已是最后一题则停留 */
export function nextIndex(s: QuizState): number {
  const after = s.items.findIndex((it, i) => i > s.current && it.response == null);
  if (after !== -1) return after;
  const before = s.items.findIndex((it) => it.response == null);
  if (before !== -1) return before;
  return Math.min(s.current + 1, s.items.length - 1);
}

export const answeredCount = (s: QuizState): number => s.items.filter((it) => it.response != null).length;
export const allAnswered = (s: QuizState): boolean => answeredCount(s) === s.items.length;

/** 答题卡格子状态:当前(主色)>已标记(橙)>已答(绿)>未答(灰),与原型图例一致 */
export type SlotTone = 'current' | 'flagged' | 'answered' | 'todo';
export function slotTone(s: QuizState, index: number): SlotTone {
  if (index === s.current) return 'current';
  const it = s.items[index];
  if (it.flagged) return 'flagged';
  if (it.response != null) return 'answered';
  return 'todo';
}
