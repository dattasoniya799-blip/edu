/**
 * 课堂 WS 全链路集成(任务卡验收):
 * - socket.io-client 直驱 mock server:join 快照(契约逐字段)→ 四环节走完 → 下课
 * - 模拟断网 10s:监听端口关闭 + 现存连接销毁 → 指数退避重连 → 回到原题且已答不丢
 * - class:ai_ask → class:ai_chunk 流式分片
 * - 心跳驱动(10s 周期可注入)+ idleSec 驱动 stuck
 * - class:control 广播(pause/resume/end);鉴权与越权
 */
import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Socket as NetSocket } from 'node:net';
import { io as connectTo, type Socket } from 'socket.io-client';
import { afterEach, describe, expect, it } from 'vitest';
import type { AnswerResult, C2SEvents, ClassControl, S2CEvents } from '@qiming/contracts';
import * as CM from '../../pages/classroom/machine';
import type { ClassJoinSnapshot } from '../../pages/classroom/types';
import { ClassroomWsClient, type WsExceptionPayload } from '../../pages/classroom/ws/client';
import * as CD from '../class-data';
import {
  attachClassroomMock, createClassroomMockState,
  type ClassroomMockHandle, type ClassroomMockState,
} from '../classroom-server';
import * as D from '../data';

const TOKEN = 'mock-token-student';

type RawSocket = Socket<S2CEvents & { exception: (p: { status: 'error'; message: string }) => void }, C2SEvents>;

// ---------------- 服务器夹具(支持"断网":关监听 + 毁连接,状态驻留) ----------------

interface Srv {
  http: HttpServer;
  handle: ClassroomMockHandle;
  port: number;
  state: ClassroomMockState;
  netDown(): Promise<void>;
  netUp(): Promise<void>;
}

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

async function startServer(opts: Parameters<typeof attachClassroomMock>[2] = {}): Promise<Srv> {
  const state = createClassroomMockState();
  let http!: HttpServer;
  let handle!: ClassroomMockHandle;
  const conns = new Set<NetSocket>();

  const boot = async (port: number): Promise<number> => {
    http = createServer();
    http.on('connection', (s) => { conns.add(s); s.on('close', () => conns.delete(s)); });
    handle = attachClassroomMock(http, state, { narrationDelayMs: 20, aiChunkMs: 5, ...opts });
    await new Promise<void>((res) => http.listen(port, res));
    return (http.address() as AddressInfo).port;
  };

  const port = await boot(0);

  const srv: Srv = {
    get http() { return http; },
    get handle() { return handle; },
    port, state,
    async netDown() {
      await handle.close().catch(() => undefined); // 停 io(含心跳),等价网络对端消失
      for (const s of conns) s.destroy();
      await new Promise<void>((res) => http.close(() => res()));
    },
    async netUp() { await boot(port); },
  };
  cleanups.push(async () => {
    await handle.close().catch(() => undefined);
    await new Promise<void>((res) => http.close(() => res()));
  });
  return srv;
}

function rawClient(port: number, token = TOKEN): RawSocket {
  const s = connectTo(`http://127.0.0.1:${port}/classroom`, {
    auth: { token }, transports: ['websocket'], reconnection: false,
  }) as RawSocket;
  cleanups.push(() => { s.disconnect(); });
  return s;
}

const join = (s: RawSocket, sessionId = CD.CLASS_SESSION_ID) =>
  new Promise<ClassJoinSnapshot>((res) => s.emit('class:join', { sessionId }, (snap) => res(snap as ClassJoinSnapshot)));

const answer = (s: RawSocket, questionId: number, response: Parameters<C2SEvents['class:answer']>[0]['response']) =>
  new Promise<AnswerResult>((res) => s.emit('class:answer', { questionId, response }, res));

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const waitFor = async <T,>(fn: () => T | undefined | false, timeout = 5000, what = '条件'): Promise<T> => {
  const t0 = Date.now();
  for (;;) {
    const v = fn();
    if (v) return v as T;
    if (Date.now() - t0 > timeout) throw new Error(`等待超时:${what}`);
    await sleep(25);
  }
};

