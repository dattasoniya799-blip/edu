import { PresignedPut, StorageAdapter } from './storage.adapter';

/** 生产 OSS 驱动占位:MVP 阶段未接入,选用时直接报错提示切回 local */
export class OssStorageAdapter implements StorageAdapter {
  presignPut(_ossKey: string, _expiresSec: number): Promise<PresignedPut> {
    throw new Error('OSS 驱动尚未实现(生产环境接阿里云 STS);MVP 请配置 STORAGE_DRIVER=local');
  }
}
