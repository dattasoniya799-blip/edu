/**
 * D2 · 生产初始化脚本(真实上线用,替代演示 seed)
 * 用法:
 *   DATABASE_URL=postgresql://... npm run init:prod -- \
 *     --org-name 某某教育 --admin-name 王校长 --admin-phone 13900000001 [--admin-password 'Xxx@2026']
 * 行为: 仅创建 1 个机构 + 该机构 1 个管理员账号,不造任何演示数据。
 *   --admin-password 缺省时生成 16 位强随机密码,仅在 stdout 打印一次,请立即保存并尽快登录修改。
 * 防呆(教训:演示 seed 非幂等,重复跑追加同名机构导致手机号登录串号):
 *   - 必须显式设置 DATABASE_URL(不默认写 dev 库);
 *   - 同名机构或同手机号用户(未删除)已存在 → 打印已存在记录并报错退出,绝不追加。
 * 密码哈希: 直接复用运行时 src/auth/password.util.ts 的 hashPassword(argon2id),
 *   与 AuthService.login 的 verifyPassword 完全一致,杜绝算法/格式漂移。
 */
import 'dotenv/config';
import { randomBytes } from 'crypto';
import { Client } from 'pg';
import { hashPassword } from '../src/auth/password.util';

function arg(name: string, required = true): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')) return process.argv[i + 1];
  if (!required) return undefined;
  console.error(`缺少参数 --${name}`);
  console.error(
    '用法: npm run init:prod -- --org-name <机构名> --admin-name <管理员姓名> --admin-phone <手机号> [--admin-password <密码>]',
  );
  process.exit(1);
}

/** 口径:与现有系统一致的下限(ChangePasswordDto @MinLength(8)),另拒纯数字弱密码 */
function checkPasswordStrength(pwd: string): string | null {
  if (pwd.length < 8) return '密码长度须 ≥ 8 位';
  if (/^\d+$/.test(pwd)) return '密码不能为纯数字';
  return null;
}

/** 16 位强随机密码:保证含小写/大写/数字(必过强度校验) */
function generatePassword(len = 16): string {
  const alphabet = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#%*';
  for (;;) {
    const buf = randomBytes(len);
    let out = '';
    for (let i = 0; i < len; i++) out += alphabet[buf[i] % alphabet.length];
    if (/[a-z]/.test(out) && /[A-Z]/.test(out) && /[0-9]/.test(out)) return out;
  }
}

async function main() {
  const DB = process.env.DATABASE_URL;
  if (!DB) {
    console.error('必须显式设置 DATABASE_URL(生产初始化拒绝默认连接开发库)');
    process.exit(1);
  }

  const orgName = arg('org-name')!.trim();
  const adminName = arg('admin-name')!.trim();
  const adminPhone = arg('admin-phone')!.trim();
  let password = arg('admin-password', false);
  const generated = !password;
  if (!orgName || !adminName || !adminPhone) {
    console.error('--org-name / --admin-name / --admin-phone 不能为空');
    process.exit(1);
  }
  if (!/^\d{5,20}$/.test(adminPhone)) {
    console.error(`--admin-phone 须为 5~20 位数字,收到: ${adminPhone}`);
    process.exit(1);
  }
  if (!password) password = generatePassword();
  const weak = checkPasswordStrength(password);
  if (weak) {
    console.error(`密码强度不足: ${weak}`);
    process.exit(1);
  }

  const client = new Client({ connectionString: DB });
  await client.connect();
  try {
    // ---------- 防呆:存在即拒绝 ----------
    const dupOrg = await client.query(
      `SELECT id, name, status, created_at FROM orgs WHERE name = $1`, [orgName]);
    if (dupOrg.rowCount! > 0) {
      const o = dupOrg.rows[0];
      console.error(`已存在同名机构,拒绝重复初始化(绝不追加):`);
      console.error(`  org id=${o.id} name=${o.name} status=${o.status} created_at=${o.created_at.toISOString()}`);
      process.exit(2);
    }
    const dupUser = await client.query(
      `SELECT id, org_id, role, name, phone FROM users WHERE phone = $1 AND deleted_at IS NULL`, [adminPhone]);
    if (dupUser.rowCount! > 0) {
      console.error(`手机号已被占用,拒绝创建(登录按手机号全局查找,重复会串号):`);
      for (const u of dupUser.rows)
        console.error(`  user id=${u.id} org_id=${u.org_id} role=${u.role} name=${u.name} phone=${u.phone}`);
      process.exit(2);
    }

    // ---------- 创建机构 + 管理员(事务) ----------
    const passwordHash = await hashPassword(password); // 运行时同款 argon2id
    await client.query('BEGIN');
    const org = await client.query(
      `INSERT INTO orgs(name, settings) VALUES ($1, $2) RETURNING id`,
      [orgName, JSON.stringify({
        ai: { qaGuideOnly: true, preGrading: true },
        studentHours: { start: '06:00', end: '22:30' },
        deviceBinding: true,
      })]);
    const orgId = org.rows[0].id;
    const admin = await client.query(
      `INSERT INTO users(org_id, role, name, phone, password_hash, teacher_no)
       VALUES ($1, 'admin', $2, $3, $4, 'A-0001') RETURNING id`,
      [orgId, adminName, adminPhone, passwordHash]);
    await client.query('COMMIT');

    console.log(`✓ 生产初始化完成`);
    console.log(`  机构:   id=${orgId} name=${orgName}`);
    console.log(`  管理员: id=${admin.rows[0].id} name=${adminName} phone=${adminPhone}`);
    if (generated) {
      console.log(`  初始密码(随机生成,仅此一次打印,请立即保存并登录后尽快修改): ${password}`);
    } else {
      console.log(`  密码:   使用 --admin-password 传入的密码(建议登录后修改)`);
    }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    console.error('初始化失败,已回滚:', err);
    process.exit(3);
  } finally {
    await client.end();
  }
}
main();
