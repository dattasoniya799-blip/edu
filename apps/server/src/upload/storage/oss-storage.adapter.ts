import { PresignedPut, StorageAdapter } from './storage.adapter';

/** STORAGE_DRIVER=oss 误配时的清晰提示文案(启动期与请求期复用) */
export const OSS_NOT_IMPLEMENTED =
  'STORAGE_DRIVER=oss 尚未接入(生产需接阿里云 STS);MVP 请配置 STORAGE_DRIVER=local。';

/**
 * 生产 OSS 驱动占位(sec-back · #9):MVP 阶段未接入。
 * 构造即抛错 —— 由 UploadModule 的 useFactory 在「模块启动期」实例化,
 * 因此 STORAGE_DRIVER=oss 误配会在应用启动时立即暴露(进程起不来),
 * 而非每个上传请求才抛错把误配藏到运行期。
 */
export class OssStorageAdapter implements StorageAdapter {
  constructor() {
    throw new Error(OSS_NOT_IMPLEMENTED);
  }

  presignPut(_ossKey: string, _expiresSec: number): Promise<PresignedPut> {
    throw new Error(OSS_NOT_IMPLEMENTED);
  }
}
