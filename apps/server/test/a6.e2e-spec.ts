/**
 * 验收覆盖(任务卡 A6 · 课堂实时 WebSocket,协议层测试,socket.io-client 模拟):
 * - class:join 返回完整 ClassSnapshot(形状逐字段,契约 ws-protocol.ts)+ scheduled→live
 * - 握手 JWT 鉴权 + 本课成员校验(未选课/跨租户拒绝,宪法 §7)
 * - class:answer 复用 A5 判分(对/错/解析回传,PG 落库)+ class:state / class:narration
 * - class:ai_ask → class:ai_chunk 流式;class:hand_up → monitor:alert
 * - 心跳驱动 stuck 检测:超 mode.stuckAlertMin 进 ZSET(7.4)+ 教师房间 monitor:alert
 * - 断线重连 class:join → snapshot 含已答题与判定/当前题/AI 对话尾部(7.5 验收原文)
 * - 事件经 Stream 消费者批量落 session_events;participants 周期回写(注入短周期)
 * - 20 客户端并发心跳下 monitor:roster 5s 节流(窗口内 ≤1 次,内容为全班最新)
 * - Redis flush(仅本套件键,SCAN+DEL)后从 PG 快照重建,snapshot 不丢已答
 * - 状态机 scheduled→live→paused⇄live→ended;ended 结算:参与者归档 +
 *   课后作业 assignment 自动发布(A4 AssignmentService 接口,DB 对账)
 */
import { INestApplication } from '@nestjs/common';
import Redis from 'ioredis';
import type { AddressInfo } from 'net';
import { io as ioc, Socket } from 'socket.io-client';
import request from 'supertest';
import type {
  AnswerResult,
  ClassSnapshot,
  ParticipantMonitor,
  ParticipantSelfState,
} from '@qiming/contracts';
import { A6_PASSWORD, A6_STUCK_ALERT_MIN, A6Fixture, createA6Org, dropA6Org } from './fixtures/a6.fixtures';
import { createApp, loginStudentById, raw } from './fixtures/setup';

const exactKeys = (obj: object, keys: string[]) =>
  expect(Object.keys(obj).sort()).toEqual([...keys].sort());

const SNAPSHOT_KEYS = ['session', 'me'];
const SESSION_KEYS = ['id', 'status', 'lessonTitle', 'segments', 'currentSegmentSeq', 'elapsedSec', 'mode'];
const MODE_KEYS = ['guideOnly', 'stuckAlertMin', 'lockdown', 'syncSegments'];
const SEGMENT_KEYS = ['seq', 'type', 'durationMin'];
const ME_KEYS = ['segment', 'currentQuestion', 'answers', 'wrongBookAdded', 'aiChatTail'];
const ME_ANSWER_KEYS = ['questionId', 'isCorrect', 'score'];
const SELF_STATE_KEYS = ['segment', 'state', 'answeredCount', 'correctCount'];
const MONITOR_KEYS = ['studentId', 'studentName', 'segment', 'currentQuestion', 'answeredCount', 'correctCount', 'state', 'stuckSec', 'aiAskCount', 'online'];
const ALERT_KEYS = ['studentId', 'studentName', 'type', 'detail'];
const ANSWER_RESULT_KEYS = ['questionId', 'judged', 'isCorrect', 'correctAnswer', 'narration'];

