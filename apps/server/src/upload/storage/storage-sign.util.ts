import { createHmac, timingSafeEqual } from 'crypto';

/**
 * 本地存储对象的签名 GET URL(FIX4 · #2/#3):
 * - 机制与 A5 手写原稿签名 URL 完全一致:HMAC(`${ossKey}:${exp}`,JWT_SECRET)取前 32 位十六进制;
 * - URL 形如 `${base}/api/v1/storage/${ossKey}?exp=<ms>&sig=<hex32>`(与全局前缀 api/v1 对齐,
 *   同 A3 上传 / FIX1 课件回看端点的 publicBase 拼接口径);
 * - 下载端点(@Public GET /storage/*)用 verifyStorageSig 校验后从 UPLOAD_ROOT 流式回文件。
 * 生产切 OSS 时由 storage 适配器换真实签名 URL,字段形状不变。
 */

/** 签名有效期(毫秒)—— 同 A5 手写原稿 10 分钟口径 */
export const STORAGE_URL_TTL_MS = 600_000;

/** HMAC 签名(前 32 位十六进制),与 GradingService.signPhotoUrl 同算法/同 secret */
export function storageSig(secret: string, ossKey: string, exp: number): string {
  return createHmac('sha256', secret).update(`${ossKey}:${exp}`).digest('hex').slice(0, 32);
}

/** 生成签名 GET URL(供 #3 view-url 与 #2 grading 复用) */
export function signStorageUrl(
  base: string,
  secret: string,
  ossKey: string,
  ttlMs = STORAGE_URL_TTL_MS,
): string {
  const exp = Date.now() + ttlMs;
  const sig = storageSig(secret, ossKey, exp);
  return `${base}/api/v1/storage/${ossKey}?exp=${exp}&sig=${sig}`;
}

/** 校验签名 + 时效(过期或签名不匹配 → false;恒定时间比较防时序侧信道) */
export function verifyStorageSig(
  secret: string,
  ossKey: string,
  exp: number,
  sig: string,
): boolean {
  if (!Number.isFinite(exp) || exp < Date.now()) return false;
  if (!/^[0-9a-f]{32}$/.test(sig)) return false;
  const expected = storageSig(secret, ossKey, exp);
  return timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}
