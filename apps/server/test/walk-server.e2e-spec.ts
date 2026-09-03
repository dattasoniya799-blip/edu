/**
 * 2026-09-02 全面走查 · 服务端修复(task/walk-server)验收:
 * - D-1 停用即时生效:停用后已签发 access token 打 HTTP → 401「账号已停用」;课堂 WS 握手被拒;启用后旧 token 仍 401,重新登录 200
 * - D-4 教师停用后登录 → 403「账号已停用…」(不再是「账号或密码错误」);错密码仍 401
 * - H-1 学号归一:「 walk-s001 」可登录;管理端自定义学号落库大写
 * - D-6 在册人数 ≤ 100:第 101 人 → 409,不落库
 * - G-2 storage 回看按扩展名给 Content-Type(png → image/png,未知 → octet-stream)
 * - E-3 工作台最近动态为可读文案(含目标名)
 * - D-2 学习时段按机构时区判定(纯函数 + 登录门禁)
 * - F-1 含主观题的卷交卷后客观错题即时入账;出分后主观题补入且客观题不重复计数;错因回退知识点名
 * - F-5 出分后自动生成 correction 订正作业(只含答错的客观题,幂等)
 * 夹具:独立机构(13904 号段 / WALK-S 学号),afterAll 全量清理;跨租户 404 由既有套件覆盖,本套件用例均在自建机构内。
 */
import { INestApplication } from '@nestjs/common';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { io as ioc } from 'socket.io-client';
import { isWithinStudentHours, minutesOfDayIn } from '../src/common/student-hours';
import { COURSE_ROSTER_MAX } from '../src/admin/courses.service';
import { createWalkOrg, dropWalkOrg, WALK_PASSWORD, WalkFixture } from './fixtures/walk.fixtures';
import { createApp, raw } from './fixtures/setup';