/** 客观题的正确作答(mock 题库 answer 字段) */
function correctResponse(qid: number): { choice: string } | { texts: string[] } {
  const q = D.questions.find((x) => x.id === qid)!;
  return q.answer as { choice: string } | { texts: string[] };
}

// ---------------- 用例 ----------------

describe('mock WS 全链路(socket.io-client 直驱)', () => {
  it('验收:join 返回完整 ClassSnapshot(契约逐字段)+ class:state + narration 推送', async () => {
    const srv = await startServer();
    const s = rawClient(srv.port);
    const states: unknown[] = [];
    const narrs: string[] = [];
    s.on('class:state', (p) => states.push(p));
    s.on('class:narration', (p) => narrs.push(p.text));

    const snap = await join(s);
    // 契约 ClassSnapshot 逐字段
    expect(Object.keys(snap.session).sort()).toEqual(
      ['currentSegmentSeq', 'elapsedSec', 'id', 'lessonTitle', 'mode', 'segments', 'status'],
    );
    expect(Object.keys(snap.me).sort()).toEqual(
      ['aiChatTail', 'answers', 'currentQuestion', 'segment', 'wrongBookAdded'],
    );
    expect(snap.session).toMatchObject({
      id: CD.CLASS_SESSION_ID, status: 'live', lessonTitle: CD.CLASS_LESSON_TITLE,
      mode: { guideOnly: true, stuckAlertMin: 3, lockdown: false, syncSegments: false },
    });
    expect(snap.session.segments).toEqual(CD.CLASS_SEGMENTS);
    // mock 增量(B6-1):题面(B5-1 形状)与课件分页
    expect(snap.questions).toHaveLength(5);
    expect(snap.questions![0]).toMatchObject({ seq: 1, questionId: 1, type: 'single', correctAnswer: null });
    expect(snap.courseware).toHaveLength(3);

    await waitFor(() => states.length > 0, 3000, 'class:state');
    expect(states[0]).toEqual({ segment: 1, state: 'normal', answeredCount: 0, correctCount: 0 });
    await waitFor(() => narrs.length > 0, 3000, 'narration');
    expect(narrs[0]).toBe(CD.SEGMENT_NARRATIONS[1]);
  });

  it('验收:四环节走完 —— 回顾→课件→随堂练(5 题判分+错题入账+大题预批)→小结→下课', async () => {
    const srv = await startServer();
    const s = rawClient(srv.port);
    const narrs: string[] = [];
    const controls: ClassControl[] = [];
    s.on('class:narration', (p) => narrs.push(p.text));
    s.on('class:control', (c) => controls.push(c));
    await join(s);

    // ①→② 课件,②→③ 随堂练(class:segment)
    s.emit('class:segment', { segmentSeq: 2 });
    await waitFor(() => srv.handle.getStudent(TOKEN)?.segment === 2, 3000, '环节 2');
    s.emit('class:segment', { segmentSeq: 3 });
    await waitFor(() => narrs.includes(CD.SEGMENT_NARRATIONS[3]), 3000, '环节 3 旁白');

    // ③ 随堂练:前 3 题答对、第 4 题(q5)答错、大题(q4)拍照
    for (const qid of [1, 2, 3]) {
      const r = await answer(s, qid, correctResponse(qid));
      expect(r).toMatchObject({ questionId: qid, judged: true, isCorrect: true, correctAnswer: null });
      expect(r.narration).toBe(CD.NARRATION_CORRECT);
    }
    const wrong = await answer(s, 5, { choice: 'D' });
    expect(wrong).toMatchObject({ judged: true, isCorrect: false });
    expect(wrong.correctAnswer).toBe('B'); // 判错回传正确答案(契约)
    const big = await answer(s, 4, { photoOssKey: 'mock/uploads/bigq.jpg' });
    expect(big).toMatchObject({ questionId: 4, judged: false, isCorrect: null, correctAnswer: null });
    expect(big.narration).toBe(CD.NARRATION_PRE_GRADE); // AI 预批旁白

    const hot = srv.handle.getStudent(TOKEN)!;
    expect(hot.answers).toHaveLength(5);
    expect(hot.wrongBookAdded).toEqual([5]); // 本堂新收错题

    // ④ 小结 → 教师下课(control 广播)
    s.emit('class:segment', { segmentSeq: 4 });
    await waitFor(() => narrs.includes(CD.SEGMENT_NARRATIONS[4]), 3000, '环节 4 旁白');
    srv.handle.control({ action: 'end' });
    await waitFor(() => controls.some((c) => c.action === 'end'), 3000, 'class:control end');
    expect(srv.state.session.status).toBe('ended');
  });

  it('AI 答疑:class:ai_ask → class:ai_chunk 流式分片(同 requestId 渐进,末片 done)', async () => {
    const srv = await startServer();
    const s = rawClient(srv.port);
    await join(s);
    const chunks: { requestId: string; delta: string; done: boolean }[] = [];
    s.on('class:ai_chunk', (p) => chunks.push(p));
    s.emit('class:ai_ask', { questionId: 1, message: '给我一点提示' });

    await waitFor(() => chunks.some((c) => c.done), 5000, '流式完成');
    expect(chunks.length).toBeGreaterThan(3); // 确为多分片
    expect(new Set(chunks.map((c) => c.requestId)).size).toBe(1);
    expect(chunks.filter((c) => c.done)).toHaveLength(1);
    expect(chunks.at(-1)!.done).toBe(true);
    const reply = CD.AI_REPLIES.find((r) => r.key === '提示')!.reply;
    expect(chunks.map((c) => c.delta).join('')).toBe(reply); // 拼接无损
    // 对话尾巴进快照(断线恢复的载体)
    await waitFor(() => (srv.handle.getStudent(TOKEN)?.aiChatTail.length ?? 0) >= 2, 3000, 'aiChatTail');
    expect(srv.handle.getStudent(TOKEN)!.aiChatTail.at(-1)).toEqual({ role: 'assistant', text: reply });
  });

  it('心跳:客户端按注入周期上报(默认 10s);idleSec 超阈值 → stuck,回落复位', async () => {
    const srv = await startServer({ stuckThresholdSec: 180 });
    const s = rawClient(srv.port);
    await join(s);
    s.emit('class:heartbeat', { currentQuestion: 2, idleSec: 999 });
    await waitFor(() => srv.handle.getStudent(TOKEN)?.state === 'stuck', 3000, 'stuck');
    expect(srv.handle.getStudent(TOKEN)!.currentQuestion).toBe(2);
    s.emit('class:heartbeat', { currentQuestion: 2, idleSec: 0 });
    await waitFor(() => srv.handle.getStudent(TOKEN)?.state === 'normal', 3000, 'stuck 复位');
  });

  it('鉴权与越权:无效 token → connect_error;错误 sessionId → exception 不回 ack;学生发 class:control → 拒绝', async () => {
    const srv = await startServer();

    const bad = rawClient(srv.port, 'not-a-token');
    const err = await new Promise<Error>((res) => bad.on('connect_error', res));
    expect(err.message).toContain('登录');

    const s = rawClient(srv.port);
    const exceptions: { status: 'error'; message: string }[] = [];
    s.on('exception', (p) => exceptions.push(p));
    let acked = false;
    s.emit('class:join', { sessionId: 999 }, () => { acked = true; });
    await waitFor(() => exceptions.length > 0, 3000, 'join 拒绝 exception');
    // 负载对齐真实网关:status 恒为 'error'(字符串),细节只在 message
    expect(exceptions[0]).toEqual({ status: 'error', message: '课堂不存在或不属于你' });
    expect(acked).toBe(false); // A6:join 被拒 ack 不回包

    await join(s);
    s.emit('class:control', { action: 'end' });
    await waitFor(() => exceptions.some((e) => e.message.includes('仅本课教师')), 3000, '学生 control 拒绝');
    expect(srv.state.session.status).toBe('live'); // 未被学生改动
  });

  it('control 广播:pause → 全员遮罩态;resume 恢复(reducer 联动)', async () => {
    const srv = await startServer();
    const s = rawClient(srv.port);
    let view = CM.initialClassState;
    s.on('class:control', (c) => { view = CM.reduceClass(view, { type: 'control', control: c }); });
    const snap = await join(s);
    view = CM.reduceClass(view, { type: 'snapshot', snap, resumed: false });

    srv.handle.control({ action: 'pause' });
    await waitFor(() => view.paused, 3000, 'paused');
    expect(srv.state.session.status).toBe('paused');
    srv.handle.control({ action: 'resume' });
    await waitFor(() => !view.paused, 3000, 'resumed');
  });
});

