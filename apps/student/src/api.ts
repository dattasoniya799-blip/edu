/** 接口调用唯一入口:contracts createClient(宪法:禁止手写 fetch) */
import { createClient } from '@qiming/contracts';
import { getToken } from './auth/token';

let unauthorizedHandler: () => void = () => {};

/** AuthProvider 挂载时注入(401 → 清 token 跳登录) */
export function setUnauthorizedHandler(fn: () => void): void {
  unauthorizedHandler = fn;
}

export const api = createClient({
  getToken,
  onUnauthorized: () => unauthorizedHandler(),
});

/** 业务错误文案(contracts 未导出 ApiError 类,按形状取 message) */
export function errorMessage(e: unknown, fallback: string): string {
  if (e instanceof Error && e.message && e.message !== 'error') return e.message;
  return fallback;
}
