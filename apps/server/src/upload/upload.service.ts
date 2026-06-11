import { Inject, Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { extname } from 'path';
import { STORAGE_ADAPTER, StorageAdapter } from './storage/storage.adapter';
import { StsRequestDto } from './upload.dto';

/** 凭证有效期(秒) */
const STS_TTL_SEC = 300;

export interface StsCredentialDto {
  uploadUrl: string;
  ossKey: string;
  expiresAt: string;
}

@Injectable()
export class UploadService {
  constructor(@Inject(STORAGE_ADAPTER) private readonly storage: StorageAdapter) {}

  /** POST /uploads/sts:生成 ossKey 并签发一次性直传凭证 */
  async createSts(orgId: number, dto: StsRequestDto): Promise<StsCredentialDto> {
    const now = new Date();
    const ym = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
    // 文件名只保留扩展名(防注入/防中文路径问题),原名不参与落盘路径
    const ext = extname(dto.fileName).toLowerCase().replace(/[^.a-z0-9]/g, '').slice(0, 10);
    const ossKey = `${dto.purpose}/${orgId}/${ym}/${randomBytes(12).toString('hex')}${ext}`;
    const signed = await this.storage.presignPut(ossKey, STS_TTL_SEC);
    return { uploadUrl: signed.uploadUrl, ossKey, expiresAt: signed.expiresAt.toISOString() };
  }
}
