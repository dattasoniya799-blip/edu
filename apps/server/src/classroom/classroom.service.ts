import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type Redis from 'ioredis';
import type { Namespace, Socket } from 'socket.io';
import type {
  AnswerResult,
  AttemptQuestionView,
  ClassControl,
  ClassSnapshot,
  CoursewarePageView,
  MiniQuizView,
  ParticipantMonitor,
  ParticipantSelfState,
  ParticipantState,
  SegmentType,
  SessionStatus,
} from '@qiming/contracts';
import { dec, num } from '../admin/helpers';
import { AssignmentService } from '../assignment/assignment.service';
import { AttemptService } from '../attempt/attempt.service';
import type { JwtUser } from '../auth/auth.service';
import { runAsUser } from '../common/tenant-context';
import { PrismaService } from '../prisma/prisma.service';
import { REDIS } from '../redis/redis.module';
import {
  kEvents,
  kEventsCursor,
  kMeta,
  kSessionPattern,
  kStu,
  kStuPattern,
  kStuck,
} from './redis-keys';

/** 业务错误(gateway 捕获后向客户端 emit 'exception') */
export class ClsError extends Error {}

const ROOM = (sid: number) => `session:${sid}`;
const TEACHER_ROOM = (sid: number) => `session:${sid}:teacher`;

/** 旁白模板(宪法 §4:业务模块不接 LLM,A7 AiGateway 落地后替换文案来源) */
const NARRATION = {
  correct: '回答正确,继续保持这个思路!',
  wrong: '这题先别急,对照解析想想是哪一步出了偏差。',
  pending: '过程已提交,老师稍后会查看你的解题步骤。',
};
/** 引导式答疑模板(guideOnly:不给最终答案,只给路径;A7 接真实网关后替换) */
const QA_GUIDE_REPLY =
  '我们一步步来:先把题目的已知条件逐条列出来,明确要求的量;' +
  '再想想最近学过的方法里,哪一个能把已知和未知联系起来。' +
  '先试着写出第一步,卡住了再告诉我你写到哪儿了。';

interface MetaState {
  org_id: string;
  lesson_id: string;
  course_id: string;
  teacher_id: string;
  lesson_title: string;
  status: SessionStatus;
  started_at: string; // ms,'' = 未开始
  paused_at: string;
  paused_total_sec: string;
  current_segment: string;
  mode: string; // JSON(契约 camelCase)
  segments: string; // JSON [{seq,type,durationMin}]
}

interface RosterThrottle {
  lastEmit: number;
  timer: NodeJS.Timeout | null;
}

/**
 * 课堂实时核心(任务卡 A6,设计文档第 7 章):
 * - 服务端是课堂状态唯一权威:热状态在 Redis(7.4 形状,a6: 前缀),作答本体在 PG(A5 通道)
 * - 事件全部 XADD 进 events STREAM,周期消费者批量落 session_events;
 *   participants 周期回写 PG(默认 30s,可经 CLS_WRITEBACK_INTERVAL_MS 注入)
 * - 状态机 scheduled→live→paused⇄live→ended(7.6);ended 结算:参与者归档 +
 *   课后作业经 A4 AssignmentService.create 自动发布(禁止重写发布逻辑)
 * - Redis flush 后 rebuildHotState() 从 PG 最近快照 + session_events 重建(7.5/7.4 落库策略)
 */
@Injectable()
export class ClassroomService implements OnModuleInit, OnModuleDestroy {
  private nsp: Namespace | null = null;
  /** 本实例正在服务的课堂(消费者/回写循环的工作集) */
  private readonly active = new Set<number>();
  private readonly roster = new Map<number, RosterThrottle>();
  private consumerTimer: NodeJS.Timeout | null = null;
  private writebackTimer: NodeJS.Timeout | null = null;

