import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { UPLOAD_PURPOSES, UploadPurpose } from './upload.dto';

/**
 * ossKey 归属校验(sec-back · #6):凭 ossKey 读/签/存资源前的纵深防御。
 *
 * 约定形如 `${purpose}/${orgId}/${ym}/${rand}${ext}`(见 UploadService.createSts)。
 * 通过条件:
 *  - 非空、不含路径穿越 `..`;
 *  - 首段 purpose ∈ UPLOAD_PURPOSES,且(若指定 allowedPurposes)∈ allowedPurposes;
 *  - 第二段 orgId 段 === 调用者机构 id。
 * 不合法即抛错,杜绝凭任意 ossKey 跨租户/跨用途读取或落库他人原稿/题图/课件。
 *
 * @param mode 抛错类型:'forbidden'(默认,越权场景=403)/'badRequest'(入参校验场景=400)。
 *             模板见 upload.controller.ts view-url(`..` → 400、归属不符 → 403)。
 */
export function assertOssKeyOwned(
  key: string | null | undefined,
  orgId: number,
  allowedPurposes?: readonly UploadPurpose[],
  mode: 'forbidden' | 'badRequest' = 'forbidden',
): void {
  const fail = (msg: string): never => {
    throw mode === 'badRequest' ? new BadRequestException(msg) : new ForbiddenException(msg);
  };
  if (!key || typeof key !== 'string' || key.includes('..')) {
    fail('ossKey 非法或含路径穿越');
    return;
  }
  const [purpose, orgSeg] = key.split('/');
  const allowed = allowedPurposes ?? UPLOAD_PURPOSES;
  if (
    !UPLOAD_PURPOSES.includes(purpose as UploadPurpose) ||
    !allowed.includes(purpose as UploadPurpose) ||
    orgSeg !== String(orgId)
  ) {
    fail('无权访问该资源:ossKey 归属校验失败');
  }
}

/**
 * 非抛出版归属校验(sec-back · #6):用于「读/签名」端的软失败。
 * 不合规(脏数据 / 历史非 answer_photo 前缀 / 跨租户)即返回 false,调用方据此跳过签名、不下发 URL——
 * 既堵住跨租户对象被签发,又不让历史脏数据 403 掉整个批改详情(摄入端 submit 已用 assertOssKeyOwned 硬拒 400)。
 */
export function isOssKeyOwned(
  key: string | null | undefined,
  orgId: number,
  allowedPurposes?: readonly UploadPurpose[],
): boolean {
  if (!key || typeof key !== 'string' || key.includes('..')) return false;
  const [purpose, orgSeg] = key.split('/');
  const allowed = allowedPurposes ?? UPLOAD_PURPOSES;
  return (
    UPLOAD_PURPOSES.includes(purpose as UploadPurpose) &&
    allowed.includes(purpose as UploadPurpose) &&
    orgSeg === String(orgId)
  );
}
