/** 接口调用唯一入口:contracts createClient(宪法:禁止手写 fetch) */
import { createClient } from '@qiming/contracts';
import { resolveOssUrlAsync, type FigureSrcResolver } from '@qiming/ui';
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
 * REV-front #1:由 ossKey 换后端签名直链。`GET /uploads/view-url?ossKey=` 不属于 openapi
 * 契约(server upload.controller 标注,见 README · REV-front),故 createClient 的类型化
 * 路径里没有它;此处经 api(仍带 token + 401 处理)调用,只在路径处做类型放宽 —— 不是手写
 * fetch。返回统一响应包 {code,message,data:{url}}。
 */
async function fetchViewUrl(ossKey: string): Promise<string> {
  const get = api.get as unknown as (
    p: string,
    a: { query: Record<string, string> },
  ) => Promise<{ data: { url: string } }>;
  const r = await get('/uploads/view-url', { query: { ossKey } });
  return r.data.url;
}

/** 题目插图源解析器(传给 @qiming/ui QuestionFigures / OssImage 的 resolveSrc) */
export const resolveFigureSrc: FigureSrcResolver = (ossKey) => resolveOssUrlAsync(ossKey, fetchViewUrl);
