/**
 * 课堂 WS 假服务(B6:本地 socket.io 假服务,行为对齐 A6,见 apps/server/README.md A6 节)
 *
 * - 命名空间 /classroom;握手 auth.token 校验(mock:接受 data.ts 签发口径的 mock-token-*)
 * - class:join → ack 完整 ClassSnapshot(+ mock 增量 questions/courseware,B5-1 形状);
 *   join 被拒时 ack 不回包,经 'exception' 下发(A6 口径)
 * - class:heartbeat 驱动 stuck 检测(idleSec ≥ 阈值 → state=stuck;回落复位)
 * - class:answer 即时判分(复用 student-store 的 A5 判分口径)+ 模板 narration;
 *   解答题 judged=false 进预批队列,narration 携带预批要点
 * - class:ai_ask → class:ai_chunk 流式分片下发(SSE 式)
 * - class:control 广播(教师/系统下发;学生 socket 发该事件 → exception 拒绝);
 *   测试/演示经返回句柄的 control() 触发
 * - 学生状态按 token 驻留内存(server 进程存活期间断线重连不丢 → 快照恢复)
 *
 * 用法:dev 由 vite 插件挂到 dev server(npm run dev 即生效);测试挂到临时 http server。
 */
import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import type {
  AnswerResult, C2SEvents, ClassControl, ClassSnapshot, ParticipantSelfState, ParticipantState, S2CEvents,
} from '@qiming/contracts';
import * as CD from './class-data';
import * as D from './data';
import { formatCorrectAnswer, judge } from './student-store';

/** exception 负载对齐真实网关 classroom.gateway:status 恒为字符串 'error',非 HTTP 状态码 */
type S2CWithException = S2CEvents & { exception: (p: { status: 'error'; message: string }) => void };

// ---------------- 驻留状态(server 进程内,模拟 A6 Redis 热状态) ----------------

interface StudentHot {
  segment: number;
  currentQuestion: number | null;
  answers: { questionId: number; isCorrect: boolean | null; score: number | null }[];
  wrongBookAdded: number[];
  aiChatTail: { role: 'user' | 'assistant'; text: string }[];
  state: ParticipantState;
  heartbeatCount: number;
  lastIdleSec: number;
  aiAskCount: number;
}

export interface ClassroomMockState {
  session: { id: number; status: ClassSnapshot['session']['status']; startedAt: number; currentSegmentSeq: number };
  students: Map<string, StudentHot>; // key = auth.token(mock 身份)
}

export function createClassroomMockState(): ClassroomMockState {
  return {
    session: { id: CD.CLASS_SESSION_ID, status: 'live', startedAt: Date.now(), currentSegmentSeq: 1 },
    students: new Map(),
  };
}

export interface ClassroomMockOptions {
  /** join/切环节后旁白下发延迟 */
  narrationDelayMs?: number;
  /** AI 流式分片间隔 */
  aiChunkMs?: number;
  /** 每片字符数 */
  aiChunkSize?: number;
  /** stuck 阈值秒(默认 mode.stuckAlertMin × 60;测试可注入) */
  stuckThresholdSec?: number;
}

export interface ClassroomMockHandle {
  state: ClassroomMockState;
  /** 教师/系统下发课堂控制(广播 class:control,与 A6 行为一致) */
  control(c: ClassControl): void;
  /** 测试断言用 */
  getStudent(token: string): StudentHot | undefined;
  close(): Promise<void>;
}

// ---------------- 挂载 ----------------

