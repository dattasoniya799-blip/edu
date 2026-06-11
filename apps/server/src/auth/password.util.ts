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
