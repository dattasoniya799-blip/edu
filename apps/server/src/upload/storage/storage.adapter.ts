/**
 * 存储适配器(任务卡 A3):/uploads/sts 返回预签名 PUT URL。
 * - local:MVP,本地磁盘模拟 OSS,预签名 = 带一次性 token 的上传端点
 * - oss  :生产接阿里云 STS,本期仅占位
 * 驱动由 .env 的 STORAGE_DRIVER 选择(默认 local)。
 */
export interface PresignedPut {
  /** 客户端直传用的 PUT URL */
  uploadUrl: string;
  /** 凭证过期时间 */
  expiresAt: Date;
}

export interface StorageAdapter {
  /** 为 ossKey 签发一次性 PUT 凭证 */
  presignPut(ossKey: string, expiresSec: number): Promise<PresignedPut>;
}

export const STORAGE_ADAPTER = Symbol('STORAGE_ADAPTER');
