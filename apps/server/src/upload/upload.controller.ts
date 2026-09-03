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
import { getJwtSecret } from '../common/env-assert';
import { LocalStorageAdapter } from './storage/local-storage.adapter';
import { signStorageUrl, verifyStorageSig } from './storage/storage-sign.util';
import { STORAGE_ADAPTER, StorageAdapter } from './storage/storage.adapter';
import { StsRequestDto, UPLOAD_PURPOSES } from './upload.dto';
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
   * FIX4 · #3:由 ossKey 换签名 GET URL(已登录角色;2026-08-31 契约收口,已进 openapi)。
   * 题目/作答返回的 figures / photoOssKey 是 ossKey,前端调本端点拿可直接展示的签名 URL
   * (指向 #2 的 @Public GET /storage/*)。签名 secret 在后端,故必须经此端点换取。
   */
  @Get('view-url')
  viewUrl(
    @CurrentUser() user: { orgId: number },
    @Query('ossKey') ossKey?: string,
  ): { url: string } {
    if (!ossKey || ossKey.includes('..'))
      throw new BadRequestException('ossKey 必填且不得含路径穿越');
    // 归属校验:ossKey 形如 `${purpose}/${orgId}/${ym}/${rand}${ext}`(见 UploadService.createSts)。
    // 仅放行属于调用者机构前缀的 key,杜绝凭任意 ossKey 换取签名 URL 的越权(跨租户读取他人原稿/题图)。
    const [purpose, orgSeg] = ossKey.split('/');
    if (!UPLOAD_PURPOSES.includes(purpose as never) || orgSeg !== String(user.orgId))
      throw new ForbiddenException('无权访问该资源');
    const base = this.cfg.get<string>(
      'UPLOAD_PUBLIC_BASE',
      `http://127.0.0.1:${this.cfg.get('PORT', '3000')}`,
    );
    const secret = getJwtSecret(this.cfg);
    return { url: signStorageUrl(base, secret, ossKey) };
  }

  /**
   * 本地驱动的"预签名 PUT"端点(2026-08-31 已进 openapi,等价于 OSS 外部直传地址):
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
 * FIX4 · #2:签名 GET 下载端点(@Public GET /storage/*,2026-08-31 已进 openapi,
 * 契约以 /storage/{ossKey} 单参数表达多段路径;等价于 OSS 的外部回看地址)。
 * GradingService.signPhotoUrl / #3 view-url 生成的
 * `${base}/api/v1/storage/${ossKey}?exp&sig` 由本端点服务:
 * - 校验 HMAC sig + exp(与 signStorageUrl 同算法/同 secret),过期/签名错 → 403;
 * - 通过后从本地 UPLOAD_ROOT 流式回文件;路径穿越(resolve 后越出 root)→ 403,文件缺失 → 404。
 * 独立控制器,避免落入任何角色门禁;OSS 驱动下生产端由对象存储直签,本端点仅 local 用。
 */
const INLINE_MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  pdf: 'application/pdf', mp4: 'video/mp4', webm: 'video/webm', mp3: 'audio/mpeg',
  ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

/**
 * 可执行的文档类型(单文件互动课件 HTML / SVG):内联返回,但强制 `Content-Security-Policy: sandbox allow-scripts`
 * ——文档在浮空源(opaque origin)里运行,拿不到本站 storage / 其它接口的同源身份,即使有人直接打开直链也一样。
 * 学生端课堂本来就用 sandbox iframe 嵌它;这里再加一道,双保险。js 等其它可执行类型仍不内联。
 */
const SANDBOXED_INLINE_MIME: Record<string, string> = {
  html: 'text/html; charset=utf-8', htm: 'text/html; charset=utf-8', svg: 'image/svg+xml',
};

/** 扩展名 → Content-Type;未知类型回退 octet-stream 走下载 */
export function contentTypeByExt(ossKey: string): string {
  const ext = extOf(ossKey);
  return INLINE_MIME[ext] ?? SANDBOXED_INLINE_MIME[ext] ?? 'application/octet-stream';
}
/** 该扩展名是否需要 CSP sandbox 才能内联(html / svg) */
export function needsSandbox(ossKey: string): boolean {
  return extOf(ossKey) in SANDBOXED_INLINE_MIME;
}
function extOf(ossKey: string): string {
  return ossKey.toLowerCase().split('?')[0].split('.').pop() ?? '';
}

@Controller('storage')
export class StorageDownloadController {
  private readonly root: string;
  private readonly secret: string;

  constructor(cfg: ConfigService) {
    this.root = cfg.get<string>('UPLOAD_ROOT', './storage');
    this.secret = getJwtSecret(cfg);
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
    // 按扩展名给出真实 MIME(走查 G-2:恒 octet-stream 会让「预览」变下载);未知类型才回退二进制。
    // 不做内容嗅探;html / svg 内联但带 CSP sandbox(互动课件要在课堂 iframe 里跑,走查 B-2 复查发现 octet-stream 时 iframe 只会弹下载)。
    res.setHeader('Content-Type', contentTypeByExt(ossKey));
    if (needsSandbox(ossKey)) res.setHeader('Content-Security-Policy', 'sandbox allow-scripts');
    res.setHeader('Content-Length', String(body.length));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.end(body);
  }
}