describe('断线恢复(ClassroomWsClient + reducer 全链路)', () => {
  it('验收:模拟断网 10s → 指数退避自动重连 → 回到原题且已答不丢(无感恢复)', { timeout: 40_000 }, async () => {
    const srv = await startServer();

    let view = CM.initialClassState;
    const snapshots: { resumed: boolean }[] = [];
    const client = new ClassroomWsClient(
      {
        sessionId: CD.CLASS_SESSION_ID, token: TOKEN, url: `http://127.0.0.1:${srv.port}`,
        heartbeatMs: 150, // 心跳周期可注入(生产默认 10s)
        joinTimeoutMs: 1500,
        backoff: { baseMs: 1000, factor: 2, maxMs: 4000 }, // 退避可注入
      },
      {
        onSnapshot: (snap, info) => {
          snapshots.push(info);
          view = CM.reduceClass(view, { type: 'snapshot', snap, resumed: info.resumed });
        },
        onConn: (s) => { view = CM.reduceClass(view, { type: 'conn', state: s }); },
        onState: (self) => { view = CM.reduceClass(view, { type: 'state', self }); },
      },
    );
    cleanups.push(() => client.close());
    client.connect();
    await waitFor(() => view.conn === 'live' && view.session != null, 5000, '首次 join');

    // 作答两题(q1 对、q2 错)并停在第 3 题(原题)
    for (const [qid, resp] of [[1, correctResponse(1)], [2, { choice: 'A' }]] as const) {
      const result = await client.answer(qid as number, resp);
      view = CM.reduceClass(view, { type: 'answered', questionId: qid as number, response: resp, result });
    }
    view = CM.reduceClass(view, { type: 'goto', index: 2 });
    client.markActivity(3); // 心跳上报 currentQuestion=3
    await waitFor(() => srv.handle.getStudent(TOKEN)?.currentQuestion === 3, 5000, '心跳上报当前题');
    expect(srv.handle.getStudent(TOKEN)!.heartbeatCount).toBeGreaterThanOrEqual(1);

    // ---- 模拟断网 10s:停监听 + 毁现存连接(服务端状态驻留 = A6 Redis 热状态) ----
    await srv.netDown();
    const downAt = Date.now();
    await waitFor(() => view.conn === 'reconnecting', 5000, '进入重连态');
    await sleep(10_000 - (Date.now() - downAt)); // 断网整 10s
    expect(view.conn).toBe('reconnecting');
    expect(view.reconnectAttempt).toBeGreaterThanOrEqual(2); // 退避重试了多次
    await srv.netUp();

    // ---- 自动重连 + join 快照无感恢复 ----
    await waitFor(() => view.conn === 'live' && view.resumed, 15_000, '重连恢复');
    expect(snapshots.at(-1)).toEqual({ resumed: true });

    // 回到原题:快照 me.currentQuestion=3 → 题格当前 = 第 3 题
    expect(view.quiz.current).toBe(2);
    // 已答不丢:判定与计数齐全,本地作答负载未被覆盖(无感)
    expect(CM.practiceStats(view)).toEqual({ answered: 2, correct: 1, total: 5 });
    expect(view.quiz.items[0].response).toEqual(correctResponse(1));
    expect(view.quiz.items[1].response).toEqual({ choice: 'A' });
    expect(view.quiz.items[1].feedback).toMatchObject({ isCorrect: false, correctAnswer: 'B' });
    // 服务端快照本身也齐全(刷新重进同样不丢)
    const hot = srv.handle.getStudent(TOKEN)!;
    expect(hot.answers.map((a) => a.isCorrect)).toEqual([true, false]);

    // 重连后通道仍可用:继续作答第 3 题
    const r3 = await client.answer(3, correctResponse(3));
    expect(r3.isCorrect).toBe(true);
  });

  it('主动退出(close)后不再重连(状态机终态)', async () => {
    const srv = await startServer();
    let conn = '';
    const client = new ClassroomWsClient(
      { sessionId: CD.CLASS_SESSION_ID, token: TOKEN, url: `http://127.0.0.1:${srv.port}`, heartbeatMs: 200 },
      { onConn: (s) => { conn = s.phase; } },
    );
    client.connect();
    await waitFor(() => conn === 'live', 5000, 'join');
    client.close();
    expect(conn).toBe('closed');
    await sleep(400);
    expect(client.connState.phase).toBe('closed');
    expect(client.socket.connected).toBe(false);
  });
});

