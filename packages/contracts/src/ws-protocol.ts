/**
 * @qiming/contracts · 课堂实时 WebSocket 协议
 * 对应《后端设计文档》7.3 事件协议 与 7.5 断线恢复 snapshot
 * 命名空间 /classroom;鉴权:握手 auth.token = JWT
 */
import type { AnswerResponse, ParticipantState, SegmentType, SessionStatus } from './dto';

// ---------------- Client → Server ----------------
export interface C2SEvents {
  'class:join': (p: { sessionId: number }, ack: (snap: ClassSnapshot) => void) => void;
  'class:segment': (p: { segmentSeq: number }) => void;
  'class:answer': (
    p: { questionId: number; response: AnswerResponse },
    ack: (r: AnswerResult) => void,
  ) => void;
  'class:ai_ask': (p: { questionId: number | null; message: string }) => void; // 回复以 class:ai_chunk 流式下发
  'class:hand_up': (p: Record<string, never>) => void;
  'class:heartbeat': (p: { currentQuestion: number | null; idleSec: number }) => void;
}

// ---------------- Server → Client(学生) ----------------
export interface S2CEvents {
  'class:state': (p: ParticipantSelfState) => void;
  'class:narration': (p: { text: string }) => void;
  'class:ai_chunk': (p: { requestId: string; delta: string; done: boolean }) => void;
  'class:control': (p: ClassControl) => void;
}

// ---------------- Server → Teacher(监控房间) ----------------
export interface S2TEvents {
  'monitor:roster': (p: { participants: ParticipantMonitor[] }) => void; // 5s 节流
  'monitor:alert': (p: { studentId: number; studentName: string; type: 'stuck' | 'hand_up'; detail: string }) => void;
}

export type ClassControl =
  | { action: 'pause' } | { action: 'resume' } | { action: 'end' }
  | { action: 'force_segment'; segmentSeq: number };

export interface AnswerResult {
  questionId: number;
  judged: boolean;            // 客观题 true,主观题 false(进预批队列)
  isCorrect: boolean | null;
  correctAnswer: string | null; // 判错后回传(引导展示解析)
  narration: string | null;     // 模板旁白
}

// ---------------- 断线恢复 snapshot(7.5 验收标准的载体) ----------------
export interface ClassSnapshot {
  session: {
    id: number;
    status: SessionStatus;
    lessonTitle: string;
    segments: { seq: number; type: SegmentType; durationMin: number }[];
    currentSegmentSeq: number;  // 同步模式下的全班环节;自由节奏=me.segment
    elapsedSec: number;
    mode: { guideOnly: boolean; stuckAlertMin: number; lockdown: boolean; syncSegments: boolean };
  };
  me: {
    segment: number;
    currentQuestion: number | null;
    answers: { questionId: number; isCorrect: boolean | null; score: number | null }[];
    wrongBookAdded: number[];   // 本堂新收错题 questionId
    aiChatTail: { role: 'user' | 'assistant'; text: string }[]; // 最近 10 条
  };
}

export interface ParticipantSelfState {
  segment: number; state: ParticipantState;
  answeredCount: number; correctCount: number;
}
export interface ParticipantMonitor {
  studentId: number; studentName: string;
  segment: number; currentQuestion: number | null;
  answeredCount: number; correctCount: number;
  state: ParticipantState; stuckSec: number; aiAskCount: number; online: boolean;
}
