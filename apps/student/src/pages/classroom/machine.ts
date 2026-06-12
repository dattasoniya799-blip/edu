/**
 * 课堂模式状态机(纯函数,vitest 单测覆盖)
 *
 * - 快照恢复 reducer:join/重连的 ClassSnapshot → 视图状态;重连合并时本地已有的
 *   完整作答(含选项回显/判分反馈)优先保留,快照只补本地缺失的判定 → 无感恢复。
 * - 随堂练题格状态复用 B5 答题器 machine(items/答题卡取色等,不改其行为)。
 * - AI 答疑流式:class:ai_chunk 按 requestId 渐进拼接到最后一条 assistant 消息。
 */
import type { AnswerResponse, AnswerResult, ClassControl, ClassSnapshot, ParticipantSelfState } from '@qiming/contracts';
import * as M from '../homework/machine';
import type { AttemptQuestionView } from '../homework/types';
import type { ClassJoinSnapshot, CoursewarePageView } from './types';
import type { WsConnState } from './ws/reconnect';

// ---------------- 状态形状 ----------------

export interface ChatMsg {
  role: 'user' | 'assistant';
  text: string;
  /** 流式接收中(渲染打字光标) */
  streaming?: boolean;
  /** 流式消息的 requestId(拼接定位) */
  requestId?: string;
}

export type ConnView = 'connecting' | 'live' | 'reconnecting' | 'closed';

export interface ClassState {
  conn: ConnView;
  /** 重连第几次(conn=reconnecting 时显示) */
  reconnectAttempt: number;
  session: ClassSnapshot['session'] | null;
  /** 随堂练题面(mock B5-1 增量;可能缺失 → 降级) */
  questions: AttemptQuestionView[];
  /** 课件分页(mock 增量;可能缺失 → 降级) */
  courseware: CoursewarePageView[];
  /** 当前环节 seq(1 回顾 / 2 课件 / 3 随堂练 / 4 小结) */
  seg: number;
  paused: boolean;
  ended: boolean;
  /** 底部 AI 旁白条文案 */
  narration: string;
  /** 随堂练题格(复用 B5 machine) */
  quiz: M.QuizState;
  /** 大题预批旁白(questionId → AnswerResult.narration) */
  preGrade: Record<number, string>;
  /** 本堂新收错题 questionId */
  wrongAdded: number[];
  /** class:state 自身进度 */
  self: ParticipantSelfState | null;
  chat: ChatMsg[];
  /** 是否经历过断线重连恢复 */
  resumed: boolean;
}

export const initialClassState: ClassState = {
  conn: 'connecting', reconnectAttempt: 0,
  session: null, questions: [], courseware: [],
  seg: 1, paused: false, ended: false, narration: '',
  quiz: { current: 0, items: [] },
  preGrade: {}, wrongAdded: [], self: null, chat: [], resumed: false,
};

// ---------------- 事件 ----------------

export type ClassAction =
  | { type: 'snapshot'; snap: ClassJoinSnapshot; resumed: boolean }
  | { type: 'conn'; state: WsConnState }
  | { type: 'narration'; text: string }
  | { type: 'segment'; seq: number }
  | { type: 'goto'; index: number }
  | { type: 'flag'; questionId: number }
  | { type: 'answered'; questionId: number; response: AnswerResponse; result: AnswerResult }
  | { type: 'ai_user'; text: string }
  | { type: 'ai_chunk'; requestId: string; delta: string; done: boolean }
  | { type: 'control'; control: ClassControl }
  | { type: 'state'; self: ParticipantSelfState };

// ---------------- 快照恢复 ----------------

/** 快照里只有判定没有作答负载 → 占位 response(答题卡计已答;面板按 restored 反馈展示) */
const RESTORED_RESPONSE: AnswerResponse = { text: '(已作答 · 续答恢复)' };

/**
 * 由快照重建/合并随堂练题格:
 * 本地已有完整作答(response 非占位)→ 整项保留;否则按快照判定恢复(restored 反馈)。
 * 当前题:快照 me.currentQuestion 优先,找不到则回到第一道未答题。
 */
export function quizFromSnapshot(
  snap: ClassSnapshot, questions: AttemptQuestionView[], prev?: M.QuizState,
): M.QuizState {
  const byQid = new Map(snap.me.answers.map((a) => [a.questionId, a]));
  const items: M.ItemState[] = questions.map((q) => {
    const local = prev?.items.find((it) => it.questionId === q.questionId);
    if (local && local.response != null) return local; // 本地更完整 → 无感保留
    const sa = byQid.get(q.questionId);
    if (!sa) return local ?? { questionId: q.questionId, response: null, flagged: false, feedback: null };
    return {
      questionId: q.questionId,
      response: RESTORED_RESPONSE,
      flagged: local?.flagged ?? false,
      feedback: {
        judged: sa.isCorrect != null,
        isCorrect: sa.isCorrect,
        correctAnswer: null,
        analysisLatex: null,
        restored: true,
      },
    };
  });
  const fromSnap = snap.me.currentQuestion != null
    ? items.findIndex((it) => it.questionId === snap.me.currentQuestion)
    : -1;
  return { items, current: fromSnap !== -1 ? fromSnap : M.firstUnanswered(items) };
}

