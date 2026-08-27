import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import { mkdir, writeFile } from 'fs/promises';
import { dirname, resolve, sep } from 'path';
import { getJwtSecret } from '../common/env-assert';
import { signStorageUrl } from '../upload/storage/storage-sign.util';

/**
 * AI 生成课件的整页图片落盘 + 回看签名(与 A3 存储适配器同口径,在本模块内自建)。
 *
 * 纪律说明:UploadModule 未 export STORAGE_ADAPTER(不改他人模块 —— 与
 * `student/resource-view.service.ts` 同一先例),故此处按 A3 `LocalStorageAdapter.saveObject`
 * 的口径在本模块内实现写入:同样的 UPLOAD_ROOT 解析、同样的路径穿越防护(落点必须严格在 root 内)。
 * 对象键沿用 A3 的 `${purpose}/${orgId}/${ym}/${rand}${ext}` 约定,purpose 取 `resource`
 * (与教师手动上传课件同用途),使 oss-key 归属校验(assertOssKeyOwned)可直接复用。
 * 回看 URL 复用 `signStorageUrl`(HMAC + 10 分钟有效期,由 @Public GET /storage/* 服务)。
 * 生产切 OSS(STORAGE_DRIVER=oss)时此处换真实 put/签名,ossKey 与出参形状不变。
 */
@Injectable()
export class CoursewareStorageService {
  private readonly root: string;
  private readonly publicBase: string;
  private readonly secret: string;

  constructor(cfg: ConfigService) {
    this.root = cfg.get<string>('UPLOAD_ROOT', './storage');
    this.publicBase = cfg.get<string>(
      'UPLOAD_PUBLIC_BASE',
      `http://127.0.0.1:${cfg.get('PORT', '3000')}`,
    );
    this.secret = getJwtSecret(cfg);
  }

  /** 生成本机构的整页图片对象键:resource/{orgId}/{yyyyMM}/{hex}.png */
  ossKeyFor(orgId: number): string {
    const now = new Date();
    const ym = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
    return `resource/${orgId}/${ym}/${randomBytes(12).toString('hex')}.png`;
  }

  /** 字节落盘(防路径穿越:落点必须在 UPLOAD_ROOT 之内,同 A3 saveObject) */
  async save(ossKey: string, body: Buffer): Promise<void> {
    const root = resolve(this.root);
    const target = resolve(root, ossKey);
    if (!target.startsWith(root + sep)) throw new Error(`非法 ossKey: ${ossKey}`);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, body);
  }

  /** 10 分钟有效期的签名 GET URL(同 A5 手写原稿 / FIX4 view-url 口径) */
  signUrl(ossKey: string): string {
    return signStorageUrl(this.publicBase, this.secret, ossKey);
  }
}
