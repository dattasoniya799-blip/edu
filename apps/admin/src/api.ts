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

/**
 * 端点响应 data 的推导类型(从客户端签名反推,页面不再本地重声明报文形状 ——
 * 契约一改立刻编译报错,而 `.data as X` 只要新旧形状部分重叠就照过)。
 */
export type GetData<P extends Parameters<typeof api.get>[0]> =
  Awaited<ReturnType<typeof api.get<P>>> extends { data: infer D } ? D : never;
export type PostData<P extends Parameters<typeof api.post>[0]> =
  Awaited<ReturnType<typeof api.post<P>>> extends { data: infer D } ? D : never;
