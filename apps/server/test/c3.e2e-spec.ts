/**
 * 验收覆盖(C3-back · 三项后端):
 * #A 知识点内容库:
 *   - PUT 内容包 upsert → GET 单个回读(join kpNodeName/resourceName/paperName)
 *   - 未维护知识点 GET → 空包(lecture/practice 为 null、summaryConfig {}),不 404
 *   - GET 列表按 graphId 列已维护内容包;缺省不改、显式 null 清空
 *   - Resource 带 kpNodeId 创建/更新(回填 kpNodeName)/清空;不存在节点 → 404
 *   - GET /kp/nodes 透出 content(DB 既有列)
 *   - [teacher] 门禁 + 跨租户 404
 * #B 发布即建课堂会话:
 *   - publish 讲次 → 存在 scheduled 会话;/student/today.sessionId 非 null
 *   - 重复 publish 不重复建会话(幂等);未发布 draft 讲次 → 无会话
 *   - 学生 class:join 该会话进入课堂(socket.io-client 烟测,scheduled→live)
 * #C 作业总览列表:
 *   - seed 第 3 讲作业进度对账(submitted/totalStudents/graded、status=finished)
 *   - 夹具:进行中(部分出分)→ ongoing;全部出分 → finished;status/lessonId 过滤
 *   - [teacher] 门禁;他师/跨租户不可见
 */
import { INestApplication } from '@nestjs/common';
import type { AddressInfo } from 'net';
import { io as ioc, Socket } from 'socket.io-client';
import request from 'supertest';
import type {
  AssignmentBriefDto,
  ClassSnapshot,
  KpContentPackDto,
  ResourceDto,
} from '@qiming/contracts';
import { C3_PASSWORD, C3Fixture, createC3Org, dropC3Org } from './fixtures/c3.fixtures';
import { createApp, createOrg2, dropOrg2, loginStudentById, Org2Fixture, raw } from './fixtures/setup';

const SEED_TEACHER = { phone: '13800000002', password: 'Teacher@123' };

const exactKeys = (obj: object, keys: string[]) =>
  expect(Object.keys(obj).sort()).toEqual([...keys].sort());

const PACK_KEYS = ['kpNodeId', 'kpNodeName', 'lectureResourceId', 'lectureResourceName', 'practicePaperId', 'practicePaperName', 'summaryConfig'];
const BRIEF_KEYS = ['id', 'paperName', 'lessonId', 'lessonTitle', 'kind', 'publishAt', 'dueAt', 'submitted', 'totalStudents', 'graded', 'status'];

