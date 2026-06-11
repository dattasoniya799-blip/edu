import { randomBytes } from 'crypto';
import { mkdir, writeFile } from 'fs/promises';
import { dirname, resolve, sep } from 'path';
import type Redis from 'ioredis';
import { PresignedPut, StorageAdapter } from './storage.adapter';

/**
 * 本地磁盘模拟 OSS(MVP):
 * - presignPut 生成一次性 token(Redis,TTL=有效期),URL 指向 PUT /uploads/local/:token
 * - 上传端点消费 token(GETDEL 原子一次性)后把字节落盘到 UPLOAD_ROOT/ossKey
 */
export class LocalStorageAdapter implements StorageAdapter {
  constructor(
    private readonly redis: Redis,
    /** 上传根目录(.env UPLOAD_ROOT,默认 ./storage,已加 .gitignore) */
    private readonly root: string,
    /** 预签名 URL 的 base(.env UPLOAD_PUBLIC_BASE,默认本机) */
    private readonly publicBase: string,
  ) {}

  private key(token: string) {
    return `upload:token:${token}`;
  }

  async presignPut(ossKey: string, expiresSec: number): Promise<PresignedPut> {
    const token = randomBytes(24).toString('hex');
    await this.redis.set(this.key(token), ossKey, 'EX', expiresSec);
    return {
      uploadUrl: `${this.publicBase}/api/v1/uploads/local/${token}`,
      expiresAt: new Date(Date.now() + expiresSec * 1000),
    };
  }

  /** 一次性消费 token → ossKey;无效/过期/已用 → null */
  async consumeToken(token: string): Promise<string | null> {
    if (!/^[a-f0-9]{48}$/.test(token)) return null;
    return this.redis.getdel(this.key(token));
  }

  /** 字节落盘(防路径穿越:落点必须在 root 之内) */
  async saveObject(ossKey: string, body: Buffer): Promise<void> {
    const root = resolve(this.root);
    const target = resolve(root, ossKey);
    if (!target.startsWith(root + sep)) throw new Error(`非法 ossKey: ${ossKey}`);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, body);
  }
}
