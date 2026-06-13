import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  PayloadTooLargeException,
  Post,
  Put,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readFile } from 'fs/promises';
import { resolve, sep } from 'path';
import type { Request, Response } from 'express';
import { CurrentUser, Public } from '../common/decorators';
import { LocalStorageAdapter } from './storage/local-storage.adapter';
import { signStorageUrl, verifyStorageSig } from './storage/storage-sign.util';
import { STORAGE_ADAPTER, StorageAdapter } from './storage/storage.adapter';
import { StsRequestDto } from './upload.dto';
import { UploadService } from './upload.service';

/** 单文件上限(本地模拟 OSS;答题照片/题图/课件足够) */
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

@Controller('uploads')
export class UploadController {
  constructor(
    private readonly uploads: UploadService,
    private readonly cfg: ConfigService,
    @Inject(STORAGE_ADAPTER) private readonly storage: StorageAdapter,
  ) {}

  /** openapi:直传凭证 [*](所有已登录角色) */
  @Post('sts')
  @HttpCode(200)
  sts(@CurrentUser() user: { orgId: number }, @Body() dto: StsRequestDto) {
    return this.uploads.createSts(user.orgId, dto);
  }

  /**
   * FIX4 · #3:由 ossKey 换签名 GET URL(已登录角色;不属于 openapi 契约,见 README · FIX4)。
   * 题目/作答返回的 figures / photoOssKey 是 ossKey,前端调本端点拿可直接展示的签名 URL
   * (指向 #2 的 @Public GET /storage/*)。签名 secret 在后端,故必须经此端点换取。
   */
  @Get('view-url')
  viewUrl(@Query('ossKey') ossKey?: string): { url: string } {
    if (!ossKey || ossKey.includes('..'))
      throw new BadRequestException('ossKey 必填且不得含路径穿越');
    const base = this.cfg.get<string>(
      'UPLOAD_PUBLIC_BASE',
      `http://127.0.0.1:${this.cfg.get('PORT', '3000')}`,
    );
    const secret = this.cfg.get<string>('JWT_SECRET', 'dev-secret-change-me');
    return { url: signStorageUrl(base, secret, ossKey) };
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

/**
 * FIX4 · #2:签名 GET 下载端点(@Public GET /storage/*,不属于 openapi 契约;
 * 等价于 OSS 的外部回看地址)。GradingService.signPhotoUrl / #3 view-url 生成的
 * `${base}/api/v1/storage/${ossKey}?exp&sig` 由本端点服务:
 * - 校验 HMAC sig + exp(与 signStorageUrl 同算法/同 secret),过期/签名错 → 403;
 * - 通过后从本地 UPLOAD_ROOT 流式回文件;路径穿越(resolve 后越出 root)→ 403,文件缺失 → 404。
 * 独立控制器,避免落入任何角色门禁;OSS 驱动下生产端由对象存储直签,本端点仅 local 用。
 */
@Controller('storage')
export class StorageDownloadController {
  private readonly root: string;
  private readonly secret: string;

  constructor(cfg: ConfigService) {
    this.root = cfg.get<string>('UPLOAD_ROOT', './storage');
    this.secret = cfg.get<string>('JWT_SECRET', 'dev-secret-change-me');
  }

  @Public()
  @Get('*')
  async get(
    @Req() req: Request,
    @Res() res: Response,
    @Query('exp') expStr?: string,
    @Query('sig') sig?: string,
  ): Promise<void> {
    // Express 已对路由参数做 decodeURIComponent;ossKey 即 /storage/ 之后的整段路径
    const ossKey = String(req.params[0] ?? '');
    const exp = Number(expStr);
    if (!ossKey || !sig || !verifyStorageSig(this.secret, ossKey, exp, sig))
      throw new ForbiddenException('签名无效或已过期');

    // 路径穿越防护:落点必须严格位于 UPLOAD_ROOT 之内(同 A3 saveObject 口径)
    const root = resolve(this.root);
    const target = resolve(root, ossKey);
    if (target !== root && !target.startsWith(root + sep))
      throw new ForbiddenException('非法路径');

    let body: Buffer;
    try {
      body = await readFile(target);
    } catch {
      throw new NotFoundException('文件不存在');
    }
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Length', String(body.length));
    res.end(body);
  }
}
