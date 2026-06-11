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
