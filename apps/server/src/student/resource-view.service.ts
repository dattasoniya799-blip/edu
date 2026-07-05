import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import { readFile } from 'fs/promises';
import { resolve, sep } from 'path';
import type Redis from 'ioredis';
import { REDIS } from '../redis/redis.module';

/**
 * 课件回看签名 URL(FIX1):机制与 A3 storage 适配器(src/upload/storage/)对称——
 * - A3 local 驱动的"预签名 PUT" = 一次性 token(Redis,TTL)+ @Public 上传端点 PUT /uploads/local/:token;
 * - 本服务的"预签名 GET" = **TTL 内可重复使用**的 token(Redis,TTL)+ @Public 下载端点
 *   GET /student/resources/local/:token。
 * FIXB · B4:回看 token 由「一次性(GETDEL)」改为 TTL 内可重复读(GET)——响应携带
 * expiresAt(+10min)承诺有效期,而刷新页面 / 视频 Range 分段请求 / PDF 阅览器二次拉取
 * 都会对同一 URL 发起多次 GET,一次性语义会让第二次起全部 403「已使用」,与 expiresAt
 * 语义自相矛盾;上传侧 PUT token(A3)保持一次性不变。过期与归属校验保留:过期由 Redis
 * TTL 自然失效,token 是 48 位十六进制随机串、仅签给通过课程归属校验的学生(presign 入口)。
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

  /** 为 ossKey 签发 GET 凭证(TTL 内可重复使用;形状对称 A3 StorageAdapter.presignPut) */
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

  /**
   * 校验并解析 token → ossKey;无效/过期 → null。
   * FIXB · B4:GETDEL → GET,token 在 TTL(expiresAt)内可重复使用 —— 刷新 / 视频 Range
   * 分段 / PDF 二次拉取均复用同一 URL;过期由 Redis TTL 自然失效,格式校验保持不变。
   */
  async resolveToken(token: string): Promise<string | null> {
    if (!/^[a-f0-9]{48}$/.test(token)) return null;
    return this.redis.get(this.key(token));
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
