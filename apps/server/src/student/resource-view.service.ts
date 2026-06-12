import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import { readFile } from 'fs/promises';
import { resolve, sep } from 'path';
import type Redis from 'ioredis';
import { REDIS } from '../redis/redis.module';

/**
 * 课件回看签名 URL(FIX1):机制与 A3 storage 适配器(src/upload/storage/)完全对称——
 * - A3 local 驱动的"预签名 PUT" = 一次性 token(Redis,TTL)+ @Public 上传端点 PUT /uploads/local/:token;
 * - 本服务的"预签名 GET" = 一次性 token(Redis,TTL)+ @Public 下载端点 GET /student/resources/local/:token。
 * A3 的 local 驱动没有 GET 下载端点(A5 报告提过此缺口),且 UploadModule 未 export
 * STORAGE_ADAPTER(纪律:不改他人模块),故下载侧在本模块内按同口径补齐;
 * 生产切 OSS(STORAGE_DRIVER=oss)时此处换真实 GET 签名,响应字段形状不变(同 A3 占位策略)。
 * 环境变量与 A3 完全复用:STORAGE_DRIVER / UPLOAD_ROOT / UPLOAD_PUBLIC_BASE(默认值一致)。
 */

/** 回看凭证有效期(秒)—— 同 A5 手写原稿签名 URL 的 10 分钟口径 */
export const VIEW_TTL_SEC = 600;

export interface PresignedGet {
  /** 客户端回看用的 GET URL */
  url: string;
  /** 凭证过期时间 */
  expiresAt: Date;
}

@Injectable()
export class ResourceViewService {
  private readonly driver: string;
  private readonly root: string;
  private readonly publicBase: string;

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    cfg: ConfigService,
  ) {
    this.driver = cfg.get<string>('STORAGE_DRIVER', 'local');
    this.root = cfg.get<string>('UPLOAD_ROOT', './storage');
    this.publicBase = cfg.get<string>(
      'UPLOAD_PUBLIC_BASE',
      `http://127.0.0.1:${cfg.get('PORT', '3000')}`,
    );
  }

  private key(token: string) {
    return `view:token:${token}`;
  }

  /** 为 ossKey 签发一次性 GET 凭证(形状对称 A3 StorageAdapter.presignPut) */
  async presignGet(ossKey: string, expiresSec: number): Promise<PresignedGet> {
    if (this.driver !== 'local')
      throw new Error('OSS 驱动的回看签名尚未实现(生产接阿里云 STS);MVP 请配置 STORAGE_DRIVER=local');
    const token = randomBytes(24).toString('hex');
    await this.redis.set(this.key(token), ossKey, 'EX', expiresSec);
    return {
      url: `${this.publicBase}/api/v1/student/resources/local/${token}`,
      expiresAt: new Date(Date.now() + expiresSec * 1000),
    };
  }

  /** 一次性消费 token → ossKey;无效/过期/已用 → null(GETDEL 原子,同 A3 上传 token) */
  async consumeToken(token: string): Promise<string | null> {
    if (!/^[a-f0-9]{48}$/.test(token)) return null;
    return this.redis.getdel(this.key(token));
  }

  /** 读取落盘对象(防路径穿越:同 A3 saveObject 的 root 约束);文件不存在 → null */
  async readObject(ossKey: string): Promise<Buffer | null> {
    const root = resolve(this.root);
    const target = resolve(root, ossKey);
    if (!target.startsWith(root + sep)) return null;
    try {
      return await readFile(target);
    } catch {
      return null;
    }
  }
}
