/**
 * FIX4-back 验收(一轮代码审查发现的真实后端问题,六项):
 * #1 课程时间线补 sessionId:已发布(有未结束会话)讲 sessionId 非 null,草稿讲 null;
 * #2 批改图 /storage 路由:签名 GET URL 能取到文件(字节一致),错签名/过期/路径穿越 → 拒绝;
 * #3 题图同存储缺口:GET /uploads/view-url?ossKey= 返回签名 URL,前端据此换可展示地址;
 * #4 作业一致性:挂 A 课讲次发给 B 课学生 / B 课 → 400;讲次属目标课程 → 200;
 * #5 今日讲次看 status:当天早草稿 + 晚已发布 → today 取已发布那条;
 * #6 重复标签 [x,x]:去重后正常建题,不再触发唯一约束 500。
 * 夹具:13911 号段自建自清(test/fixtures/fix4.fixtures.ts);seed 只读。
 */
import { INestApplication } from '@nestjs/common';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import request from 'supertest';

// createApp 前固定上传根目录到临时目录(同 A3/FIX1 模式),避免污染仓库
const UPLOAD_ROOT = mkdtempSync(join(tmpdir(), 'qiming-fix4-storage-'));
process.env.UPLOAD_ROOT = UPLOAD_ROOT;

import { storageSig } from '../src/upload/storage/storage-sign.util';
import { FIX4_PASSWORD, Fix4Fixture, createFix4Org, dropFix4Org } from './fixtures/fix4.fixtures';
import { createApp, loginStudentById, raw } from './fixtures/setup';

const SECRET = process.env.JWT_SECRET ?? 'dev-secret-change-me';

