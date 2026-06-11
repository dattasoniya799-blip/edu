import {
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  PayloadTooLargeException,
  Post,
  Put,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { CurrentUser, Public } from '../common/decorators';
import { LocalStorageAdapter } from './storage/local-storage.adapter';
import { STORAGE_ADAPTER, StorageAdapter } from './storage/storage.adapter';
import { StsRequestDto } from './upload.dto';
import { UploadService } from './upload.service';

/** 单文件上限(本地模拟 OSS;答题照片/题图/课件足够) */
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

@Controller('uploads')
export class UploadController {
  constructor(
    private readonly uploads: UploadService,
    @Inject(STORAGE_ADAPTER) private readonly storage: StorageAdapter,
  ) {}

  /** openapi:直传凭证 [*](所有已登录角色) */
  @Post('sts')
  @HttpCode(200)
  sts(@CurrentUser() user: { orgId: number }, @Body() dto: StsRequestDto) {
    return this.uploads.createSts(user.orgId, dto);
  }

  /**
   * 本地驱动的"预签名 PUT"端点(不属于 openapi 契约,等价于 OSS 外部直传地址):
   * 一次性 token 即凭证,故 @Public;token 无效/过期/已使用 → 403。
   */
  @Public()
  @Put('local/:token')
  async putLocal(@Param('token') token: string, @Req() req: Request) {
    if (!(this.storage instanceof LocalStorageAdapter))
      throw new NotFoundException('当前存储驱动非 local');
    const ossKey = await this.storage.consumeToken(token);
    if (!ossKey) throw new ForbiddenException('上传凭证无效、已过期或已使用');

    const body = await this.readBody(req);
    await this.storage.saveObject(ossKey, body);
    return { ossKey, size: body.length };
  }

  /** 读取原始请求体(二进制 content-type 不经 body-parser,流原样可读) */
  private readBody(req: Request): Promise<Buffer> {
    return new Promise((resolvePromise, reject) => {
      const chunks: Buffer[] = [];
      let size = 0;
      req.on('data', (c: Buffer) => {
        size += c.length;
        if (size > MAX_UPLOAD_BYTES) {
          req.destroy();
          reject(new PayloadTooLargeException('文件超过 25MB 上限'));
          return;
        }
        chunks.push(c);
      });
      req.on('end', () => resolvePromise(Buffer.concat(chunks)));
      req.on('error', reject);
    });
  }
}