export function applySnapshot(s: ClassState, snap: ClassJoinSnapshot, resumed: boolean): ClassState {
  const questions = Array.isArray(snap.questions) && snap.questions.length > 0 ? snap.questions : s.questions;
  const courseware = Array.isArray(snap.courseware) && snap.courseware.length > 0 ? snap.courseware : s.courseware;
  const tail: ChatMsg[] = snap.me.aiChatTail.map((m) => ({ role: m.role, text: m.text }));
  return {
    ...s,
    conn: 'live',
    reconnectAttempt: 0,
    session: snap.session,
    questions,
    courseware,
    seg: snap.session.mode.syncSegments ? snap.session.currentSegmentSeq : (snap.me.segment || snap.session.currentSegmentSeq || 1),
    paused: snap.session.status === 'paused',
    ended: snap.session.status === 'ended',
    quiz: quizFromSnapshot(snap, questions, resumed ? s.quiz : undefined),
    wrongAdded: snap.me.wrongBookAdded.length >= s.wrongAdded.length ? snap.me.wrongBookAdded : s.wrongAdded,
    chat: s.chat.length >= tail.length ? s.chat : tail, // 本地对话更全 → 保留(无感)
    resumed: s.resumed || resumed,
  };
}

// ---------------- AI 流式 ----------------

function applyAiChunk(chat: ChatMsg[], requestId: string, delta: string, done: boolean): ChatMsg[] {
  const idx = chat.findIndex((m) => m.streaming && m.requestId === requestId);
  if (idx === -1) {
    // 该 requestId 的首个分片 → 新起一条 assistant 消息
    return [...chat, { role: 'assistant', text: delta, streaming: !done, requestId }];
  }
  return chat.map((m, i) =>
    i === idx ? { ...m, text: m.text + delta, streaming: done ? false : m.streaming } : m,
  );
}

// ---------------- reducer ----------------

export function reduceClass(s: ClassState, a: ClassAction): ClassState {
  switch (a.type) {
    case 'snapshot':
      return applySnapshot(s, a.snap, a.resumed);
    case 'conn': {
      if (a.state.phase === 'live') return { ...s, conn: 'live', reconnectAttempt: 0 };
      if (a.state.phase === 'closed') return { ...s, conn: 'closed' };
      if (s.session == null) return { ...s, conn: 'connecting' }; // 首连尚未拿到快照
      return { ...s, conn: 'reconnecting', reconnectAttempt: a.state.attempt };
    }
    case 'narration':
      return { ...s, narration: a.text };
    case 'segment': {
      const max = Math.max(1, s.session?.segments.length ?? 4);
      return { ...s, seg: Math.min(max, Math.max(1, a.seq)) };
    }
    case 'goto':
      return { ...s, quiz: M.goTo(s.quiz, a.index) };
    case 'flag':
      return { ...s, quiz: M.toggleFlag(s.quiz, a.questionId) };
    case 'answered': {
      const fb: M.Feedback = {
        judged: a.result.judged,
        isCorrect: a.result.isCorrect,
        correctAnswer: a.result.correctAnswer,
        analysisLatex: null, // 契约 AnswerResult 无解析字段,引导走 narration
      };
      return {
        ...s,
        quiz: M.applyAnswer(s.quiz, a.questionId, a.response, fb),
        narration: a.result.narration ?? s.narration,
        preGrade: !a.result.judged && a.result.narration
          ? { ...s.preGrade, [a.questionId]: a.result.narration }
          : s.preGrade,
        wrongAdded: a.result.isCorrect === false && !s.wrongAdded.includes(a.questionId)
          ? [...s.wrongAdded, a.questionId]
          : s.wrongAdded,
      };
    }
    case 'ai_user':
      return { ...s, chat: [...s.chat, { role: 'user', text: a.text }] };
    case 'ai_chunk':
      return { ...s, chat: applyAiChunk(s.chat, a.requestId, a.delta, a.done) };
    case 'control': {
      const c = a.control;
      if (c.action === 'pause') return { ...s, paused: true };
      if (c.action === 'resume') return { ...s, paused: false };
      if (c.action === 'end') return { ...s, ended: true, paused: false, seg: Math.max(1, s.session?.segments.length ?? 4) };
      return reduceClass(s, { type: 'segment', seq: c.segmentSeq });
    }
    case 'state':
      return { ...s, self: a.self };
  }
}

// ---------------- 派生 ----------------

/** 随堂练答对数(本地题格口径,小结页展示) */
export function practiceStats(s: ClassState): { answered: number; correct: number; total: number } {
  const answered = s.quiz.items.filter((it) => it.response != null).length;
  const correct = s.quiz.items.filter((it) => it.feedback?.isCorrect === true).length;
  return { answered, correct, total: s.quiz.items.length };
}
