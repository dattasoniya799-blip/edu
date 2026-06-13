/**
 * 验收覆盖(任务卡 A3 · 直传凭证):
 * - /uploads/sts 返回预签名 PUT URL(local 驱动 = 一次性 token 上传端点)
 * - PUT 直传字节落盘 UPLOAD_ROOT/ossKey,内容一致;token 一次性(复用 → 403)
 * - purpose 枚举校验(400);未登录 → 401;[*] 所有角色可签发(student 含)
 */
import { INestApplication } from '@nestjs/common';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import request from 'supertest';

// 在 import AppModule(createApp)之前固定上传根目录到临时目录,避免污染仓库
const UPLOAD_ROOT = mkdtempSync(join(tmpdir(), 'qiming-a3-upload-'));
process.env.UPLOAD_ROOT = UPLOAD_ROOT;

import { A3_PASSWORD, A3Fixture, createA3Org, dropA3Org } from './fixtures/a3.fixtures';
import { createApp, makeTicket, raw } from './fixtures/setup';

describe('直传凭证 /uploads/sts(A3)', () => {
  let app: INestApplication;
  let http: any;
  let fx: A3Fixture;
  let teacher: string;
  let student: string;

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  /** 预签名 URL 是绝对地址,e2e 不占固定端口 → 取 path 打到测试 server */
  const pathOf = (url: string) => {
    const u = new URL(url);
    return u.pathname + u.search;
  };

  beforeAll(async () => {
    app = await createApp();
    http = app.getHttpServer();
    fx = await createA3Org();
    const login = await request(http)
      .post('/api/v1/auth/login')
      .send({ phone: fx.teacherAPhone, password: A3_PASSWORD })
      .expect(200);
    teacher = login.body.data.accessToken;
    const ticket = await makeTicket(fx.orgId, fx.studentId);
    const ex = await request(http)
      .post('/api/v1/auth/student/qr-exchange')
      .send({ token: ticket, deviceFingerprint: 'a3-up-fp', deviceName: 'A3 测试平板' })
      .expect(200);
    student = ex.body.data.accessToken;
  });

  afterAll(async () => {
    await dropA3Org(fx.orgId);
    await raw.$disconnect();
    await app.close();
    rmSync(UPLOAD_ROOT, { recursive: true, force: true });
  });

  it('签发凭证 → PUT 直传 → 字节落盘一致;token 一次性(验收项)', async () => {
    const sts = await request(http)
      .post('/api/v1/uploads/sts')
      .set(auth(teacher))
      .send({ purpose: 'question_figure', fileName: '函数图象 1.PNG' })
      .expect(200);
    const { uploadUrl, ossKey, expiresAt } = sts.body.data;
    expect(ossKey).toMatch(new RegExp(`^question_figure/${Number(fx.orgId)}/\\d{6}/[a-f0-9]{24}\\.png$`));
    expect(new Date(expiresAt).getTime()).toBeGreaterThan(Date.now());
    expect(uploadUrl).toContain('/api/v1/uploads/local/');

    const bytes = Buffer.from('PNG-fake-bytes-\x00\x01\x02-鲸云AI教育平台', 'utf8');
    const put = await request(http)
      .put(pathOf(uploadUrl))
      .set('Content-Type', 'application/octet-stream')
      .send(bytes)
      .expect(200);
    expect(put.body.data).toMatchObject({ ossKey, size: bytes.length });

    // 落盘内容逐字节一致
    expect(readFileSync(resolve(UPLOAD_ROOT, ossKey))).toEqual(bytes);

    // 一次性:同一 token 再传 → 403
    await request(http)
      .put(pathOf(uploadUrl))
      .set('Content-Type', 'application/octet-stream')
      .send(bytes)
      .expect(403);
  });

  it('[*] 角色:student 可签发 answer_photo 凭证并上传', async () => {
    const sts = await request(http)
      .post('/api/v1/uploads/sts')
      .set(auth(student))
      .send({ purpose: 'answer_photo', fileName: 'IMG_0001.jpg' })
      .expect(200);
    expect(sts.body.data.ossKey).toMatch(/^answer_photo\//);
    const bytes = Buffer.from('jpeg-bytes');
    await request(http)
      .put(pathOf(sts.body.data.uploadUrl))
      .set('Content-Type', 'image/jpeg')
      .send(bytes)
      .expect(200);
    expect(readFileSync(resolve(UPLOAD_ROOT, sts.body.data.ossKey))).toEqual(bytes);
  });

  it('校验与鉴权:非法 purpose → 400;未登录 → 401;伪造 token → 403', async () => {
    await request(http)
      .post('/api/v1/uploads/sts')
      .set(auth(teacher))
      .send({ purpose: 'evil', fileName: 'x.png' })
      .expect(400);
    await request(http).post('/api/v1/uploads/sts').send({ purpose: 'resource', fileName: 'x.pdf' }).expect(401);
    await request(http)
      .put(`/api/v1/uploads/local/${'0'.repeat(48)}`)
      .set('Content-Type', 'application/octet-stream')
      .send(Buffer.from('x'))
      .expect(403);
  });
});