describe('走查修复 · 服务端(停用即时吊销 / 登录文案 / 学号归一 / 人数上限 / MIME / 动态文案 / 时区 / 错题即时入账 / 订正作业)', () => {
  let app: INestApplication;
  let http: any;
  let port: number;
  let fx: WalkFixture;
  let adminAt: string;
  let teacherAt: string;

  const post = (url: string, at: string) => request(http).post(`/api/v1${url}`).set('Authorization', `Bearer ${at}`);
  const put = (url: string, at: string) => request(http).put(`/api/v1${url}`).set('Authorization', `Bearer ${at}`);
  const get = (url: string, at: string) => request(http).get(`/api/v1${url}`).set('Authorization', `Bearer ${at}`);
  const del = (url: string, at: string) => request(http).delete(`/api/v1${url}`).set('Authorization', `Bearer ${at}`);
  const login = (phone: string, password = WALK_PASSWORD) =>
    request(http).post('/api/v1/auth/login').send({ phone, password });
  const studentLogin = (studentNo: string, password = WALK_PASSWORD) =>
    request(http).post('/api/v1/auth/student/login').send({ studentNo, password });
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  beforeAll(async () => {
    app = await createApp();
    await app.listen(0);
    http = app.getHttpServer();
    port = (http.address() as AddressInfo).port;
    fx = await createWalkOrg();
    adminAt = (await login(fx.adminPhone).expect(200)).body.data.accessToken;
    teacherAt = (await login(fx.teacherPhone).expect(200)).body.data.accessToken;
  });

  afterAll(async () => {
    await dropWalkOrg(fx.orgId);
    await raw.$disconnect();
    await app.close();
  });

  // ================= D-1 / D-4:停用即时吊销 + 登录文案 =================
  it('D-1 教师停用:已签发 access token 立即 401「账号已停用」;启用后仍需重新登录;D-4 停用期间登录 → 403 已停用', async () => {
    const t0 = (await login(fx.teacherPhone).expect(200)).body.data.accessToken as string;
    await get('/me', t0).expect(200);
    await sleep(1100); // 与吊销 epoch 隔开一秒,排除同秒边界
    await del(`/admin/teachers/${fx.teacherId}`, adminAt).expect(200);
    const blocked = await get('/me', t0).expect(401);
    expect(blocked.body.message).toBe('账号已停用');
    await get('/teacher/courses', t0).expect(401);
    // 停用期间登录:密码正确 → 403 已停用(不是「账号或密码错误」);密码错误 → 401
    const dis = await login(fx.teacherPhone).expect(403);
    expect(dis.body.message).toContain('已停用');
    await login(fx.teacherPhone, 'wrong-pass').expect(401);
    // 启用:旧 token 仍 401(吊销位随 access TTL 过期;启用≠恢复旧凭证),重新登录 200
    await post(`/admin/teachers/${fx.teacherId}/enable`, adminAt).expect(200);
    await get('/me', t0).expect(401);
    teacherAt = (await login(fx.teacherPhone).expect(200)).body.data.accessToken;
    await get('/me', teacherAt).expect(200);
  });

  it('D-1 学生停用:HTTP 401 + 课堂 WS 握手被拒;启用后重新登录恢复', async () => {
    const s0 = (await studentLogin(fx.s2No).expect(200)).body.data.accessToken as string;
    await get('/student/today', s0).expect(200);
    await sleep(1100);
    await del(`/admin/students/${fx.s2Id}`, adminAt).expect(200);
    await get('/student/today', s0).expect(401);
    const wsErr = await new Promise<string>((resolve) => {
      const s = ioc(`http://127.0.0.1:${port}/classroom`, { auth: { token: s0 }, transports: ['websocket'], reconnection: false });
      s.on('connect', () => { s.close(); resolve('connected'); });
      s.on('connect_error', (e) => { s.close(); resolve(e.message); });
    });
    expect(wsErr).toBe('账号已停用');
    await post(`/admin/students/${fx.s2Id}/enable`, adminAt).expect(200);
    await get('/student/today', s0).expect(401);
    await studentLogin(fx.s2No).expect(200);
  });

  // ================= H-1:学号归一 =================
  it('H-1 学号 trim + 大写归一:「 walk-s001 」可登录;自定义学号落库为大写', async () => {
    await studentLogin(' walk-s001 ').expect(200);
    const created = await post('/admin/students', adminAt)
      .send({ name: 'WALK小写学号', studentNo: ' walk-s900 ', parentPhone: '13904000090', grade: '初二' })
      .expect(200);
    expect(created.body.data.studentNo).toBe('WALK-S900');
    await del(`/admin/students/${created.body.data.id}`, adminAt).expect(200);
  });

  // ================= D-6:在册人数上限 =================
  it(`D-6 课程在册人数上限 ${COURSE_ROSTER_MAX}:第 ${COURSE_ROSTER_MAX + 1} 人 → 409 且不落库;≤ 上限成功`, async () => {
    const course = await raw.course.create({
      data: { orgId: fx.orgId, name: 'WALK 大班', classType: 'group', subject: '数学', stage: '初中', teacherId: fx.teacherId, totalLessons: 1, status: 'ongoing' },
    });
    const many = await Promise.all(
      Array.from({ length: COURSE_ROSTER_MAX + 1 }, (_, i) =>
        raw.user.create({ data: { orgId: fx.orgId, role: 'student', name: `WALK批量${i}`, studentNo: `WALK-B${String(i).padStart(3, '0')}` } }),
      ),
    );
    const ids = many.map((u) => Number(u.id));
    const over = await post(`/admin/courses/${course.id}/students`, adminAt).send({ studentIds: ids }).expect(409);
    expect(over.body.message).toContain(`${COURSE_ROSTER_MAX}`);
    expect(await raw.courseStudent.count({ where: { courseId: course.id } })).toBe(0);
    await post(`/admin/courses/${course.id}/students`, adminAt).send({ studentIds: ids.slice(0, COURSE_ROSTER_MAX) }).expect(200);
    // 已满员再加 1 人 → 409;重复加已在册的人不算新增 → 200
    await post(`/admin/courses/${course.id}/students`, adminAt).send({ studentIds: [ids[COURSE_ROSTER_MAX]] }).expect(409);
    await post(`/admin/courses/${course.id}/students`, adminAt).send({ studentIds: [ids[0]] }).expect(200);
    expect(await raw.courseStudent.count({ where: { courseId: course.id, status: 'active' } })).toBe(COURSE_ROSTER_MAX);
  });

  // ================= G-2:storage MIME =================
  it('G-2 回看直链按扩展名给 Content-Type:png → image/png(+nosniff);未知扩展名 → octet-stream', async () => {
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');
    const sts = await post('/uploads/sts', teacherAt).send({ purpose: 'resource', fileName: 'walk.png', contentType: 'image/png', size: png.length }).expect(200);
    const uploadPath = String(sts.body.data.uploadUrl).replace(/^https?:\/\/[^/]+/, '');
    await request(http).put(uploadPath).set('Content-Type', 'image/png').send(png).expect(200);
    const view = await get(`/uploads/view-url?ossKey=${encodeURIComponent(sts.body.data.ossKey)}`, teacherAt).expect(200);
    const signedPath = String(view.body.data.url).replace(/^https?:\/\/[^/]+/, '');
    const file = await request(http).get(signedPath).expect(200);
    expect(file.headers['content-type']).toMatch(/^image\/png/);
    expect(file.headers['x-content-type-options']).toBe('nosniff');
    // 未知扩展名:同一文件按 .bin 上传
    const sts2 = await post('/uploads/sts', teacherAt).send({ purpose: 'resource', fileName: 'walk.bin', contentType: 'application/octet-stream', size: png.length }).expect(200);
    await request(http).put(String(sts2.body.data.uploadUrl).replace(/^https?:\/\/[^/]+/, '')).set('Content-Type', 'application/octet-stream').send(png).expect(200);
    const view2 = await get(`/uploads/view-url?ossKey=${encodeURIComponent(sts2.body.data.ossKey)}`, teacherAt).expect(200);
    const file2 = await request(http).get(String(view2.body.data.url).replace(/^https?:\/\/[^/]+/, '')).expect(200);
    expect(file2.headers['content-type']).toMatch(/^application\/octet-stream/);
    // html(单文件互动课件)内联,但必须带 CSP sandbox(浮空源),防直链打开后拿同源身份
    const html = Buffer.from('<!doctype html><title>walk</title><script>1</script>', 'utf8');
    const sts3 = await post('/uploads/sts', teacherAt).send({ purpose: 'resource', fileName: 'walk.html', contentType: 'text/html', size: html.length }).expect(200);
    await request(http).put(String(sts3.body.data.uploadUrl).replace(/^https?:\/\/[^/]+/, '')).set('Content-Type', 'text/html').send(html).expect(200);
    const view3 = await get(`/uploads/view-url?ossKey=${encodeURIComponent(sts3.body.data.ossKey)}`, teacherAt).expect(200);
    const file3 = await request(http).get(String(view3.body.data.url).replace(/^https?:\/\/[^/]+/, '')).expect(200);
    expect(file3.headers['content-type']).toMatch(/^text\/html/);
    expect(file3.headers['content-security-policy']).toBe('sandbox allow-scripts');
    expect(file3.headers['x-content-type-options']).toBe('nosniff');
  });

  // ================= E-3:工作台最近动态可读 =================
  it('E-3 工作台最近动态是可读文案(动作模板 + 目标名),不再是原始动作码', async () => {
    const created = await post('/admin/teachers', adminAt)
      .send({ name: 'WALK动态教师', phone: '13904000077', stage: '初中', subject: '数学' })
      .expect(200);
    const dash = await get('/admin/dashboard', adminAt).expect(200);
    const texts: string[] = dash.body.data.recentEvents.map((e: { text: string }) => e.text);
    expect(texts.some((t) => t.includes('新建了教师') && t.includes('WALK动态教师'))).toBe(true);
    expect(texts.every((t) => !/admin\.|auth\./.test(t))).toBe(true);
    await raw.user.delete({ where: { id: BigInt(created.body.data.id) } });
  });

  // ================= D-2:时区 =================
  it('D-2 学习时段按机构时区判定:同一 UTC 时刻在 Asia/Shanghai 与 UTC 判定不同;登录门禁按机构时区', async () => {
    // 2026-01-01T00:30Z = 上海 08:30 / UTC 00:30
    const now = new Date('2026-01-01T00:30:00Z');
    expect(minutesOfDayIn(now, 'Asia/Shanghai')).toBe(8 * 60 + 30);
    expect(minutesOfDayIn(now, 'UTC')).toBe(30);
    const window = { studentHours: { start: '06:00', end: '22:30' } };
    expect(isWithinStudentHours(window, now, 'Asia/Shanghai')).toBe(true);
    expect(isWithinStudentHours(window, now, 'UTC')).toBe(false);
    // 登录门禁:把窗口设成机构时区里「现在」之外的一小时 → 403 且文案带窗口;复原后 200
    const cur = minutesOfDayIn(new Date(), 'Asia/Shanghai');
    const hh = (m: number) => `${String(Math.floor(((m % 1440) + 1440) % 1440 / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    const start = (cur + 120) % 1440;
    const end = (cur + 180) % 1440;
    if (start < end) {
      await raw.org.update({ where: { id: fx.orgId }, data: { settings: { studentHours: { start: hh(start), end: hh(end) } } } });
      const blocked = await studentLogin(fx.s1No).expect(403);
      expect(blocked.body.message).toContain('休息时段');
    }
    await raw.org.update({ where: { id: fx.orgId }, data: { settings: { studentHours: { start: '00:00', end: '23:59' } } } });
    await studentLogin(fx.s1No).expect(200);
  });

  // ================= F-1 / F-5:错题即时入账 + 订正作业 =================
  it('F-1 含解答题的作业交卷后,答错的客观题立即进错题本(错因回退知识点名);出分后主观题补入且客观题不重复计数', async () => {
    const s1 = (await studentLogin(fx.s1No).expect(200)).body.data.accessToken as string;
    const started = await post('/student/attempts', s1).send({ assignmentId: fx.assignmentId }).expect(200);
    const attemptId = started.body.data.attemptId ?? started.body.data.id;
    await put(`/student/attempts/${attemptId}/answers/${fx.qSingleId}`, s1).send({ response: { choice: 'A' } }).expect(200); // 错
    await put(`/student/attempts/${attemptId}/answers/${fx.qBlankId}`, s1).send({ response: { texts: ['3'] } }).expect(200); // 错
    await put(`/student/attempts/${attemptId}/answers/${fx.qSolId}`, s1).send({ response: { text: '过程略' } }).expect(200);
    const submitted = await post(`/student/attempts/${attemptId}/submit`, s1).expect(200);
    expect(submitted.body.data.status).toBe('submitted'); // 含解答题 → 等复核

    const wbNow = await get('/student/wrong-book', s1).expect(200);
    expect(wbNow.body.data.total).toBe(2); // 客观错题已入账,不等 finalize
    const single = wbNow.body.data.items.find((i: { questionId: number }) => i.questionId === Number(fx.qSingleId));
    expect(single.errorTags).toEqual([fx.kpNodeName]); // 无 AI 错因 → 回退教材知识点名
    expect(single.wrongCount).toBe(1);

    // 教师复核解答题(未满分)→ finalize
    const pending = await get(`/grading/assignments/${fx.assignmentId}/answers?status=pending`, teacherAt).expect(200);
    expect(pending.body.data).toHaveLength(1);
    await put(`/grading/answers/${pending.body.data[0].answerId}/review`, teacherAt).send({ finalScore: 4, comment: '走查点评' }).expect(200);
    await post(`/grading/assignments/${fx.assignmentId}/finalize`, teacherAt).expect(200);

    const wbAfter = await get('/student/wrong-book', s1).expect(200);
    expect(wbAfter.body.data.total).toBe(3); // 解答题未满分补入
    const singleAfter = wbAfter.body.data.items.find((i: { questionId: number }) => i.questionId === Number(fx.qSingleId));
    expect(singleAfter.wrongCount).toBe(1); // 客观题没有被二次计数
    const att = await get(`/student/attempts/${attemptId}`, s1).expect(200);
    expect(att.body.data.status).toBe('graded');
    expect(att.body.data.score).toBe(4);
  });

  it('F-5 出分后自动生成 correction 订正作业:只含答错的客观题、target=本人、不计分、挂原讲次;重复 finalize 幂等', async () => {
    const s1 = (await studentLogin(fx.s1No).expect(200)).body.data.accessToken as string;
    const list = await get('/student/assignments?status=pending', s1).expect(200);
    const corrections = list.body.data.filter((a: { kind: string }) => a.kind === 'correction');
    expect(corrections).toHaveLength(1);
    const c = corrections[0];
    expect(c.lessonId).toBe(Number(fx.lessonId));
    expect(c.scoreCounted).toBe(false);
    expect(c.target).toEqual({ studentIds: [Number(fx.s1Id)] });
    expect(c.questionCount).toBe(2); // 单选 + 填空(解答题不进订正)
    const paper = await raw.paper.findUniqueOrThrow({ where: { id: BigInt(c.paperId) } });
    expect(paper.name).toBe('订正 · WALK 课后作业');
    // 幂等:再次 finalize 不会再生成一份
    await post(`/grading/assignments/${fx.assignmentId}/finalize`, teacherAt).expect(200);
    const again = await get('/student/assignments?status=pending', s1).expect(200);
    expect(again.body.data.filter((a: { kind: string }) => a.kind === 'correction')).toHaveLength(1);
    // 另一名未作答的学生没有订正作业
    const s2 = (await studentLogin(fx.s2No).expect(200)).body.data.accessToken as string;
    const list2 = await get('/student/assignments?status=pending', s2).expect(200);
    expect(list2.body.data.filter((a: { kind: string }) => a.kind === 'correction')).toHaveLength(0);
    // 教师作业总览能看到这份订正(teacherId 沿用来源作业)
    const ov = await get('/assignments?size=50', teacherAt).expect(200);
    expect(ov.body.data.some((a: { id: number }) => a.id === c.id)).toBe(true);
  });
});