/** 轮询等待(Stream 消费者 / 回写等异步任务) */
async function waitFor<T>(fn: () => Promise<T | null | false | undefined>, label: string, ms = 15000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v as T;
    if (Date.now() - start > ms) throw new Error(`waitFor 超时:${label}`);
    await new Promise((r) => setTimeout(r, 200));
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('课堂实时 WebSocket(A6,/classroom)', () => {
  let app: INestApplication;
  let http: any;
  let port: number;
  let fx: A6Fixture;
  let redis: Redis;

  let teacherToken: string;
  let studentTokens: string[]; // 与 fx.studentIds 对齐(20 个)
  let outsiderToken: string;
  let teacherBToken: string;

  let teacher: Socket; // 教师监控连接
  let s1: Socket;
  let s2: Socket;
  const allSockets: Socket[] = [];

  const qid = (i: number) => Number(fx.questionIds[i]);
  const sid = () => fx.sessionId;
  const uid = (i: number) => Number(fx.studentIds[i]);
  const keyPrefix = () => `a6:cls:${sid()}`;

  // ---------------- 工具 ----------------

  const connectClient = (token: string): Promise<Socket> =>
    new Promise((resolve, reject) => {
      const s = ioc(`http://127.0.0.1:${port}/classroom`, {
        auth: { token },
        transports: ['websocket'],
        forceNew: true,
        reconnection: false,
        timeout: 5000,
      });
      s.on('connect', () => {
        allSockets.push(s);
        resolve(s);
      });
      s.on('connect_error', (e) => reject(e));
    });

  const emitAck = <T>(s: Socket, event: string, payload: unknown, timeout = 8000): Promise<T> =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`ack 超时:${event}`)), timeout);
      s.emit(event, payload, (resp: T) => {
        clearTimeout(timer);
        resolve(resp);
      });
    });

  const waitEvent = <T>(
    s: Socket,
    event: string,
    opts?: { timeout?: number; filter?: (p: T) => boolean },
  ): Promise<T> =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        try {
          s.off(event, handler);
        } catch {
          /* 套件已收尾 */
        }
        reject(new Error(`等待事件超时:${event}`));
      }, opts?.timeout ?? 8000);
      const handler = (p: T) => {
        if (opts?.filter && !opts.filter(p)) return;
        clearTimeout(timer);
        s.off(event, handler);
        resolve(p);
      };
      s.on(event, handler);
    });

  /** join 应被拒绝:收到 exception 且 ack 不应返回 snapshot */
  const joinExpectError = async (s: Socket, sessionId: number): Promise<string> => {
    const exception = waitEvent<{ message?: string }>(s, 'exception');
    let acked: unknown;
    s.emit('class:join', { sessionId }, (snap: unknown) => {
      acked = snap;
    });
    const e = await exception;
    expect(acked).toBeUndefined();
    return e?.message ?? '';
  };

  const join = (s: Socket, sessionId = sid()) => emitAck<ClassSnapshot>(s, 'class:join', { sessionId });

  const scanKeys = async (pattern: string): Promise<string[]> => {
    let cursor = '0';
    const out: string[] = [];
    do {
      const [c, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 500);
      cursor = c;
      out.push(...keys);
    } while (cursor !== '0');
    return out;
  };

  /** 仅清本套件键(禁止 FLUSHALL/FLUSHDB,共享 Redis 纪律) */
  const flushOwnKeys = async () => {
    const keys = await scanKeys('a6:cls:*');
    if (keys.length) await redis.del(...keys);
  };

  const login = async (phone: string, password: string) => {
    const res = await request(http).post('/api/v1/auth/login').send({ phone, password }).expect(200);
    return res.body.data.accessToken as string;
  };
  const studentLogin = async (_orgId: bigint, id: bigint, _fp?: string) =>
    loginStudentById(http, id);

  // ---------------- 起停 ----------------

  beforeAll(async () => {
    // 注入短周期(默认:消费者 1s / 回写 30s;roster 节流保持真实 5s 走验收)
    process.env.CLS_CONSUMER_INTERVAL_MS = '300';
    process.env.CLS_WRITEBACK_INTERVAL_MS = '400';

    app = await createApp();
    await app.listen(0);
    http = app.getHttpServer();
    port = (http.address() as AddressInfo).port;

    redis = new Redis(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379');
    fx = await createA6Org();

    teacherToken = await login(fx.teacherPhone, A6_PASSWORD);
    teacherBToken = await login(fx.teacherBPhone, A6_PASSWORD);
    studentTokens = [];
    for (let i = 0; i < fx.studentIds.length; i++) {
      studentTokens.push(await studentLogin(fx.orgId, fx.studentIds[i], `a6-fp-${i + 1}`));
    }
    outsiderToken = await studentLogin(fx.orgId, fx.outsiderId, 'a6-fp-out');
  }, 60000);

  afterAll(async () => {
    for (const s of allSockets) s.connected && s.disconnect();
    await app.close();
    await flushOwnKeys(); // Redis 键自清(仅 a6: 前缀)
    await dropA6Org(fx.orgId, fx.orgBId);
    await redis.quit();
    await raw.$disconnect();
  }, 60000);

  // ---------------- 用例(按课堂剧本顺序)----------------

  it('握手:无效 JWT → connect_error 拒绝连接', async () => {
    await expect(connectClient('not-a-jwt')).rejects.toBeTruthy();
  });

  it('验收:class:join 返回完整 ClassSnapshot(契约逐字段)+ scheduled→live + class:state', async () => {
    s1 = await connectClient(studentTokens[0]);
    const stateP = waitEvent<ParticipantSelfState>(s1, 'class:state');
    const snap = await join(s1);

    // —— 契约形状逐字段(ws-protocol.ts ClassSnapshot)——
    exactKeys(snap, SNAPSHOT_KEYS);
    exactKeys(snap.session, SESSION_KEYS);
    exactKeys(snap.session.mode, MODE_KEYS);
    exactKeys(snap.me, ME_KEYS);
    expect(snap.session.id).toBe(sid());
    expect(snap.session.status).toBe('live'); // 首次进入:scheduled→live(7.6)
    expect(snap.session.lessonTitle).toBe('A6 · 一次函数图象与平移');
    expect(snap.session.segments).toHaveLength(5);
    snap.session.segments.forEach((seg, i) => {
      exactKeys(seg, SEGMENT_KEYS);
      expect(seg.seq).toBe(i + 1);
    });
    expect(snap.session.segments.map((x) => x.type)).toEqual(['warmup', 'lecture', 'practice', 'summary', 'homework']);
    expect(snap.session.currentSegmentSeq).toBe(1);
    expect(snap.session.elapsedSec).toBeGreaterThanOrEqual(0);
    // mode:DB 存 snake_case,契约下发 camelCase
    expect(snap.session.mode).toEqual({ guideOnly: true, stuckAlertMin: A6_STUCK_ALERT_MIN, lockdown: false, syncSegments: false });
    expect(snap.me).toEqual({ segment: 1, currentQuestion: null, answers: [], wrongBookAdded: [], aiChatTail: [] });

    const state = await stateP;
    exactKeys(state, SELF_STATE_KEYS);
    expect(state).toEqual({ segment: 1, state: 'normal', answeredCount: 0, correctCount: 0 });

    // PG:状态机持久化;Redis:7.4 结构(meta HASH / stu HASH)
    const row = await raw.classSession.findUnique({ where: { id: BigInt(sid()) } });
    expect(row?.status).toBe('live');
    expect(row?.actualStart).toBeTruthy();
    expect(await redis.exists(`${keyPrefix()}:meta`)).toBe(1);
    const stu = await redis.hgetall(`${keyPrefix()}:stu:${uid(0)}`);
    expect(stu.segment).toBe('1');
    expect(stu.state).toBe('normal');
    // 参与者落库(joinAt)
    const part = await raw.sessionParticipant.findFirst({
      where: { sessionId: BigInt(sid()), studentId: fx.studentIds[0] },
    });
    expect(part?.joinAt).toBeTruthy();
  });

  it('join 门禁:未选课学生 / 他租户教师 → 拒绝(本课成员校验,宪法 §7)', async () => {
    const outsider = await connectClient(outsiderToken);
    await joinExpectError(outsider, sid());
    outsider.disconnect();

    const tb = await connectClient(teacherBToken);
    await joinExpectError(tb, sid()); // 跨租户:租户注入下查无此课
    tb.disconnect();
  });

  it('教师 join → 进入监控房间,收到 monitor:roster(ParticipantMonitor 形状)', async () => {
    teacher = await connectClient(teacherToken);
    const rosterP = waitEvent<{ participants: ParticipantMonitor[] }>(teacher, 'monitor:roster');
    const snap = await join(teacher);
    expect(snap.session.status).toBe('live');

    const roster = await rosterP;
    exactKeys(roster, ['participants']);
    const me = roster.participants.find((p) => p.studentId === uid(0));
    expect(me).toBeDefined();
    exactKeys(me!, MONITOR_KEYS);
    expect(me!.studentName).toBe('A6学生01');
    expect(me!.online).toBe(true);
    expect(me!.state).toBe('normal');
  });

  it('class:segment:进入环节 → Redis stu HASH 更新,重 join 后 me.segment 恢复', async () => {
    s1.emit('class:segment', { segmentSeq: 3 });
    await waitFor(async () => (await redis.hget(`${keyPrefix()}:stu:${uid(0)}`, 'segment')) === '3', 'segment 写入');
    const snap = await join(s1); // join 幂等,可作为快照拉取
    expect(snap.me.segment).toBe(3);
  });

  it('验收:class:answer 复用 A5 判分 —— 对/错判定、解析回传、PG 落库、narration', async () => {
    // q1 答对
    const narrationP = waitEvent<{ text: string }>(s1, 'class:narration');
    const stateP = waitEvent<ParticipantSelfState>(s1, 'class:state');
    const r1 = await emitAck<AnswerResult>(s1, 'class:answer', { questionId: qid(0), response: { choice: 'A' } });
    exactKeys(r1, ANSWER_RESULT_KEYS);
    expect(r1).toMatchObject({ questionId: qid(0), judged: true, isCorrect: true, correctAnswer: null });
    expect(typeof r1.narration).toBe('string');
    expect((await narrationP).text).toBe(r1.narration);
    expect(await stateP).toMatchObject({ answeredCount: 1, correctCount: 1 });

    // q2 答错:回传正确答案(A5 口径)
    const r2 = await emitAck<AnswerResult>(s1, 'class:answer', { questionId: qid(1), response: { texts: ['y=x'] } });
    expect(r2).toMatchObject({ questionId: qid(1), judged: true, isCorrect: false, correctAnswer: 'y=2x+1' });

    // PG 落库:走 A5 attempt/answers(in_class assignment)
    const attempt = await raw.attempt.findFirst({
      where: { assignmentId: fx.inClassAssignmentId, studentId: fx.studentIds[0] },
      include: { answers: true },
    });
    expect(attempt?.status).toBe('in_progress');
    expect(attempt?.answers).toHaveLength(2);
    const a1 = attempt!.answers.find((a) => a.questionId === fx.questionIds[0])!;
    expect(a1.isCorrect).toBe(true);
    expect(Number(a1.score)).toBe(5);
  });

  it('class:ai_ask → class:ai_chunk 流式(requestId 一致,done 收尾)', async () => {
    const chunks: { requestId: string; delta: string; done: boolean }[] = [];
    const doneP = new Promise<void>((resolve) => {
      const handler = (c: { requestId: string; delta: string; done: boolean }) => {
        chunks.push(c);
        if (c.done) {
          s1.off('class:ai_chunk', handler);
          resolve();
        }
      };
      s1.on('class:ai_chunk', handler);
    });
    s1.emit('class:ai_ask', { questionId: qid(1), message: '这道题我不知道从哪一步开始' });
    await doneP;

    expect(chunks.length).toBeGreaterThanOrEqual(2);
    const requestIds = new Set(chunks.map((c) => c.requestId));
    expect(requestIds.size).toBe(1);
    expect(chunks.slice(0, -1).every((c) => !c.done)).toBe(true);
    const full = chunks.map((c) => c.delta).join('');
    expect(full.length).toBeGreaterThan(0);
    // ai_ask_count 进入热状态(roster 用)
    await waitFor(async () => (await redis.hget(`${keyPrefix()}:stu:${uid(0)}`, 'ai_ask_count')) === '1', 'ai_ask_count');
  });

  it('class:hand_up → 教师房间 monitor:alert(hand_up)', async () => {
    s2 = await connectClient(studentTokens[1]);
    await join(s2);
    const alertP = waitEvent<{ studentId: number; studentName: string; type: string; detail: string }>(
      teacher, 'monitor:alert', { filter: (a) => a.type === 'hand_up' },
    );
    s2.emit('class:hand_up', {});
    const alert = await alertP;
    exactKeys(alert, ALERT_KEYS);
    expect(alert.studentId).toBe(uid(1));
    expect(alert.studentName).toBe('A6学生02');
    expect(await redis.hget(`${keyPrefix()}:stu:${uid(1)}`, 'state')).toBe('hand_up');
  });

  it('验收:心跳驱动 stuck 检测 —— 超 stuckAlertMin 进 ZSET + monitor:alert,恢复后移出', async () => {
    const alertP = waitEvent<{ studentId: number; type: string }>(
      teacher, 'monitor:alert', { filter: (a) => a.type === 'stuck' },
    );
    // idleSec=150 > 2min 阈值
    s1.emit('class:heartbeat', { currentQuestion: qid(1), idleSec: 150 });
    const alert = await alertP;
    expect(alert.studentId).toBe(uid(0));

    const score = await redis.zscore(`${keyPrefix()}:stuck`, String(uid(0)));
    expect(score).not.toBeNull(); // 7.4:ZSET member=uid score=开始停留时间
    expect(await redis.hget(`${keyPrefix()}:stu:${uid(0)}`, 'state')).toBe('stuck');

    // 恢复:idleSec 归零 → 移出 ZSET,state 复位
    s1.emit('class:heartbeat', { currentQuestion: qid(1), idleSec: 0 });
    await waitFor(async () => (await redis.zscore(`${keyPrefix()}:stuck`, String(uid(0)))) === null, 'ZREM');
    expect(await redis.hget(`${keyPrefix()}:stu:${uid(0)}`, 'state')).toBe('normal');
  });

  it('验收(7.5 原文):断线重连 join → snapshot 含已答题与判定/当前题/AI 对话尾部', async () => {
    s1.disconnect();
    await sleep(100);
    s1 = await connectClient(studentTokens[0]);
    const snap = await join(s1);

    expect(snap.session.status).toBe('live');
    expect(snap.me.segment).toBe(3);
    expect(snap.me.currentQuestion).toBe(qid(1)); // 最近心跳上报的当前题
    // 已答题与判定零丢失
    const byQ = new Map(snap.me.answers.map((a) => [a.questionId, a]));
    expect(snap.me.answers).toHaveLength(2);
    snap.me.answers.forEach((a) => exactKeys(a, ME_ANSWER_KEYS));
    expect(byQ.get(qid(0))).toEqual({ questionId: qid(0), isCorrect: true, score: 5 });
    expect(byQ.get(qid(1))).toEqual({ questionId: qid(1), isCorrect: false, score: 0 });
    // 本堂答错 → 将入错题本
    expect(snap.me.wrongBookAdded).toEqual([qid(1)]);
    // AI 对话尾部(最近 10 条)
    expect(snap.me.aiChatTail.length).toBeGreaterThanOrEqual(2);
    const [u, a] = snap.me.aiChatTail.slice(-2);
    expect(u.role).toBe('user');
    expect(u.text).toBe('这道题我不知道从哪一步开始');
    expect(a.role).toBe('assistant');
    expect(a.text.length).toBeGreaterThan(0);
  });

  it('事件经 Stream 消费者批量落 session_events(join/segment/answer/ai_ask/hand_up/stuck)', async () => {
    const expectTypes = ['join', 'segment_enter', 'answer_submit', 'ai_ask', 'hand_up', 'stuck_alert'];
    await waitFor(async () => {
      const rows = await raw.sessionEvent.findMany({ where: { sessionId: BigInt(sid()) }, select: { type: true } });
      const types = new Set(rows.map((r) => r.type));
      return expectTypes.every((t) => types.has(t));
    }, 'session_events 落库');
    // answer_submit 事件带判定 payload
    const ans = await raw.sessionEvent.findFirst({
      where: { sessionId: BigInt(sid()), type: 'answer_submit', studentId: fx.studentIds[0] },
    });
    expect(ans).toBeTruthy();
  });

  it('验收:20 客户端并发心跳 → monitor:roster 5s 节流(窗口内 ≤1 次)且内容为全班最新', async () => {
    // 其余 18 名学生进场(s1、s2 已在)
    const extras: Socket[] = [];
    for (let i = 2; i < 20; i++) {
      const s = await connectClient(studentTokens[i]);
      await join(s);
      extras.push(s);
    }
    const clients = [s1, s2, ...extras]; // 20 个

    // 计时收集 roster 广播
    const emissions: { at: number; participants: ParticipantMonitor[] }[] = [];
    const collect = (p: { participants: ParticipantMonitor[] }) =>
      emissions.push({ at: Date.now(), participants: p.participants });
    teacher.on('monitor:roster', collect);

    // 20 客户端每 500ms 并发心跳,持续 12s
    const hb = setInterval(() => {
      for (const c of clients) c.emit('class:heartbeat', { currentQuestion: qid(1), idleSec: 3 });
    }, 500);
    await sleep(12000);
    clearInterval(hb);
    await sleep(600); // 等尾批(节流尾沿)
    teacher.off('monitor:roster', collect);

    // 节流:任意相邻两次广播间隔 ≥ 5s(允许 300ms 抖动);12s 内 2~3 次
    expect(emissions.length).toBeGreaterThanOrEqual(2);
    expect(emissions.length).toBeLessThanOrEqual(4);
    for (let i = 1; i < emissions.length; i++) {
      expect(emissions[i].at - emissions[i - 1].at).toBeGreaterThanOrEqual(4700);
    }
    // 内容为全班最新:20 人、全部 online、心跳携带的 currentQuestion 已生效
    const last = emissions[emissions.length - 1].participants;
    expect(last).toHaveLength(20);
    expect(last.every((p) => p.online)).toBe(true);
    expect(last.every((p) => p.currentQuestion === qid(1))).toBe(true);
    last.forEach((p) => exactKeys(p, MONITOR_KEYS));

    for (const s of extras) s.disconnect();
    // 等 18 个 leave 事件经 Stream 消费者落库(避免与下一用例的 flush 竞争)
    await waitFor(async () => {
      const leaves = await raw.sessionEvent.count({ where: { sessionId: BigInt(sid()), type: 'leave' } });
      return leaves >= 19; // 18 extras + 此前 s1 重连断开的 1 次
    }, 'leave 事件落库');
  }, 30000);

  it('验收:participants 周期回写 → Redis flush(仅本套件键)→ 从 PG 重建,snapshot 不丢已答', async () => {
    // 1) 等回写落库(注入 400ms 周期)
    await waitFor(async () => {
      const p = await raw.sessionParticipant.findFirst({
        where: { sessionId: BigInt(sid()), studentId: fx.studentIds[0] },
      });
      const prog = (p?.progress ?? {}) as Record<string, unknown>;
      return prog.current_question === qid(1) && prog.answered === 2;
    }, 'participants 回写');

    // 2) 模拟 Redis 故障:仅清本套件键(SCAN+DEL,禁止 FLUSHALL/FLUSHDB)
    await flushOwnKeys();
    expect(await scanKeys(`${keyPrefix()}:*`)).toHaveLength(0);

    // 3) 重连 join → 服务端从 PG 最近快照重建热状态
    const snap = await join(s1);
    expect(snap.session.status).toBe('live');
    expect(snap.me.segment).toBe(3); // 来自 participants 回写快照
    expect(snap.me.currentQuestion).toBe(qid(1));
    // 已答数据零丢失(作答本体在 PG,设计文档 7.4)
    const byQ = new Map(snap.me.answers.map((a) => [a.questionId, a]));
    expect(byQ.get(qid(0))).toEqual({ questionId: qid(0), isCorrect: true, score: 5 });
    expect(byQ.get(qid(1))).toEqual({ questionId: qid(1), isCorrect: false, score: 0 });
    expect(snap.me.wrongBookAdded).toEqual([qid(1)]);
    // AI 对话尾部从 session_events 重建
    expect(snap.me.aiChatTail.length).toBeGreaterThanOrEqual(2);
    expect(snap.me.aiChatTail[snap.me.aiChatTail.length - 1].role).toBe('assistant');
    // 热状态已重建
    expect(await redis.exists(`${keyPrefix()}:meta`)).toBe(1);
  });

  it('状态机:pause⇄resume 广播 class:control;非法切换/学生越权被拒;force_segment', async () => {
    // pause
    const pauseP = waitEvent<{ action: string }>(s1, 'class:control', { filter: (c) => c.action === 'pause' });
    teacher.emit('class:control', { action: 'pause' });
    await pauseP;
    expect((await raw.classSession.findUnique({ where: { id: BigInt(sid()) } }))?.status).toBe('paused');

    // resume
    const resumeP = waitEvent<{ action: string }>(s1, 'class:control', { filter: (c) => c.action === 'resume' });
    teacher.emit('class:control', { action: 'resume' });
    await resumeP;
    expect((await raw.classSession.findUnique({ where: { id: BigInt(sid()) } }))?.status).toBe('live');

    // 非法切换:live 状态再 resume → 拒绝
    const exP = waitEvent<{ message?: string }>(teacher, 'exception');
    teacher.emit('class:control', { action: 'resume' });
    await exP;

    // 学生无权下发控制
    const exS = waitEvent<{ message?: string }>(s1, 'exception');
    s1.emit('class:control', { action: 'pause' });
    await exS;
    expect((await raw.classSession.findUnique({ where: { id: BigInt(sid()) } }))?.status).toBe('live');

    // force_segment 广播 + 全班环节推进
    const forceP = waitEvent<{ action: string; segmentSeq?: number }>(s1, 'class:control', {
      filter: (c) => c.action === 'force_segment',
    });
    teacher.emit('class:control', { action: 'force_segment', segmentSeq: 4 });
    expect((await forceP).segmentSeq).toBe(4);
    const snap = await join(s1);
    expect(snap.session.currentSegmentSeq).toBe(4);
  });

  it('验收:ended 结算 —— 参与者归档 + 课后作业自动发布(A4 接口)+ 幂等 + 再 join 拒绝', async () => {
    const endP = waitEvent<{ action: string }>(s1, 'class:control', { filter: (c) => c.action === 'end' });
    teacher.emit('class:control', { action: 'end' });
    await endP;

    // 会话终态 + 讲次 finished
    const row = await waitFor(async () => {
      const r = await raw.classSession.findUnique({ where: { id: BigInt(sid()) } });
      return r?.status === 'ended' ? r : null;
    }, 'session ended');
    expect(row.actualEnd).toBeTruthy();

    // 结算是 end 广播后的异步流程,其最后一步是清本会话 Redis 键 → 以此为完成信号
    await waitFor(async () => (await scanKeys(`${keyPrefix()}:*`)).length === 0, '结算完成(清键)');
    expect((await raw.lesson.findUnique({ where: { id: fx.lessonId } }))?.status).toBe('finished');

    // 参与者归档:leaveAt + progress 快照
    const parts = await raw.sessionParticipant.findMany({ where: { sessionId: BigInt(sid()) } });
    expect(parts).toHaveLength(20);
    expect(parts.every((p) => p.leaveAt != null)).toBe(true);
    const p1 = parts.find((p) => p.studentId === fx.studentIds[0])!;
    expect((p1.progress as Record<string, unknown>).answered).toBe(2);

    // 课后作业自动发布:A4 AssignmentService 口径(homework 环节挂的卷,整班 target)
    const hw = await raw.assignment.findMany({
      where: { lessonId: fx.lessonId, kind: 'homework' },
    });
    expect(hw).toHaveLength(1);
    expect(hw[0].paperId).toBe(fx.homeworkPaperId);
    expect(hw[0].scoreCounted).toBe(true);
    expect(hw[0].target).toEqual({ courseId: Number(fx.courseId) });

    // ended 终态:再 join 拒绝;重复 end 拒绝且不重复发布作业
    await joinExpectError(s1, sid());
    const exP = waitEvent<{ message?: string }>(teacher, 'exception');
    teacher.emit('class:control', { action: 'end' });
    await exP;
    expect(await raw.assignment.count({ where: { lessonId: fx.lessonId, kind: 'homework' } })).toBe(1);
  }, 25000);
});