export function attachClassroomMock(
  httpServer: HttpServer,
  state: ClassroomMockState = createClassroomMockState(),
  opts: ClassroomMockOptions = {},
): ClassroomMockHandle {
  const narrationDelayMs = opts.narrationDelayMs ?? 150;
  const aiChunkMs = opts.aiChunkMs ?? 24;
  const aiChunkSize = opts.aiChunkSize ?? 4;
  const stuckThresholdSec = opts.stuckThresholdSec ?? CD.CLASS_MODE.stuckAlertMin * 60;

  const io = new Server<C2SEvents, S2CWithException>(httpServer, {
    cors: { origin: true },
    transports: ['websocket', 'polling'],
  });
  const nsp = io.of('/classroom');
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let aiSeq = 0;

  const later = (ms: number, fn: () => void): void => {
    const t = setTimeout(() => { timers.delete(t); fn(); }, ms);
    timers.add(t);
  };

  // 握手鉴权(A6:无效 JWT → connect_error 拒绝连接;mock 校验 token 形状)
  nsp.use((socket, next) => {
    const token = (socket.handshake.auth as { token?: string }).token;
    if (!token || !token.startsWith('mock-token')) return next(new Error('未登录或登录已过期'));
    next();
  });

  const hotOf = (token: string): StudentHot => {
    let hot = state.students.get(token);
    if (!hot) {
      hot = {
        segment: state.session.currentSegmentSeq, currentQuestion: null,
        answers: [], wrongBookAdded: [], aiChatTail: [],
        state: 'normal', heartbeatCount: 0, lastIdleSec: 0, aiAskCount: 0,
      };
      state.students.set(token, hot);
    }
    return hot;
  };

  const snapshotOf = (hot: StudentHot): ClassSnapshot => ({
    session: {
      id: state.session.id,
      status: state.session.status,
      lessonTitle: CD.CLASS_LESSON_TITLE,
      segments: CD.CLASS_SEGMENTS,
      currentSegmentSeq: state.session.currentSegmentSeq,
      elapsedSec: Math.floor((Date.now() - state.session.startedAt) / 1000),
      mode: CD.CLASS_MODE,
    },
    me: {
      segment: hot.segment,
      currentQuestion: hot.currentQuestion,
      answers: hot.answers.map((a) => ({ ...a })),
      wrongBookAdded: [...hot.wrongBookAdded],
      aiChatTail: hot.aiChatTail.slice(-10),
    },
  });

  const selfStateOf = (hot: StudentHot): ParticipantSelfState => ({
    segment: hot.segment,
    state: hot.state,
    answeredCount: hot.answers.length,
    correctCount: hot.answers.filter((a) => a.isCorrect === true).length,
  });

  const pushTail = (hot: StudentHot, role: 'user' | 'assistant', text: string): void => {
    hot.aiChatTail.push({ role, text });
    if (hot.aiChatTail.length > 10) hot.aiChatTail.splice(0, hot.aiChatTail.length - 10);
  };

  nsp.on('connection', (socket) => {
    const token = (socket.handshake.auth as { token: string }).token;
    let joined = false;

    socket.on('class:join', (p, ack) => {
      // A6:join 被拒时 ack 不回包,异常经 'exception'
      if (p.sessionId !== state.session.id) {
        socket.emit('exception', { status: 'error', message: '课堂不存在或不属于你' });
        return;
      }
      if (state.session.status === 'ended') {
        socket.emit('exception', { status: 'error', message: '课堂已结束' });
        return;
      }
      const hot = hotOf(token);
      joined = true;
      void socket.join(`session:${state.session.id}`);
      // 真实模式下 ClassSnapshot 已含可选 questions/courseware([2026-06-14 批准·B6课堂]),类型自然通过,无需强制转换
      ack({ ...snapshotOf(hot), questions: CD.CLASS_QUESTIONS, courseware: CD.CLASS_COURSEWARE });
      socket.emit('class:state', selfStateOf(hot));
      later(narrationDelayMs, () => {
        if (socket.connected) socket.emit('class:narration', { text: CD.SEGMENT_NARRATIONS[hot.segment] ?? '' });
      });
    });

    socket.on('class:segment', (p) => {
      if (!joined) return;
      const hot = hotOf(token);
      const max = CD.CLASS_SEGMENTS.length;
      hot.segment = Math.min(max, Math.max(1, p.segmentSeq));
      socket.emit('class:state', selfStateOf(hot));
      later(narrationDelayMs, () => {
        if (socket.connected) socket.emit('class:narration', { text: CD.SEGMENT_NARRATIONS[hot.segment] ?? '' });
      });
    });

    socket.on('class:answer', (p, ack) => {
      if (!joined) return;
      const hot = hotOf(token);
      const pq = CD.CLASS_PAPER.find((x) => x.questionId === p.questionId);
      const q = D.questions.find((x) => x.id === p.questionId);
      if (!pq || !q) {
        socket.emit('exception', { status: 'error', message: '非本卷题目' });
        return;
      }
      const isCorrect = judge(q, p.response); // A5 判分口径(student-store 复用)
      const judged = q.type !== 'solution';
      const slot = hot.answers.find((a) => a.questionId === p.questionId);
      const entry = {
        questionId: p.questionId,
        isCorrect,
        score: isCorrect == null ? null : isCorrect ? pq.score : 0,
      };
      if (slot) Object.assign(slot, entry);
      else hot.answers.push(entry);
      hot.currentQuestion = p.questionId;
      if (isCorrect === false && !hot.wrongBookAdded.includes(p.questionId)) hot.wrongBookAdded.push(p.questionId);

      const result: AnswerResult = {
        questionId: p.questionId,
        judged,
        isCorrect,
        correctAnswer: isCorrect === false ? formatCorrectAnswer(q) : null,
        narration: !judged ? CD.NARRATION_PRE_GRADE : isCorrect ? CD.NARRATION_CORRECT : CD.NARRATION_WRONG,
      };
      ack(result);
      socket.emit('class:state', selfStateOf(hot));
    });

    socket.on('class:ai_ask', (p) => {
      if (!joined) return;
      const hot = hotOf(token);
      hot.aiAskCount += 1;
      pushTail(hot, 'user', p.message);
      const reply = CD.AI_REPLIES.find((r) => p.message.includes(r.key))?.reply ?? CD.AI_DEFAULT_REPLY;
      const requestId = `req-${++aiSeq}`;
      const pieces: string[] = [];
      for (let i = 0; i < reply.length; i += aiChunkSize) pieces.push(reply.slice(i, i + aiChunkSize));
      pieces.forEach((delta, i) => {
        later(aiChunkMs * (i + 1), () => {
          if (!socket.connected) return;
          socket.emit('class:ai_chunk', { requestId, delta, done: i === pieces.length - 1 });
          if (i === pieces.length - 1) pushTail(hot, 'assistant', reply);
        });
      });
    });

    socket.on('class:heartbeat', (p) => {
      if (!joined) return;
      const hot = hotOf(token);
      hot.heartbeatCount += 1;
      hot.lastIdleSec = p.idleSec;
      if (p.currentQuestion != null) hot.currentQuestion = p.currentQuestion;
      // 心跳驱动 stuck(A6:超阈值进告警,回落复位;hand_up 状态不被心跳覆盖)
      if (hot.state !== 'hand_up') hot.state = p.idleSec >= stuckThresholdSec ? 'stuck' : 'normal';
    });

    socket.on('class:hand_up', () => {
      if (!joined) return;
      hotOf(token).state = 'hand_up';
    });

    // 契约 C2S 有 class:control(教师下发,服务端校验仅本课教师);本假服务只接学生端 → 一律拒绝
    socket.on('class:control', () => {
      socket.emit('exception', { status: 'error', message: '仅本课教师可下发课堂控制' });
    });
  });

  return {
    state,
    control(c: ClassControl) {
      if (c.action === 'pause') state.session.status = 'paused';
      if (c.action === 'resume') state.session.status = 'live';
      if (c.action === 'end') state.session.status = 'ended';
      if (c.action === 'force_segment') {
        state.session.currentSegmentSeq = c.segmentSeq;
        for (const hot of state.students.values()) hot.segment = c.segmentSeq;
      }
      nsp.emit('class:control', c);
    },
    getStudent: (token: string) => state.students.get(token),
    async close() {
      for (const t of timers) clearTimeout(t);
      timers.clear();
      await io.close();
    },
  };
}