describe('C3-back 三项后端', () => {
  let app: INestApplication;
  let http: any;
  let port: number;
  let fx: C3Fixture;
  let org2: Org2Fixture;
  let teacherA: string;
  let teacherB: string;
  let student1: string;
  let student2: string; // 同课程但不参与随堂练的学生(B3)
  let outsiderTeacher: string; // org2 教师(跨租户)
  let seedTeacher: string;

  const login = async (phone: string, password: string) => {
    const res = await request(http).post('/api/v1/auth/login').send({ phone, password }).expect(200);
    return res.body.data.accessToken as string;
  };
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  const connectClient = (token: string): Promise<Socket> =>
    new Promise((resolve, reject) => {
      const s = ioc(`http://127.0.0.1:${port}/classroom`, {
        auth: { token }, transports: ['websocket'], forceNew: true, reconnection: false, timeout: 5000,
      });
      s.on('connect', () => resolve(s));
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

  beforeAll(async () => {
    app = await createApp();
    await app.listen(0);
    http = app.getHttpServer();
    port = (http.address() as AddressInfo).port;
    fx = await createC3Org();
    org2 = await createOrg2();

    [teacherA, teacherB, outsiderTeacher, seedTeacher] = await Promise.all([
      login(fx.teacherAPhone, C3_PASSWORD),
      login(fx.teacherBPhone, C3_PASSWORD),
      login(org2.teacherPhone, org2.password),
      login(SEED_TEACHER.phone, SEED_TEACHER.password),
    ]);
    student1 = await loginStudentById(http, fx.s1Id);
    student2 = await loginStudentById(http, fx.s2Id);
  });

  afterAll(async () => {
    await dropC3Org(fx.orgId);
    await dropOrg2(org2.orgId);
    await app.close();
  });

  // ==================== #A 知识点内容库 ====================
  describe('#A 知识点内容库', () => {
    it('PUT 内容包 upsert → GET 单个回读(join 名称)', async () => {
      await request(http)
        .put(`/api/v1/knowledge/content-packs/${fx.kpNodeAId}`)
        .set(auth(teacherA))
        .send({ lectureResourceId: fx.resourceId, practicePaperId: fx.practicePaperId, summaryConfig: { points: ['k≠0', '图象为直线'] } })
        .expect(200);

      const got = await request(http).get(`/api/v1/knowledge/content-packs/${fx.kpNodeAId}`).set(auth(teacherA)).expect(200);
      const pack = got.body.data as KpContentPackDto;
      exactKeys(pack, PACK_KEYS);
      expect(pack.kpNodeId).toBe(fx.kpNodeAId);
      expect(pack.kpNodeName).toBe(fx.kpNodeAName);
      expect(pack.lectureResourceId).toBe(fx.resourceId);
      expect(pack.lectureResourceName).toBe('C3 · 一次函数讲解课件');
      expect(pack.practicePaperId).toBe(fx.practicePaperId);
      expect(pack.practicePaperName).toBe('C3 · 随堂练卷');
      expect(pack.summaryConfig).toEqual({ points: ['k≠0', '图象为直线'] });
    });

    it('upsert 缺省字段不改、显式 null 清空', async () => {
      // 只改 summaryConfig:lecture/practice 应保持不变
      await request(http).put(`/api/v1/knowledge/content-packs/${fx.kpNodeAId}`).set(auth(teacherA)).send({ summaryConfig: { v: 2 } }).expect(200);
      let pack = (await request(http).get(`/api/v1/knowledge/content-packs/${fx.kpNodeAId}`).set(auth(teacherA)).expect(200)).body.data as KpContentPackDto;
      expect(pack.lectureResourceId).toBe(fx.resourceId);
      expect(pack.summaryConfig).toEqual({ v: 2 });

      // 显式 null 清空 lectureResourceId
      await request(http).put(`/api/v1/knowledge/content-packs/${fx.kpNodeAId}`).set(auth(teacherA)).send({ lectureResourceId: null }).expect(200);
      pack = (await request(http).get(`/api/v1/knowledge/content-packs/${fx.kpNodeAId}`).set(auth(teacherA)).expect(200)).body.data as KpContentPackDto;
      expect(pack.lectureResourceId).toBeNull();
      expect(pack.lectureResourceName).toBeNull();
      expect(pack.practicePaperId).toBe(fx.practicePaperId); // 未触及,保持
    });

    it('未维护知识点 GET → 空包(不 404)', async () => {
      const got = await request(http).get(`/api/v1/knowledge/content-packs/${fx.kpNodeBId}`).set(auth(teacherA)).expect(200);
      const pack = got.body.data as KpContentPackDto;
      exactKeys(pack, PACK_KEYS);
      expect(pack.kpNodeId).toBe(fx.kpNodeBId);
      expect(pack.kpNodeName).toBe(fx.kpNodeBName);
      expect(pack.lectureResourceId).toBeNull();
      expect(pack.practicePaperId).toBeNull();
      expect(pack.summaryConfig).toEqual({});
    });

    it('GET 列表按 graphId 列已维护内容包', async () => {
      const res = await request(http).get('/api/v1/knowledge/content-packs').query({ graphId: fx.graphId }).set(auth(teacherA)).expect(200);
      const list = res.body.data as KpContentPackDto[];
      expect(list).toHaveLength(1); // 仅 kpNodeA 维护过
      expect(list[0].kpNodeId).toBe(fx.kpNodeAId);
      exactKeys(list[0], PACK_KEYS);
    });

    it('Resource 带 kpNodeId 创建 → 回填 kpNodeName;更新清空', async () => {
      const created = await request(http).post('/api/v1/resources').set(auth(teacherA))
        .send({ type: 'pdf', name: 'C3 · 归档课件', ossKey: `resource/${Number(fx.orgId)}/202606/a.pdf`, size: 10, kpNodeId: fx.kpNodeAId }).expect(200);
      const r = created.body.data as ResourceDto;
      expect(r.kpNodeId).toBe(fx.kpNodeAId);
      expect(r.kpNodeName).toBe(fx.kpNodeAName);

      // list 过滤 + 回读
      const listed = await request(http).get('/api/v1/resources').query({ kpNodeId: fx.kpNodeAId }).set(auth(teacherA)).expect(200);
      const items = listed.body.data.items as ResourceDto[];
      expect(items.every((x) => x.kpNodeId === fx.kpNodeAId)).toBe(true);
      expect(items.some((x) => x.id === r.id)).toBe(true);

      // 显式 null 清空归档
      await request(http).put(`/api/v1/resources/${r.id}`).set(auth(teacherA)).send({ kpNodeId: null }).expect(200);
      const after = await request(http).get('/api/v1/resources').set(auth(teacherA)).expect(200);
      const got = (after.body.data.items as ResourceDto[]).find((x) => x.id === r.id)!;
      expect(got.kpNodeId).toBeNull();
      expect(got.kpNodeName).toBeNull();
    });

    it('Resource / 内容包引用不存在知识点 → 404', async () => {
      await request(http).post('/api/v1/resources').set(auth(teacherA))
        .send({ type: 'pdf', name: 'x', ossKey: `resource/${Number(fx.orgId)}/202606/x.pdf`, size: 1, kpNodeId: 999999999 }).expect(404);
      await request(http).put(`/api/v1/knowledge/content-packs/999999999`).set(auth(teacherA)).send({ summaryConfig: {} }).expect(404);
    });

    it('GET /kp/nodes 透出 content', async () => {
      const res = await request(http).get('/api/v1/kp/nodes').query({ graphId: fx.graphId }).set(auth(teacherA)).expect(200);
      const nodeA = (res.body.data as { id: number; content: string | null }[]).find((n) => n.id === fx.kpNodeAId)!;
      expect(nodeA).toHaveProperty('content');
      expect(nodeA.content).toBe(fx.kpNodeAContent);
    });

    it('[teacher] 门禁 + 跨租户 404', async () => {
      await request(http).get(`/api/v1/knowledge/content-packs/${fx.kpNodeAId}`).set(auth(student1)).expect(403);
      // org2 教师访问 orgA 的知识点/图谱 → 404
      await request(http).get(`/api/v1/knowledge/content-packs/${fx.kpNodeAId}`).set(auth(outsiderTeacher)).expect(404);
      await request(http).get('/api/v1/knowledge/content-packs').query({ graphId: fx.graphId }).set(auth(outsiderTeacher)).expect(404);
      await request(http).put(`/api/v1/knowledge/content-packs/${fx.kpNodeAId}`).set(auth(outsiderTeacher)).send({ summaryConfig: {} }).expect(404);
    });
  });

  // ==================== #B 发布即建课堂会话 ====================
  describe('#B 发布即建课堂会话', () => {
    it('未发布 draft 讲次 → 无会话;今日讲次 publish 前 sessionId 为 null', async () => {
      expect(await raw.classSession.count({ where: { lessonId: fx.lessonDraftId } })).toBe(0);
      const today = await request(http).get('/api/v1/student/today').set(auth(student1)).expect(200);
      expect(today.body.data.todayLesson.lessonId).toBe(Number(fx.lessonTodayId));
      expect(today.body.data.todayLesson.sessionId).toBeNull();
    });

    it('publish 今日讲次 → 建 scheduled 会话;/student/today.sessionId 非 null', async () => {
      await request(http).post(`/api/v1/lessons/${fx.lessonTodayId}/publish`).set(auth(teacherA)).expect(200);
      const sessions = await raw.classSession.findMany({ where: { lessonId: fx.lessonTodayId } });
      expect(sessions).toHaveLength(1);
      expect(sessions[0].status).toBe('scheduled');
      // mode 取自 practice 编排:ai_guide→guideOnly、stuck_alert_min→stuckAlertMin
      expect(sessions[0].mode).toMatchObject({ guideOnly: true, stuckAlertMin: 4 });

      const today = await request(http).get('/api/v1/student/today').set(auth(student1)).expect(200);
      expect(today.body.data.todayLesson.sessionId).toBe(Number(sessions[0].id));
    });

    it('重复 publish 不重复建会话(幂等)', async () => {
      await request(http).post(`/api/v1/lessons/${fx.lessonTodayId}/publish`).set(auth(teacherA)).expect(200);
      expect(await raw.classSession.count({ where: { lessonId: fx.lessonTodayId } })).toBe(1);
    });

    it('学生 class:join 该会话进入课堂(scheduled→live)', async () => {
      const session = await raw.classSession.findFirstOrThrow({ where: { lessonId: fx.lessonTodayId } });
      const s = await connectClient(student1);
      try {
        const snap = await emitAck<ClassSnapshot>(s, 'class:join', { sessionId: Number(session.id) });
        expect(snap.session.id).toBe(Number(session.id));
        expect(snap.session.status).toBe('live');
      } finally {
        s.disconnect();
      }
    });
  });

  // ==================== #C 作业总览列表 ====================
  describe('#C 作业总览列表', () => {
    it('seed 第 3 讲作业:进度对账 + status=finished', async () => {
      // seed:t1 第3讲课后作业,12 学生全班 graded
      const seedCourse = await raw.course.findFirstOrThrow({ where: { name: '初二数学提高班' } });
      const seedLesson = await raw.lesson.findFirstOrThrow({ where: { courseId: seedCourse.id, seq: 3 } });
      const res = await request(http).get('/api/v1/assignments').query({ lessonId: Number(seedLesson.id) }).set(auth(seedTeacher)).expect(200);
      const list = res.body.data as AssignmentBriefDto[];
      expect(list).toHaveLength(1);
      const b = list[0];
      exactKeys(b, BRIEF_KEYS);
      const activeCount = await raw.courseStudent.count({ where: { courseId: seedCourse.id, status: 'active' } });
      const gradedCount = await raw.attempt.count({ where: { assignmentId: BigInt(b.id), status: 'graded' } });
      expect(b.totalStudents).toBe(activeCount);
      expect(b.submitted).toBe(gradedCount);
      expect(b.graded).toBe(gradedCount);
      expect(b.status).toBe('finished');
    });

    it('夹具:ongoing(部分出分)与 finished(全部出分)进度对账', async () => {
      const res = await request(http).get('/api/v1/assignments').query({ lessonId: Number(fx.lessonHwId) }).set(auth(teacherA)).expect(200);
      const list = res.body.data as AssignmentBriefDto[];
      const ongoing = list.find((b) => b.id === fx.assignmentOngoingId)!;
      const finished = list.find((b) => b.id === fx.assignmentFinishedId)!;
      expect(ongoing).toMatchObject({ submitted: 2, totalStudents: 2, graded: 1, status: 'ongoing', lessonTitle: 'C3 · 作业讲次' });
      expect(finished).toMatchObject({ submitted: 2, totalStudents: 2, graded: 2, status: 'finished' });
    });

    it('status 过滤', async () => {
      const ongoing = await request(http).get('/api/v1/assignments').query({ courseId: Number(fx.courseId), status: 'ongoing' }).set(auth(teacherA)).expect(200);
      expect((ongoing.body.data as AssignmentBriefDto[]).every((b) => b.status === 'ongoing')).toBe(true);
      expect((ongoing.body.data as AssignmentBriefDto[]).some((b) => b.id === fx.assignmentOngoingId)).toBe(true);

      const finished = await request(http).get('/api/v1/assignments').query({ courseId: Number(fx.courseId), status: 'finished' }).set(auth(teacherA)).expect(200);
      expect((finished.body.data as AssignmentBriefDto[]).every((b) => b.status === 'finished')).toBe(true);
      expect((finished.body.data as AssignmentBriefDto[]).some((b) => b.id === fx.assignmentFinishedId)).toBe(true);
    });

    it('[teacher] 门禁;他师/跨租户不可见', async () => {
      await request(http).get('/api/v1/assignments').set(auth(student1)).expect(403);
      // 教师乙无课程 → 看不到教师甲的作业
      const tb = await request(http).get('/api/v1/assignments').set(auth(teacherB)).expect(200);
      expect((tb.body.data as AssignmentBriefDto[]).some((b) => b.id === fx.assignmentOngoingId)).toBe(false);
      // org2 教师跨租户 → 看不到 orgA 作业
      const o2 = await request(http).get('/api/v1/assignments').set(auth(outsiderTeacher)).expect(200);
      expect((o2.body.data as AssignmentBriefDto[]).some((b) => b.id === fx.assignmentOngoingId)).toBe(false);
    });
  });

  // ==================== #D FIXB 课堂修复(B5 伪流式 / B2 错题入账 / B3 随堂练待办) ====================
  describe('#D FIXB 课堂修复(B2/B3/B5)', () => {
    // 收集某 requestId 的全部 class:ai_chunk 分片
    const collectChunks = (s: Socket, want = 12000): Promise<{ delta: string; done: boolean }[]> =>
      new Promise((resolve, reject) => {
        const frames: { requestId: string; delta: string; done: boolean }[] = [];
        const timer = setTimeout(() => reject(new Error('ai_chunk 流未在超时内 done')), want);
        s.on('class:ai_chunk', (f: { requestId: string; delta: string; done: boolean }) => {
          frames.push(f);
          if (f.done) {
            clearTimeout(timer);
            resolve(frames.map(({ delta, done }) => ({ delta, done })));
          }
        });
      });

    const sessionId = async () =>
      Number((await raw.classSession.findFirstOrThrow({ where: { lessonId: fx.lessonTodayId } })).id);
    const practiceQIds = async () =>
      (
        await raw.paperQuestion.findMany({
          where: { paperId: BigInt(fx.practicePaperId) },
          orderBy: { seq: 'asc' },
          select: { questionId: true },
        })
      ).map((r) => Number(r.questionId));

    it('B5:class:ai_ask → 先收占位空首帧(done=false)再续发分片,末帧 done=true,拼接=全文', async () => {
      const sid = await sessionId();
      const s = await connectClient(student1);
      try {
        await emitAck<ClassSnapshot>(s, 'class:join', { sessionId: sid });
        const [qid] = await practiceQIds();
        const chunksP = collectChunks(s);
        // class:ai_ask 处理器返回 void → 网关不回 ack(仅非 undefined 才 ack),故直接 emit,
        // 以 class:ai_chunk 的 done 帧作为完成信号(collectChunks)。
        s.emit('class:ai_ask', { questionId: qid, message: '这道题第一步怎么想?' });
        const frames = await chunksP;
        // 占位首帧:delta 为空、done=false(2-20s 等待期即时反馈,事件名/负载形状不变)
        expect(frames[0]).toEqual({ delta: '', done: false });
        // 末帧 done=true
        expect(frames[frames.length - 1].done).toBe(true);
        // 拼接全部 delta = 完整回复(非空);中间帧 done 均为 false
        const full = frames.map((f) => f.delta).join('');
        expect(full.length).toBeGreaterThan(0);
        expect(frames.slice(0, -1).every((f) => f.done === false)).toBe(true);
      } finally {
        s.disconnect();
      }
    });

    it('B2+B3:课中答错客观题 → 懒建随堂练不入未参与学生待办 → settle 后入错题本、attempt 终态非 in_progress', async () => {
      const sid = await sessionId();
      const [q1] = await practiceQIds();
      const q1Correct = ((await raw.question.findFirstOrThrow({ where: { id: BigInt(q1) } })).answer as { choice: string }).choice; // 'B'
      const wrong = q1Correct === 'A' ? 'B' : 'A';

      // --- 学生一课中答错 q1(单选)→ 懒建 in_class assignment + in_progress attempt ---
      const s1 = await connectClient(student1);
      try {
        await emitAck<ClassSnapshot>(s1, 'class:join', { sessionId: sid });
        const r = await emitAck<{ judged: boolean; isCorrect: boolean }>(s1, 'class:answer', {
          questionId: q1,
          response: { choice: wrong },
        });
        expect(r.judged).toBe(true);
        expect(r.isCorrect).toBe(false);
      } finally {
        s1.disconnect();
      }

      // 懒建的 in_class assignment(整班 target)
      const inClass = await raw.assignment.findFirstOrThrow({
        where: { lessonId: fx.lessonTodayId, kind: 'in_class', paperId: BigInt(fx.practicePaperId) },
      });
      const s1Attempt = await raw.attempt.findFirstOrThrow({
        where: { assignmentId: inClass.id, studentId: fx.s1Id },
      });
      expect(s1Attempt.status).toBe('in_progress'); // settle 前仍挂 in_progress(复现断裂前置)

      // --- B3:未参与的学生二 pending / 今日任务都不含该随堂练 ---
      const s2Pending = await request(http)
        .get('/api/v1/student/assignments')
        .query({ status: 'pending' })
        .set(auth(student2))
        .expect(200);
      expect((s2Pending.body.data as { id: number; kind: string }[]).some((a) => a.id === Number(inClass.id))).toBe(false);
      expect((s2Pending.body.data as { kind: string }[]).some((a) => a.kind === 'in_class')).toBe(false);
      const s2Today = await request(http).get('/api/v1/student/today').set(auth(student2)).expect(200);
      expect((s2Today.body.data.tasks as { assignmentId: number }[]).some((t) => t.assignmentId === Number(inClass.id))).toBe(false);

      // 错题本入账前基线
      const beforeWrong = await raw.wrongBookEntry.count({
        where: { studentId: fx.s1Id, questionId: BigInt(q1) },
      });

      // --- 教师 end 结算课堂 → settleInClassAttempts ---
      const t = await connectClient(teacherA);
      try {
        await emitAck<ClassSnapshot>(t, 'class:join', { sessionId: sid });
        // class:control 处理器返回 void → 网关不回 ack;直接 emit 后轮询 attempt 终态判定结算完成。
        t.emit('class:control', { action: 'end' });
      } finally {
        // 等结算落库(attempt 脱离 in_progress)后再断开;最长轮询 ~8s
        let settled = await raw.attempt.findFirstOrThrow({ where: { id: s1Attempt.id } });
        for (let i = 0; i < 80 && settled.status === 'in_progress'; i++) {
          await new Promise((r) => setTimeout(r, 100));
          settled = await raw.attempt.findFirstOrThrow({ where: { id: s1Attempt.id } });
        }
        t.disconnect();
      }

      // --- B2 断言:attempt 终态非 in_progress(graded);客观错题入错题本 ---
      const settled = await raw.attempt.findFirstOrThrow({ where: { id: s1Attempt.id } });
      expect(settled.status).not.toBe('in_progress');
      expect(settled.status).toBe('graded');
      const afterWrong = await raw.wrongBookEntry.count({
        where: { studentId: fx.s1Id, questionId: BigInt(q1), status: 'open' },
      });
      expect(afterWrong).toBe(beforeWrong + 1); // 答错客观题 → 恰好一条错题入账(wrongBookAdded 与真实入账一致)
    });
  });
});