describe('FIX4-back · 代码审查修复六项', () => {
  let app: INestApplication;
  let http: any;
  let fx: Fix4Fixture;
  let s1: string;
  let teacher: string;

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const get = (url: string, token: string) => request(http).get(`/api/v1${url}`).set(auth(token));
  const login = async (phone: string, password: string) => {
    const res = await request(http).post('/api/v1/auth/login').send({ phone, password }).expect(200);
    return res.body.data.accessToken as string;
  };
  const pathOf = (url: string) => {
    const u = new URL(url);
    return u.pathname + u.search;
  };

  // REV-back #4:view-url 加归属校验后,ossKey 必须形如 `${purpose}/${orgId}/...` 且属本机构
  let PHOTO_OSS_KEY: string;
  const PHOTO_CONTENT = 'FIX4 手写原稿字节样本 0123456789 αβγ';

  beforeAll(async () => {
    app = await createApp();
    http = app.getHttpServer();
    fx = await createFix4Org();
    PHOTO_OSS_KEY = `answer_photo/${Number(fx.orgId)}/202506/fix4photo.jpg`;
    // 落盘一个对象,模拟上传完成
    const target = join(UPLOAD_ROOT, PHOTO_OSS_KEY);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, PHOTO_CONTENT);

    s1 = await loginStudentById(http, fx.s1Id);
    teacher = await login(fx.teacherPhone, FIX4_PASSWORD);
  });

  afterAll(async () => {
    await app.close();
    await dropFix4Org(fx.orgId);
    await raw.$disconnect();
    rmSync(UPLOAD_ROOT, { recursive: true, force: true });
  });

  // ===================== #1 时间线 sessionId =====================
  it('#1 时间线:已发布(有未结束会话)讲 sessionId 非 null,草稿讲 null', async () => {
    const res = await get(`/student/courses/${fx.courseAId}/lessons`, s1).expect(200);
    const data = res.body.data;
    expect(data.map((x: any) => x.lesson.seq)).toEqual([1, 2]);
    // 每项含 sessionId 字段(契约新形状)
    for (const item of data) expect(item).toHaveProperty('sessionId');
    expect(data[0].sessionId).toBeNull(); // L_early:draft 无会话
    expect(data[1].sessionId).toBe(Number(fx.sessionId)); // L_late:ready + scheduled session
  });

  // ===================== #2 /storage 签名下载 =====================
  it('#2 /storage:签名 URL 取回文件字节一致;错签名/过期/路径穿越 → 拒绝', async () => {
    // 经 #3 view-url 取得合法签名 URL(也即前端拿 ossKey 换地址的真实路径)
    const vu = await get(`/uploads/view-url?ossKey=${encodeURIComponent(PHOTO_OSS_KEY)}`, teacher).expect(200);
    const url = vu.body.data.url as string;
    expect(new URL(url).pathname).toBe(`/api/v1/storage/${PHOTO_OSS_KEY}`);

    const dl = await request(http).get(pathOf(url)).expect(200);
    expect(dl.headers['content-type']).toContain('application/octet-stream');
    expect(Buffer.from(dl.body).toString('utf8')).toBe(PHOTO_CONTENT);

    // 错签名 → 403
    const u = new URL(url);
    const goodSig = u.searchParams.get('sig')!;
    const badSig = (goodSig[0] === 'a' ? 'b' : 'a') + goodSig.slice(1);
    await request(http)
      .get(`/api/v1/storage/${PHOTO_OSS_KEY}?exp=${u.searchParams.get('exp')}&sig=${badSig}`)
      .expect(403);

    // 过期(exp 在过去,签名正确)→ 403
    const expPast = Date.now() - 1000;
    const sigPast = storageSig(SECRET, PHOTO_OSS_KEY, expPast);
    await request(http)
      .get(`/api/v1/storage/${PHOTO_OSS_KEY}?exp=${expPast}&sig=${sigPast}`)
      .expect(403);

    // 路径穿越(签名合法但解析越出 UPLOAD_ROOT)→ 403
    const evilKey = '../../../../etc/hosts';
    const exp = Date.now() + 600_000;
    const evilSig = storageSig(SECRET, evilKey, exp);
    await request(http)
      .get(`/api/v1/storage/${encodeURIComponent(evilKey)}?exp=${exp}&sig=${evilSig}`)
      .expect(403);

    // 文件不存在(签名合法)→ 404
    const missKey = 'fix4/answers/missing.jpg';
    const missSig = storageSig(SECRET, missKey, exp);
    await request(http)
      .get(`/api/v1/storage/${missKey}?exp=${exp}&sig=${missSig}`)
      .expect(404);
  });

  // ===================== #3 view-url 端点 =====================
  it('#3 view-url:本机构 ossKey 返回签名 URL;跨租户/非法 purpose → 403;缺 ossKey / 路径穿越 → 400;未登录 → 401', async () => {
    const ok = await get(`/uploads/view-url?ossKey=${encodeURIComponent(PHOTO_OSS_KEY)}`, teacher).expect(200);
    expect(ok.body.data).toEqual({ url: expect.stringContaining(`/api/v1/storage/${PHOTO_OSS_KEY}?exp=`) });
    // 学生也可换(figures 展示是学生侧需求),但仅限本机构前缀
    await get(`/uploads/view-url?ossKey=${encodeURIComponent(PHOTO_OSS_KEY)}`, s1).expect(200);
    // REV-back #4:他机构前缀 / 非法 purpose → 403(杜绝凭任意 ossKey 越权换签名 URL)
    await get(`/uploads/view-url?ossKey=${encodeURIComponent(`answer_photo/${Number(fx.orgId) + 1}/202506/x.jpg`)}`, teacher).expect(403);
    await get(`/uploads/view-url?ossKey=${encodeURIComponent('fix4/answers/photo.jpg')}`, teacher).expect(403);
    await get('/uploads/view-url', teacher).expect(400); // 缺 ossKey
    await get('/uploads/view-url?ossKey=a/../b', teacher).expect(400); // 含穿越
    await request(http).get(`/api/v1/uploads/view-url?ossKey=${PHOTO_OSS_KEY}`).expect(401); // 未登录
  });

  // ===================== #4 作业一致性 =====================
  it('#4 作业一致性:A 课讲次发给 B 课学生 / B 课 → 400;讲次属目标课程 → 200', async () => {
    const mk = (target: object) => ({ paperId: Number(fx.paperId), lessonId: Number(fx.lessonLateId), kind: 'homework', target });

    // A 课讲次 + B 课学生 sB → 400
    await request(http).post('/api/v1/assignments').set(auth(teacher)).send(mk({ studentIds: [Number(fx.sBId)] })).expect(400);
    // A 课讲次 + 目标课程 = B 课 → 400
    await request(http).post('/api/v1/assignments').set(auth(teacher)).send(mk({ courseId: Number(fx.courseBId) })).expect(400);

    // 一致:A 课讲次 + 目标课程 = A 课 → 200
    const okCourse = await request(http).post('/api/v1/assignments').set(auth(teacher)).send(mk({ courseId: Number(fx.courseAId) })).expect(200);
    expect(okCourse.body.data.lessonId).toBe(Number(fx.lessonLateId));
    // 一致:A 课讲次 + 在册学生 s1 → 200
    await request(http).post('/api/v1/assignments').set(auth(teacher)).send(mk({ studentIds: [Number(fx.s1Id)] })).expect(200);
  });

  // ===================== #5 今日讲次看 status =====================
  it('#5 today:当天早草稿 + 晚已发布 → 取已发布那条(L_late)', async () => {
    const res = await get('/student/today', s1).expect(200);
    expect(res.body.data.todayLesson.lessonId).toBe(Number(fx.lessonLateId));
    expect(res.body.data.todayLesson.sessionId).toBe(Number(fx.sessionId));
  });

  // ===================== #6 重复标签去重 =====================
  it('#6 重复标签 tagNodeIds=[x,x]:去重后正常建题,不 500;落库仅 1 条 tag', async () => {
    const res = await request(http)
      .post('/api/v1/questions')
      .set(auth(teacher))
      .send({
        type: 'blank',
        stage: '初中',
        subject: '数学',
        stemLatex: 'FIX4 填空:一次函数解析式为 ____',
        answer: { texts: ['y=2x+1'] },
        tagNodeIds: [Number(fx.curriculumNodeId), Number(fx.curriculumNodeId)],
      })
      .expect(200);
    expect(res.body.data.tags).toHaveLength(1);
    expect(res.body.data.tags[0].nodeId).toBe(Number(fx.curriculumNodeId));
    // 落库去重核验
    const cnt = await raw.questionTag.count({ where: { questionId: BigInt(res.body.data.id) } });
    expect(cnt).toBe(1);
  });
});
