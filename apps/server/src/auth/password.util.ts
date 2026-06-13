import * as argon2 from 'argon2';
import { randomBytes, scryptSync, timingSafeEqual } from 'crypto';

/**
 * 密码哈希:统一 argon2id;兼容 seed 的开发态 scrypt 哈希(scrypt$salt$hex),
 * 校验通过后由调用方静默升级为 argon2(needsUpgrade=true)。
 */
export async function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, { type: argon2.argon2id });
}

export async function verifyPassword(
  plain: string,
  stored: string,
): Promise<{ ok: boolean; needsUpgrade: boolean }> {
  if (stored.startsWith('scrypt$')) {
    const [, salt, hex] = stored.split('$');
    const expect = Buffer.from(hex, 'hex');
    const got = scryptSync(plain, salt, expect.length);
    const ok = expect.length === got.length && timingSafeEqual(expect, got);
    return { ok, needsUpgrade: ok };
  }
  try {
    return { ok: await argon2.verify(stored, plain), needsUpgrade: false };
  } catch {
    return { ok: false, needsUpgrade: false };
  }
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('hex');
}

/**
 * 生成易读的明文临时密码(默认 8 位):剔除易混淆字符(0/O/1/l/I),
 * 用于学生初始密码与管理员重置密码,管理员当面/短信告知学生本人。
 */
export function randomReadablePassword(len = 8): string {
  const alphabet = 'abcdefghijkmnpqrstuvwxyzACDEFGHJKLMNPQRSTUVWXY23456789';
  const buf = randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) out += alphabet[buf[i] % alphabet.length];
  return out;
}
