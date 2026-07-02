/**
 * D2 · 生产初始化脚本(tools/init-prod.ts)验收:
 * - 脚本建「机构 + 管理员」→ 该管理员走真实登录路径(POST /auth/login)成功,哈希与运行时一致(argon2)
 * - 缺省密码 → 生成 16 位强随机密码并打印一次
 * - 防呆:同名机构 / 同手机号 → exit 2 拒绝,绝不追加
 * 自带夹具(唯一机构名 + 19900 号段手机号,afterAll 自清),不依赖演示 seed,可在空库/专属库跑。
 */
import { spawnSync } from 'child_process';
import * as path from 'path';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createApp, raw } from './fixtures/setup';

const SERVER_ROOT = path.resolve(__dirname, '..');
const ORG_NAME = `D2生产初始化验证机构-${process.pid}`;
const ADMIN_PHONE = '19900000077';
const ADMIN_PHONE_2 = '19900000078';
const PASSWORD = 'Prod@2026x';

function runInit(args: string[]) {
  return spawnSync('npx', ['tsx', 'tools/init-prod.ts', ...args], {
    cwd: SERVER_ROOT,
    env: process.env,
    encoding: 'utf8',
    timeout: 60_000,
  });
}

describe('生产初始化脚本(D2)', () => {
  let app: INestApplication;
  let http: any;

  beforeAll(async () => {
    app = await createApp();
    http = app.getHttpServer();
  });

  afterAll(async () => {
    const orgs = await raw.org.findMany({ where: { name: { startsWith: 'D2生产初始化验证机构-' } } });
    for (const o of orgs) {
      await raw.auditLog.deleteMany({ where: { orgId: o.id } });
      await raw.user.deleteMany({ where: { orgId: o.id } });
      await raw.org.delete({ where: { id: o.id } });
    }
    await raw.$disconnect();
    await app.close();
  });

  it('init:prod 建机构+管理员 → 管理员可走真实登录路径,哈希为 argon2', async () => {
    const r = runInit([
      '--org-name', ORG_NAME,
      '--admin-name', '王校长',
      '--admin-phone', ADMIN_PHONE,
      '--admin-password', PASSWORD,
    ]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('生产初始化完成');

    // 入库哈希与运行时一致(argon2,非 seed 的 scrypt$)
    const u = await raw.user.findFirst({ where: { phone: ADMIN_PHONE, role: 'admin', deletedAt: null } });
    expect(u).toBeTruthy();
    expect(u!.passwordHash!.startsWith('$argon2')).toBe(true);

    // 真实登录路径:POST /auth/login → 200,me 归属新机构
    const login = await request(http)
      .post('/api/v1/auth/login')
      .send({ phone: ADMIN_PHONE, password: PASSWORD })
      .expect(200);
    expect(login.body.code).toBe(0);
    expect(login.body.data.me.role).toBe('admin');
    expect(login.body.data.me.orgName).toBe(ORG_NAME);
    expect(login.body.data.accessToken).toBeTruthy();

    // 错误密码仍 401(排除“谁来都放行”式假绿)
    await request(http)
      .post('/api/v1/auth/login')
      .send({ phone: ADMIN_PHONE, password: 'Wrong@2026x' })
      .expect(401);
  });

  it('防呆:同名机构再跑 → exit 2 拒绝,不追加', async () => {
    const before = await raw.org.count({ where: { name: ORG_NAME } });
    const r = runInit([
      '--org-name', ORG_NAME,
      '--admin-name', '李校长',
      '--admin-phone', ADMIN_PHONE_2,
      '--admin-password', PASSWORD,
    ]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('已存在同名机构');
    expect(await raw.org.count({ where: { name: ORG_NAME } })).toBe(before);
  });

  it('防呆:同手机号(换机构名)再跑 → exit 2 拒绝', async () => {
    const r = runInit([
      '--org-name', `${ORG_NAME}-2`,
      '--admin-name', '李校长',
      '--admin-phone', ADMIN_PHONE,
      '--admin-password', PASSWORD,
    ]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('手机号已被占用');
    expect(await raw.org.count({ where: { name: `${ORG_NAME}-2` } })).toBe(0);
  });

  it('缺省 --admin-password → 生成 16 位强随机密码打印一次,可登录', async () => {
    const r = runInit([
      '--org-name', `${ORG_NAME}-gen`,
      '--admin-name', '赵校长',
      '--admin-phone', ADMIN_PHONE_2,
    ]);
    expect(r.status).toBe(0);
    const m = /初始密码.*: (\S+)\s*$/m.exec(r.stdout);
    expect(m).toBeTruthy();
    const generated = m![1];
    expect(generated.length).toBe(16);

    await request(http)
      .post('/api/v1/auth/login')
      .send({ phone: ADMIN_PHONE_2, password: generated })
      .expect(200);
  });

  it('弱密码(<8位 / 纯数字)→ exit 1 拒绝', async () => {
    const short = runInit([
      '--org-name', `${ORG_NAME}-w1`, '--admin-name', 'x', '--admin-phone', '19900000079',
      '--admin-password', 'Ab1x',
    ]);
    expect(short.status).toBe(1);
    expect(short.stderr).toContain('密码强度不足');

    const numeric = runInit([
      '--org-name', `${ORG_NAME}-w2`, '--admin-name', 'x', '--admin-phone', '19900000079',
      '--admin-password', '12345678',
    ]);
    expect(numeric.status).toBe(1);
    expect(numeric.stderr).toContain('纯数字');
    expect(await raw.user.count({ where: { phone: '19900000079' } })).toBe(0);
  });
});