describe('join 业务拒绝与重连上限(ClassroomWsClient)', () => {
  it('join 被拒(exception)→ 停止重连进 rejected 终态,onException(rejected=true),不再转圈', async () => {
    const srv = await startServer();
    const exceptions: [WsExceptionPayload, { rejected: boolean }][] = [];
    const client = new ClassroomWsClient(
      {
        sessionId: 999, token: TOKEN, url: `http://127.0.0.1:${srv.port}`, // 不存在的课堂 → join 拒绝
        joinTimeoutMs: 300, // 刻意短于观察窗口:证明拒绝路径独立于超时路径,不会再触发退避
        backoff: { baseMs: 50, factor: 2, maxMs: 200 },
      },
      { onException: (p, info) => exceptions.push([p, info]) },
    );
    cleanups.push(() => client.close());
    client.connect();

    await waitFor(() => exceptions.length > 0, 5000, 'join 拒绝 exception');
    expect(exceptions[0][0]).toEqual({ status: 'error', message: '课堂不存在或不属于你' });
    expect(exceptions[0][1]).toEqual({ rejected: true });
    expect(client.connState.phase).toBe('rejected');
    await sleep(800); // 覆盖 joinTimeout + 数轮退避窗口:确认无幽灵重连
    expect(client.connState.phase).toBe('rejected');
    expect(client.socket.connected).toBe(false);
    expect(exceptions).toHaveLength(1);
  });

  it('课堂已结束 → 拒绝文案透传到视图(reducer:conn=rejected + error)', async () => {
    const srv = await startServer();
    srv.state.session.status = 'ended';
    let view = CM.initialClassState;
    const client = new ClassroomWsClient(
      { sessionId: CD.CLASS_SESSION_ID, token: TOKEN, url: `http://127.0.0.1:${srv.port}` },
      {
        onConn: (s) => { view = CM.reduceClass(view, { type: 'conn', state: s }); },
        onException: (p, { rejected }) => {
          if (rejected) view = CM.reduceClass(view, { type: 'rejected', message: p.message });
        },
      },
    );
    cleanups.push(() => client.close());
    client.connect();
    await waitFor(() => view.conn === 'rejected', 5000, 'rejected 视图');
    expect(view.error).toBe('课堂已结束');
  });

  it('重连超限 → failed(不再自动重试);网络恢复后 retry() 手动重连成功', async () => {
    const srv = await startServer();
    await srv.netDown(); // 从一开始就连不上 → 连续失败
    const client = new ClassroomWsClient(
      {
        sessionId: CD.CLASS_SESSION_ID, token: TOKEN, url: `http://127.0.0.1:${srv.port}`,
        heartbeatMs: 200,
        backoff: { baseMs: 40, factor: 2, maxMs: 80, maxAttempts: 2 }, // 上限可注入(生产默认 8)
      },
      {},
    );
    cleanups.push(() => client.close());
    client.connect();

    await waitFor(() => client.connState.phase === 'failed', 8000, '重试超限 failed');
    expect(client.connState.attempt).toBe(3); // 首次失败 + 2 次重试
    await sleep(300);
    expect(client.connState.phase).toBe('failed'); // 超限后不再自动重试

    await srv.netUp();
    client.retry(); // 手动重试:退避计数清零
    await waitFor(() => client.connState.phase === 'live', 5000, '手动重试恢复');
    expect(client.connState.attempt).toBe(0);
  });
});