  private readonly throttleMs: number;
  private readonly consumerMs: number;
  private readonly writebackMs: number;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly assignments: AssignmentService,
    private readonly attempts: AttemptService,
    cfg: ConfigService,
  ) {
    // 周期可注入(测试用短周期);roster 节流契约值 5s
    this.throttleMs = Number(cfg.get('CLS_ROSTER_THROTTLE_MS', '5000'));
    this.consumerMs = Number(cfg.get('CLS_CONSUMER_INTERVAL_MS', '1000'));
    this.writebackMs = Number(cfg.get('CLS_WRITEBACK_INTERVAL_MS', '30000'));
  }

  setServer(nsp: Namespace) {
    this.nsp = nsp;
  }

  onModuleInit() {
    this.consumerTimer = setInterval(() => {
      for (const sid of this.active) this.consumeSessionEvents(sid).catch(() => undefined);
    }, this.consumerMs);
    this.writebackTimer = setInterval(() => {
      for (const sid of this.active) this.writebackSession(sid).catch(() => undefined);
    }, this.writebackMs);
  }

  onModuleDestroy() {
    if (this.consumerTimer) clearInterval(this.consumerTimer);
    if (this.writebackTimer) clearInterval(this.writebackTimer);
    for (const st of this.roster.values()) if (st.timer) clearTimeout(st.timer);
    this.roster.clear();
  }

  // ================= C→S 事件处理(均已处于 runAsUser 租户上下文) =================

  /** class:join:本课成员校验 → 热状态确保/重建 → scheduled→live → 返回 ClassSnapshot(7.5) */
  async join(user: JwtUser, socket: Socket, p: { sessionId: number }): Promise<ClassSnapshot> {
    const sid = Number(p?.sessionId);
    if (!Number.isInteger(sid)) throw new ClsError('sessionId 缺失');

    // 租户注入下查询:他 org 的 session 天然查不到(宪法 §7)
    const session = await this.prisma.client.classSession.findFirst({
      where: { id: BigInt(sid) },
      include: { lesson: { select: { id: true, courseId: true, status: true, scheduledStart: true, course: { select: { teacherId: true } } } } },
    });
    if (!session) throw new ClsError('课堂不存在');
    if (session.status === 'ended') throw new ClsError('课堂已结束');
    // IMPL #9:老师发布即可进——讲次未发布(draft)拒绝;已发布(ready/in_progress 等)即可进入,不看时间
    if (session.lesson.status === 'draft') throw new ClsError('讲次未发布,无法进入课堂');

    // 本课成员校验(7.2):学生=有效选课,教师=本课授课教师
    if (user.role === 'student') {
      const enrolled = await this.prisma.client.courseStudent.findFirst({
        where: { courseId: session.lesson.courseId, studentId: BigInt(user.uid), status: 'active' },
        select: { id: true },
      });
      if (!enrolled) throw new ClsError('不是本课学生');
    } else if (user.role === 'teacher') {
      if (num(session.lesson.course.teacherId) !== user.uid) throw new ClsError('不是本课教师');
    } else {
      throw new ClsError('不是本课成员');
    }

    await this.ensureHotState(sid);

    // 状态机:scheduled → live(IMPL #9:讲次已发布即可开课,去掉"未到时间不可进"的时间门槛;
    // updateMany 条件更新保证只发生一次)
    let meta = await this.getMeta(sid);
    if (meta.status === 'scheduled') {
      const now = new Date();
      const hit = await this.prisma.client.classSession.updateMany({
        where: { id: BigInt(sid), status: 'scheduled' },
        data: { status: 'live', actualStart: now },
      });
      if (hit.count > 0) {
        await this.redis.hset(kMeta(sid), { status: 'live', started_at: String(now.getTime()) });
      }
      meta = await this.getMeta(sid);
    }

    socket.data.sessionId = sid;
    await socket.join(ROOM(sid));
    if (user.role === 'teacher') {
      await socket.join(TEACHER_ROOM(sid));
      this.markDirty(sid); // 教师进场即推一帧 roster(节流内)
      return this.buildSnapshot(sid, user);
    }

    // 学生:参与者落库(joinAt 保留首次)+ 热状态上线
    await this.prisma.client.sessionParticipant.upsert({
      where: { sessionId_studentId: { sessionId: BigInt(sid), studentId: BigInt(user.uid) } },
      update: { leaveAt: null },
      create: {
        sessionId: BigInt(sid),
        studentId: BigInt(user.uid),
        joinAt: new Date(),
        currentSegment: 1,
        state: 'normal',
      } as never,
    });
    const stuKey = kStu(sid, user.uid);
    const name = await this.studentName(user.uid);
    if (await this.redis.exists(stuKey)) {
      await this.redis.hset(stuKey, { online: '1', name });
      if ((await this.redis.hget(stuKey, 'state')) === 'offline') {
        await this.redis.hset(stuKey, { state: 'normal' });
      }
    } else {
      await this.redis.hset(stuKey, {
        segment: '1', q_index: '', answered: '0', correct: '0', wrong: '0',
        state: 'normal', last_heartbeat: String(Date.now()), idle_sec: '0',
        ai_ask_count: '0', name, online: '1', wrong_qids: '[]', ai_chat_tail: '[]',
      });
    }
    await this.xadd(sid, 'join', user.uid, {});
    this.markDirty(sid);

    const snapshot = await this.buildSnapshot(sid, user);
    socket.emit('class:state', await this.selfState(sid, user.uid));
    return snapshot;
  }

  /** class:segment:学生进入某环节 */
  async segment(user: JwtUser, socket: Socket, p: { segmentSeq: number }): Promise<void> {
    const sid = this.requireJoined(socket);
    this.requireStudent(user);
    const seq = Number(p?.segmentSeq);
    const meta = await this.getMeta(sid);
    const segments = JSON.parse(meta.segments) as { seq: number }[];
    if (!segments.some((s) => s.seq === seq)) throw new ClsError('环节不存在');

    await this.redis.hset(kStu(sid, user.uid), { segment: String(seq) });
    await this.xadd(sid, 'segment_enter', user.uid, { segmentSeq: seq });
    socket.emit('class:state', await this.selfState(sid, user.uid));
    this.markDirty(sid);
  }

  /**
   * class:answer:随堂作答(等价 REST,二选一通道,7.3)。
   * 判分完全复用 A5 AttemptService(start 幂等 + submitAnswer 即时判分),禁止重写口径;
   * 作答本体随 A5 落 PG answers,Redis 仅维护计数热状态 → flush 不丢已答(7.4)。
   */
  async answer(
    user: JwtUser,
    socket: Socket,
    p: { questionId: number; response: Record<string, unknown> },
  ): Promise<AnswerResult> {
    const sid = this.requireJoined(socket);
    this.requireStudent(user);
    const questionId = Number(p?.questionId);
    const meta = await this.getMeta(sid);

    const assignmentId = await this.findInClassAssignment(meta, questionId);
    const attempt = await this.attempts.start(user, assignmentId);
    const r = await this.attempts.submitAnswer(user, attempt.id, questionId, {
      response: p.response,
    });

    // 计数热状态以 PG 为准重算(re-answer/重连都收敛)
    await this.refreshCounters(sid, user.uid, BigInt(meta.lesson_id));
    await this.redis.hset(kStu(sid, user.uid), { q_index: String(questionId) });
    await this.xadd(sid, 'answer_submit', user.uid, {
      questionId,
      judged: r.judged,
      isCorrect: r.isCorrect,
    });

    const narration = r.judged ? (r.isCorrect ? NARRATION.correct : NARRATION.wrong) : NARRATION.pending;
    socket.emit('class:state', await this.selfState(sid, user.uid));
    socket.emit('class:narration', { text: narration });
    this.markDirty(sid);

    return {
      questionId,
      judged: r.judged,
      isCorrect: r.isCorrect,
      correctAnswer: r.correctAnswer,
      narration,
    };
  }

  /** class:ai_ask:答疑,回复以 class:ai_chunk 流式下发(模板引导,A7 网关落地后替换) */
  async aiAsk(
    user: JwtUser,
    socket: Socket,
    p: { questionId: number | null; message: string },
  ): Promise<void> {
    const sid = this.requireJoined(socket);
    this.requireStudent(user);
    const message = String(p?.message ?? '').slice(0, 2000);
    if (!message) throw new ClsError('message 缺失');

    const requestId = `qa-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const reply = QA_GUIDE_REPLY;
    const step = Math.ceil(reply.length / 3);
    for (let i = 0; i < reply.length; i += step) {
      socket.emit('class:ai_chunk', { requestId, delta: reply.slice(i, i + step), done: false });
    }
    socket.emit('class:ai_chunk', { requestId, delta: '', done: true });

    // 对话尾部(最近 10 条)+ 计数
    const stuKey = kStu(sid, user.uid);
    const tail = this.parseJson<{ role: string; text: string }[]>(
      await this.redis.hget(stuKey, 'ai_chat_tail'), [],
    );
    tail.push({ role: 'user', text: message }, { role: 'assistant', text: reply });
    await this.redis.hset(stuKey, { ai_chat_tail: JSON.stringify(tail.slice(-10)) });
    await this.redis.hincrby(stuKey, 'ai_ask_count', 1);
    await this.xadd(sid, 'ai_ask', user.uid, { questionId: p?.questionId ?? null, message, reply });
    this.markDirty(sid);
  }

  /** class:hand_up:举手 → 教师房间 monitor:alert */
  async handUp(user: JwtUser, socket: Socket): Promise<void> {
    const sid = this.requireJoined(socket);
    this.requireStudent(user);
    const stuKey = kStu(sid, user.uid);
    await this.redis.hset(stuKey, { state: 'hand_up' });
    const name = (await this.redis.hget(stuKey, 'name')) ?? '';
    this.emitTeacher(sid, 'monitor:alert', {
      studentId: user.uid,
      studentName: name,
      type: 'hand_up',
      detail: `${name} 举手请求帮助`,
    });
    await this.xadd(sid, 'hand_up', user.uid, {});
    this.markDirty(sid);
  }

  /**
   * class:heartbeat:10s 一次,驱动卡住检测——idleSec 超 mode.stuckAlertMin
   * → 进 stuck ZSET(score=开始停留时间,7.4)并向教师房间发 monitor:alert(去重:ZADD NX)。
   */
  async heartbeat(
    user: JwtUser,
    socket: Socket,
    p: { currentQuestion: number | null; idleSec: number },
  ): Promise<void> {
    const sid = this.requireJoined(socket);
    this.requireStudent(user);
    await this.ensureHotState(sid); // Redis 故障后由心跳/join 触发自动重建
    const idleSec = Math.max(0, Number(p?.idleSec) || 0);
    const stuKey = kStu(sid, user.uid);
    const now = Date.now();

    const fields: Record<string, string> = {
      last_heartbeat: String(now),
      idle_sec: String(idleSec),
      online: '1',
    };
    if (p?.currentQuestion != null) fields.q_index = String(Number(p.currentQuestion));
    await this.redis.hset(stuKey, fields);

    const meta = await this.getMeta(sid);
    const mode = JSON.parse(meta.mode) as { stuckAlertMin: number };
    const thresholdSec = Math.max(1, Number(mode.stuckAlertMin) * 60);
    if (idleSec >= thresholdSec) {
      const stuckSince = Math.round(now / 1000 - idleSec);
      const added = await this.redis.zadd(kStuck(sid), 'NX', stuckSince, String(user.uid));
      if (added) {
        await this.redis.hset(stuKey, { state: 'stuck' });
        const name = (await this.redis.hget(stuKey, 'name')) ?? '';
        this.emitTeacher(sid, 'monitor:alert', {
          studentId: user.uid,
          studentName: name,
          type: 'stuck',
          detail: `已停留 ${Math.round(idleSec / 60)} 分钟(阈值 ${mode.stuckAlertMin} 分钟)`,
        });
        await this.xadd(sid, 'stuck_alert', user.uid, { idleSec, questionId: p?.currentQuestion ?? null });
      }
    } else {
      const removed = await this.redis.zrem(kStuck(sid), String(user.uid));
      if (removed && (await this.redis.hget(stuKey, 'state')) === 'stuck') {
        await this.redis.hset(stuKey, { state: 'normal' });
      }
    }
    this.markDirty(sid);
  }

  /**
   * class:control:课堂控制(仅本课教师)。状态机 7.6,DB 条件更新保证转移合法且幂等;
   * 广播 S→C class:control(契约形状);end → 结算 settle()。
   */
  async control(user: JwtUser, socket: Socket, p: ClassControl): Promise<void> {
    const sid = this.requireJoined(socket);
    const meta = await this.getMeta(sid);
    if (user.role !== 'teacher' || num(BigInt(meta.teacher_id)) !== user.uid) {
      throw new ClsError('仅本课教师可控制课堂');
    }
    const now = Date.now();

    switch (p?.action) {
      case 'pause': {
        await this.transition(sid, ['live'], 'paused');
        await this.redis.hset(kMeta(sid), { status: 'paused', paused_at: String(now) });
        this.broadcast(sid, { action: 'pause' });
        return;
      }
      case 'resume': {
        await this.transition(sid, ['paused'], 'live');
        const pausedAt = Number(meta.paused_at || now);
        const total = Number(meta.paused_total_sec || 0) + Math.round((now - pausedAt) / 1000);
        await this.redis.hset(kMeta(sid), {
          status: 'live', paused_at: '', paused_total_sec: String(total),
        });
        this.broadcast(sid, { action: 'resume' });
        return;
      }
      case 'force_segment': {
        if (meta.status !== 'live') throw new ClsError('仅 live 状态可切换环节');
        const seq = Number(p.segmentSeq);
        const segments = JSON.parse(meta.segments) as { seq: number }[];
        if (!segments.some((s) => s.seq === seq)) throw new ClsError('环节不存在');
        await this.redis.hset(kMeta(sid), { current_segment: String(seq) });
        await this.xadd(sid, 'segment_enter', null, { segmentSeq: seq, forced: true });
        this.broadcast(sid, { action: 'force_segment', segmentSeq: seq });
        this.markDirty(sid);
        return;
      }
      case 'end': {
        await this.transition(sid, ['live', 'paused'], 'ended', { actualEnd: new Date() });
        await this.redis.hset(kMeta(sid), { status: 'ended' });
        this.broadcast(sid, { action: 'end' });
        await this.settle(sid, meta, user);
        return;
      }
      default:
        throw new ClsError('未知控制指令');
    }
  }

  /** 断线:热状态下线 + leave 事件 + 参与者 leaveAt(作答本体在 PG,课堂还在,7.1) */
  async onDisconnect(user: JwtUser, socket: Socket): Promise<void> {
    const sid = socket.data.sessionId as number | undefined;
    if (!sid || user.role !== 'student') return;
    await this.prisma.client.sessionParticipant.updateMany({
      where: { sessionId: BigInt(sid), studentId: BigInt(user.uid) },
      data: { leaveAt: new Date() },
    });
    if (!(await this.redis.exists(kMeta(sid)))) return; // 已结算/已清键
    await this.redis.hset(kStu(sid, user.uid), { online: '0', state: 'offline' });
    await this.xadd(sid, 'leave', user.uid, {});
    this.markDirty(sid);
  }

  // ================= 热状态:确保 / 从 PG 重建(7.4 落库策略 + 7.5) =================

  private async ensureHotState(sid: number): Promise<void> {
    if (await this.redis.exists(kMeta(sid))) {
      this.active.add(sid);
      return;
    }
    await this.rebuildHotState(sid);
  }

  /**
   * Redis 故障/flush 后的恢复函数:从 PG 最近快照重建热状态。
   * - meta:class_sessions + lesson(title/segments/mode 归一化)
   * - stu HASH:session_participants 周期回写的 progress 快照 + answers 重算计数
   *   (作答本体在 PG,不丢已答)+ session_events 重放 AI 对话尾部
   * - 可接受 ≤30s 进度回退(回写周期内的计数/心跳态)
   */
  async rebuildHotState(sid: number): Promise<void> {
    const session = await this.prisma.client.classSession.findFirst({
      where: { id: BigInt(sid) },
      include: {
        lesson: {
          include: {
            segments: { orderBy: { seq: 'asc' } },
            course: { select: { id: true, teacherId: true } },
          },
        },
      },
    });
    if (!session) throw new ClsError('课堂不存在');
    if (session.status === 'ended') throw new ClsError('课堂已结束');

    await this.delSessionKeys(sid); // 清残留半态,整体重建

    const practice = session.lesson.segments.find((s) => s.type === 'practice');
    const practiceCfg = (practice?.config ?? {}) as Record<string, unknown>;
    const mode = this.normalizeMode(session.mode, practiceCfg);
    const segments = session.lesson.segments.map((s) => ({
      seq: s.seq, type: s.type as SegmentType, durationMin: s.durationMin,
    }));

    const participants = await this.prisma.client.sessionParticipant.findMany({
      where: { sessionId: BigInt(sid) },
    });
    const maxSeg = Math.max(
      1,
      ...participants.map((p) => {
        const prog = (p.progress ?? {}) as Record<string, unknown>;
        return Number(prog.segment ?? p.currentSegment ?? 1) || 1;
      }),
    );

    const meta: MetaState = {
      org_id: String(session.orgId),
      lesson_id: String(session.lessonId),
      course_id: String(session.lesson.course.id),
      teacher_id: String(session.lesson.course.teacherId),
      lesson_title: session.lesson.title,
      status: session.status,
      started_at: session.actualStart ? String(session.actualStart.getTime()) : '',
      paused_at: '',
      paused_total_sec: '0',
      current_segment: String(maxSeg),
      mode: JSON.stringify(mode),
      segments: JSON.stringify(segments),
    };
    await this.redis.hset(kMeta(sid), meta as unknown as Record<string, string>);

    for (const p of participants) {
      const hash = await this.buildStudentHashFromPg(sid, session.lessonId, p);
      await this.redis.hset(kStu(sid, num(p.studentId)), hash);
    }
    this.active.add(sid);
  }

  private async buildStudentHashFromPg(
    sid: number,
    lessonId: bigint,
    participant: { studentId: bigint; currentSegment: number | null; state: string; progress: unknown },
  ): Promise<Record<string, string>> {
    const prog = (participant.progress ?? {}) as Record<string, unknown>;
    const answers = await this.studentSessionAnswers(lessonId, num(participant.studentId));
    const correct = answers.filter((a) => a.isCorrect === true).length;
    const tail = await this.rebuildChatTail(sid, num(participant.studentId));
    const state = participant.state === 'offline' ? 'normal' : participant.state;
    return {
      segment: String(Number(prog.segment ?? participant.currentSegment ?? 1) || 1),
      q_index: prog.current_question != null ? String(prog.current_question) : '',
      answered: String(answers.length),
      correct: String(correct),
      wrong: String(answers.length - correct),
      state,
      last_heartbeat: String(Date.now()),
      idle_sec: '0',
      ai_ask_count: String(Number(prog.ai_ask_count ?? tail.filter((t) => t.role === 'user').length) || 0),
      name: await this.studentName(num(participant.studentId)),
      online: '0',
      wrong_qids: JSON.stringify(answers.filter((a) => a.isCorrect === false).map((a) => a.questionId)),
      ai_chat_tail: JSON.stringify(tail),
    };
  }

  /** AI 对话尾部从 session_events(type=ai_ask)重放,取最近 10 条 */
  private async rebuildChatTail(sid: number, studentId: number) {
    const events = await this.prisma.client.sessionEvent.findMany({
      where: { sessionId: BigInt(sid), studentId: BigInt(studentId), type: 'ai_ask' },
      orderBy: { ts: 'desc' },
      take: 5,
    });
    const tail: { role: 'user' | 'assistant'; text: string }[] = [];
    for (const e of events.reverse()) {
      const payload = (e.payload ?? {}) as { message?: string; reply?: string };
      tail.push(
        { role: 'user', text: payload.message ?? '' },
        { role: 'assistant', text: payload.reply ?? '' },
      );
    }
    return tail.slice(-10);
  }

  // ================= snapshot / roster / state =================

  /** ClassSnapshot(契约 ws-protocol.ts;7.5 断线恢复载体) */
  private async buildSnapshot(sid: number, user: JwtUser): Promise<ClassSnapshot> {
    const meta = await this.getMeta(sid);
    const session: ClassSnapshot['session'] = {
      id: sid,
      status: meta.status,
      lessonTitle: meta.lesson_title,
      segments: JSON.parse(meta.segments),
      currentSegmentSeq: Number(meta.current_segment) || 1,
      elapsedSec: this.elapsedSec(meta),
      mode: JSON.parse(meta.mode),
    };
    // 题面/课件为本讲静态内容(随堂练题面 + 课件分页),与角色无关,真实模式下随快照下发
    const content = await this.buildLessonContent(BigInt(meta.lesson_id));
    if (user.role !== 'student') {
      return {
        session,
        me: { segment: session.currentSegmentSeq, currentQuestion: null, answers: [], wrongBookAdded: [], aiChatTail: [] },
        ...content,
      };
    }
    const stu = await this.redis.hgetall(kStu(sid, user.uid));
    const answers = await this.studentSessionAnswers(BigInt(meta.lesson_id), user.uid);
    return {
      session,
      me: {
        segment: Number(stu.segment) || 1,
        currentQuestion: stu.q_index ? Number(stu.q_index) : null,
        answers,
        wrongBookAdded: this.parseJson<number[]>(stu.wrong_qids, []),
        aiChatTail: this.parseJson(stu.ai_chat_tail, []),
      },
      ...content,
    };
  }

  /**
   * 本讲随堂练题面 + 课件分页(B6 真实模式)。两者均为可选:无内容时省略该键,前端优雅降级。
   * - questions:遍历 practice 段试卷,复用 A5 AttemptService.paperQuestionViews(revealed=false:
   *   课中 correctAnswer/analysisLatex 恒为 null,防作弊),形状与 AttemptDto.questions 一致。
   * - courseware:遍历 lecture 段,仅按「真实存在的结构化逐页内容」组装,无则空(绝不编造)。
   */
  private async buildLessonContent(
    lessonId: bigint,
  ): Promise<Pick<ClassSnapshot, 'questions' | 'courseware'>> {
    const segments = await this.prisma.client.lessonSegment.findMany({
      where: { lessonId },
      orderBy: { seq: 'asc' },
      include: { resource: { select: { meta: true } } },
    });
    const out: { questions?: AttemptQuestionView[]; courseware?: CoursewarePageView[] } = {};

    const questions: AttemptQuestionView[] = [];
    for (const seg of segments) {
      if (seg.type === 'practice' && seg.paperId != null) {
        questions.push(...(await this.attempts.paperQuestionViews(seg.paperId, false)));
      }
    }
    if (questions.length) out.questions = questions;

    const courseware = this.buildCourseware(segments);
    if (courseware.length) out.courseware = courseware;
    return out;
  }

  /**
   * 课件分页(lecture 段)。真实数据源调查结论(见任务卡):演示库 lecture 段只挂二进制交互课件
   * (Resource type=interactive,oss_key 指向 HTML)+ 整数页码 checkpoints,**无逐页标题/正文/旁白文本**。
   * 因此本函数仅在「config.pages 或 resource.meta.pages 为结构化逐页对象数组(含 title/body)」时组装,
   * 否则返回空——既如实承载未来编排侧采集的逐页内容,又绝不为缺失内容编造 mock 文案。
   */
  private buildCourseware(
    segments: { type: string; config: unknown; resource: { meta: unknown } | null }[],
  ): CoursewarePageView[] {
    const out: CoursewarePageView[] = [];
    for (const seg of segments) {
      if (seg.type !== 'lecture') continue;
      const cfg = (seg.config ?? {}) as Record<string, unknown>;
      const meta = (seg.resource?.meta ?? {}) as Record<string, unknown>;
      out.push(...this.coursewarePages(cfg.pages ?? meta.pages));
    }
    return out;
  }

  /** 逐页内容数组(对象含 title/body 才视为可渲染逐页;数字总页数 / 整数 checkpoints 等非结构化值 → 跳过) */
  private coursewarePages(raw: unknown): CoursewarePageView[] {
    if (!Array.isArray(raw)) return [];
    const out: CoursewarePageView[] = [];
    for (const p of raw) {
      if (!p || typeof p !== 'object') continue;
      const o = p as Record<string, unknown>;
      if (typeof o.title !== 'string' && typeof o.body !== 'string') continue;
      const page: CoursewarePageView = {
        title: typeof o.title === 'string' ? o.title : '',
        body: typeof o.body === 'string' ? o.body : '',
        narration: typeof o.narration === 'string' ? o.narration : '',
      };
      const quiz = this.miniQuiz(o.quiz);
      if (quiz) page.quiz = quiz;
      out.push(page);
    }
    return out;
  }

  /** 打点小测(lecture 翻页即时小测):stem + options 齐备才视为有效,否则缺省 */
  private miniQuiz(raw: unknown): MiniQuizView | undefined {
    if (!raw || typeof raw !== 'object') return undefined;
    const o = raw as Record<string, unknown>;
    if (typeof o.stem !== 'string' || !Array.isArray(o.options)) return undefined;
    const options = o.options
      .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
      .map((x) => ({ label: String(x.label ?? ''), contentLatex: String(x.contentLatex ?? '') }));
    return { stem: o.stem, options, correct: String(o.correct ?? ''), hint: String(o.hint ?? '') };
  }

  /** 已答题与判定(作答本体在 PG:本讲 in_class assignment 的最新 attempt) */
  private async studentSessionAnswers(
    lessonId: bigint,
    studentId: number,
  ): Promise<{ questionId: number; isCorrect: boolean | null; score: number | null }[]> {
    const list = await this.prisma.client.assignment.findMany({
      where: { lessonId, kind: 'in_class' },
      select: { id: true },
    });
    if (!list.length) return [];
    const attempts = await this.prisma.client.attempt.findMany({
      where: { assignmentId: { in: list.map((a) => a.id) }, studentId: BigInt(studentId) },
      orderBy: { attemptNo: 'asc' },
      include: { answers: { orderBy: { id: 'asc' } } },
    });
    // 每个 assignment 取最新 attempt
    const latest = new Map<string, (typeof attempts)[number]>();
    for (const at of attempts) latest.set(String(at.assignmentId), at);
    const out: { questionId: number; isCorrect: boolean | null; score: number | null }[] = [];
    for (const at of latest.values()) {
      for (const a of at.answers) {
        out.push({ questionId: num(a.questionId), isCorrect: a.isCorrect, score: dec(a.score) });
      }
    }
    return out;
  }

  private async refreshCounters(sid: number, studentId: number, lessonId: bigint): Promise<void> {
    const answers = await this.studentSessionAnswers(lessonId, studentId);
    const correct = answers.filter((a) => a.isCorrect === true).length;
    await this.redis.hset(kStu(sid, studentId), {
      answered: String(answers.length),
      correct: String(correct),
      wrong: String(answers.length - correct),
      wrong_qids: JSON.stringify(answers.filter((a) => a.isCorrect === false).map((a) => a.questionId)),
    });
  }

  private async selfState(sid: number, studentId: number): Promise<ParticipantSelfState> {
    const stu = await this.redis.hgetall(kStu(sid, studentId));
    return {
      segment: Number(stu.segment) || 1,
      state: (stu.state || 'normal') as ParticipantState,
      answeredCount: Number(stu.answered) || 0,
      correctCount: Number(stu.correct) || 0,
    };
  }

  /** monitor:roster 节流(契约:5s 一帧,内容为全班最新):trailing-edge 合帧 */
  private markDirty(sid: number): void {
    if (!this.nsp) return;
    let st = this.roster.get(sid);
    if (!st) {
      st = { lastEmit: 0, timer: null };
      this.roster.set(sid, st);
    }
    if (st.timer) return; // 已有待发帧,合并
    const delay = Math.max(0, st.lastEmit + this.throttleMs - Date.now());
    st.timer = setTimeout(() => {
      st!.timer = null;
      st!.lastEmit = Date.now();
      this.emitRoster(sid).catch(() => undefined);
    }, delay);
  }

  private async emitRoster(sid: number): Promise<void> {
    if (!this.nsp || !(await this.redis.exists(kMeta(sid)))) return;
    const participants = await this.buildRoster(sid);
    this.emitTeacher(sid, 'monitor:roster', { participants });
  }

  private async buildRoster(sid: number): Promise<ParticipantMonitor[]> {
    const keys = await this.scanKeys(kStuPattern(sid));
    const now = Date.now();
    const out: ParticipantMonitor[] = [];
    for (const key of keys) {
      const h = await this.redis.hgetall(key);
      if (!Object.keys(h).length) continue;
      const studentId = Number(key.slice(key.lastIndexOf(':') + 1));
      const stuck = h.state === 'stuck';
      out.push({
        studentId,
        studentName: h.name ?? '',
        segment: Number(h.segment) || 1,
        currentQuestion: h.q_index ? Number(h.q_index) : null,
        answeredCount: Number(h.answered) || 0,
        correctCount: Number(h.correct) || 0,
        state: (h.state || 'normal') as ParticipantState,
        stuckSec: stuck
          ? Math.max(0, Math.round((Number(h.idle_sec) || 0) + (now - (Number(h.last_heartbeat) || now)) / 1000))
          : 0,
        aiAskCount: Number(h.ai_ask_count) || 0,
        online: h.online === '1',
      });
    }
    return out.sort((a, b) => a.studentId - b.studentId);
  }

  // ================= STREAM 消费者 / participants 回写 / 结算 =================

  /** events STREAM → 批量落 session_events(7.4 落库策略;游标推进,settle 前最后一次 drain) */
  async consumeSessionEvents(sid: number): Promise<void> {
    const meta = await this.redis.hgetall(kMeta(sid));
    if (!meta.org_id) return;
    const cursorKey = kEventsCursor(sid);
    const cursor = (await this.redis.get(cursorKey)) ?? null;
    const entries = (await this.redis.xrange(
      kEvents(sid), cursor ? `(${cursor}` : '-', '+', 'COUNT', 500,
    )) as [string, string[]][];
    if (!entries.length) return;

    const rows = entries.map(([, fields]) => {
      const f: Record<string, string> = {};
      for (let i = 0; i < fields.length; i += 2) f[fields[i]] = fields[i + 1];
      return {
        sessionId: BigInt(sid),
        studentId: f.student_id ? BigInt(f.student_id) : null,
        type: f.type,
        payload: this.parseJson<object>(f.payload, {}),
        ts: new Date(Number(f.ts) || Date.now()),
      };
    });
    // 周期任务无请求上下文 → 以 meta 记录的 org 建租户上下文(机制同 ContextMiddleware/runAsUser)
    await this.runAsOrgSystem(meta, () =>
      this.prisma.client.sessionEvent.createMany({ data: rows as never }),
    );
    await this.redis.set(cursorKey, entries[entries.length - 1][0]);
  }

  /** participants 周期回写 PG(默认 30s;结算时附带 leaveAt 归档) */
  async writebackSession(sid: number, opts?: { leaveAt?: Date }): Promise<void> {
    const meta = await this.redis.hgetall(kMeta(sid));
    if (!meta.org_id) return;
    const keys = await this.scanKeys(kStuPattern(sid));
    for (const key of keys) {
      const h = await this.redis.hgetall(key);
      if (!Object.keys(h).length) continue;
      const studentId = BigInt(key.slice(key.lastIndexOf(':') + 1));
      await this.runAsOrgSystem(meta, () =>
        this.prisma.client.sessionParticipant.updateMany({
          where: { sessionId: BigInt(sid), studentId },
          data: {
            currentSegment: Number(h.segment) || 1,
            state: (h.state || 'normal') as never,
            progress: {
              segment: Number(h.segment) || 1,
              current_question: h.q_index ? Number(h.q_index) : null,
              answered: Number(h.answered) || 0,
              correct: Number(h.correct) || 0,
              wrong: Number(h.wrong) || 0,
              ai_ask_count: Number(h.ai_ask_count) || 0,
              wrong_qids: this.parseJson<number[]>(h.wrong_qids, []),
              idle_sec: Number(h.idle_sec) || 0,
            },
            ...(opts?.leaveAt ? { leaveAt: opts.leaveAt } : {}),
          },
        }),
      );
    }
  }

  /**
   * ended 结算(7.6):参与者归档(最终回写 + leaveAt)→ 讲次 finished →
   * 课后作业自动发布(homework 环节挂的卷,经 A4 AssignmentService.create,整班 target,
   * 幂等:已存在同卷 homework assignment 则跳过)→ 事件流最后一次 drain → 清本会话 Redis 键。
   */
  private async settle(sid: number, meta: MetaState, byUser: JwtUser): Promise<void> {
    await this.writebackSession(sid, { leaveAt: new Date() });

    const lessonId = BigInt(meta.lesson_id);
    await this.prisma.client.lesson.updateMany({
      where: { id: lessonId },
      data: { status: 'finished' },
    });

    const hwSegments = await this.prisma.client.lessonSegment.findMany({
      where: { lessonId, type: 'homework', paperId: { not: null } },
      select: { paperId: true },
    });
    const teacherUser: JwtUser = { uid: Number(meta.teacher_id), orgId: byUser.orgId, role: 'teacher' };
    for (const seg of hwSegments) {
      const exists = await this.prisma.client.assignment.findFirst({
        where: { lessonId, kind: 'homework', paperId: seg.paperId! },
        select: { id: true },
      });
      if (exists) continue;
      await this.assignments.create(teacherUser, {
        paperId: num(seg.paperId!),
        lessonId: num(lessonId),
        kind: 'homework',
        target: { courseId: Number(meta.course_id) },
      } as never);
    }

    await this.consumeSessionEvents(sid).catch(() => undefined);
    await this.delSessionKeys(sid);
    this.active.delete(sid);
    const st = this.roster.get(sid);
    if (st?.timer) clearTimeout(st.timer);
    this.roster.delete(sid);
  }

  // ================= 内部工具 =================

  private requireJoined(socket: Socket): number {
    const sid = socket.data.sessionId as number | undefined;
    if (!sid) throw new ClsError('请先 class:join');
    return sid;
  }

  private requireStudent(user: JwtUser): void {
    if (user.role !== 'student') throw new ClsError('仅学生可执行此操作');
  }

  private async getMeta(sid: number): Promise<MetaState> {
    const meta = (await this.redis.hgetall(kMeta(sid))) as unknown as MetaState;
    if (!meta.org_id) {
      await this.rebuildHotState(sid);
      return (await this.redis.hgetall(kMeta(sid))) as unknown as MetaState;
    }
    return meta;
  }

  /** 状态机转移:条件更新保证合法性与幂等(命中 0 行 = 非法切换) */
  private async transition(
    sid: number,
    from: SessionStatus[],
    to: SessionStatus,
    extra: Record<string, unknown> = {},
  ): Promise<void> {
    const hit = await this.prisma.client.classSession.updateMany({
      where: { id: BigInt(sid), status: { in: from as never } },
      data: { status: to as never, ...extra },
    });
    if (!hit.count) throw new ClsError(`非法状态切换:仅 ${from.join('/')} 可 → ${to}`);
  }

  private elapsedSec(meta: MetaState): number {
    if (!meta.started_at) return 0;
    const started = Number(meta.started_at);
    const end = meta.status === 'paused' && meta.paused_at ? Number(meta.paused_at) : Date.now();
    return Math.max(0, Math.round((end - started) / 1000 - Number(meta.paused_total_sec || 0)));
  }

  /** mode 归一化:DB JSON(schema 注释为 snake_case)→ 契约 camelCase;缺省回退 practice 环节配置 */
  private normalizeMode(raw: unknown, practiceCfg: Record<string, unknown>) {
    const m = (raw ?? {}) as Record<string, unknown>;
    return {
      guideOnly: Boolean(m.guideOnly ?? m.guide_only ?? false),
      stuckAlertMin: Number(m.stuckAlertMin ?? m.stuck_alert_min ?? practiceCfg.stuck_alert_min ?? 5),
      lockdown: Boolean(m.lockdown ?? false),
      syncSegments: Boolean(m.syncSegments ?? m.sync_segments ?? false),
    };
  }

  /** 随堂练习题 → 所属 in_class assignment(A5 通道载体) */
  private async findInClassAssignment(meta: MetaState, questionId: number): Promise<number> {
    if (!Number.isInteger(questionId)) throw new ClsError('questionId 缺失');
    const list = await this.prisma.client.assignment.findMany({
      where: { lessonId: BigInt(meta.lesson_id), kind: 'in_class' },
      select: { id: true, paperId: true },
    });
    if (!list.length) throw new ClsError('本课未发布随堂练习');
    const pq = await this.prisma.client.paperQuestion.findFirst({
      where: { questionId: BigInt(questionId), paperId: { in: list.map((a) => a.paperId) } },
      select: { paperId: true },
    });
    if (!pq) throw new ClsError('题目不在本课随堂练习中');
    return num(list.find((a) => a.paperId === pq.paperId)!.id);
  }

  private async studentName(uid: number): Promise<string> {
    const u = await this.prisma.client.user.findFirst({
      where: { id: BigInt(uid) },
      select: { name: true },
    });
    return u?.name ?? '';
  }

  private async xadd(sid: number, type: string, studentId: number | null, payload: object): Promise<void> {
    await this.redis.xadd(
      kEvents(sid), '*',
      'type', type,
      'student_id', studentId != null ? String(studentId) : '',
      'payload', JSON.stringify(payload),
      'ts', String(Date.now()),
    );
  }

  private broadcast(sid: number, payload: ClassControl): void {
    this.nsp?.to(ROOM(sid)).emit('class:control', payload);
  }

  private emitTeacher(sid: number, event: string, payload: unknown): void {
    this.nsp?.to(TEACHER_ROOM(sid)).emit(event, payload);
  }

  /** 周期任务/结算的租户上下文(WS 无请求中间件,机制对齐 ContextMiddleware+runAsUser) */
  private runAsOrgSystem<T>(meta: { org_id?: string; teacher_id?: string }, fn: () => Promise<T>): Promise<T> {
    return runAsUser(
      { uid: Number(meta.teacher_id ?? 0), orgId: Number(meta.org_id), role: 'teacher' },
      fn,
    );
  }

  private async scanKeys(pattern: string): Promise<string[]> {
    let cursor = '0';
    const out: string[] = [];
    do {
      const [next, keys] = await this.redis.scan(cursor, 'MATCH', pattern, 'COUNT', 500);
      cursor = next;
      out.push(...keys);
    } while (cursor !== '0');
    return out;
  }

  /** 仅删本会话自己的键(共享 Redis,禁止 FLUSH*) */
  private async delSessionKeys(sid: number): Promise<void> {
    const keys = await this.scanKeys(kSessionPattern(sid));
    if (keys.length) await this.redis.del(...keys);
  }

  private parseJson<T>(s: string | null | undefined, fallback: T): T {
    if (!s) return fallback;
    try {
      return JSON.parse(s) as T;
    } catch {
      return fallback;
    }
  }
}
