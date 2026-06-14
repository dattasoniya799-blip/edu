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

/** 解答题拍照:大小上限(后端 putLocal 上限 25MB,此处留余量给 UI 早拦) */
export const MAX_ANSWER_PHOTO_BYTES = 15 * 1024 * 1024;

/**
 * 解答题拍照真上传(#2,两步直传,契约形状同教师录题插图):
 *   1. POST /uploads/sts(purpose=answer_photo)→ { uploadUrl, ossKey }(走 contracts createClient,带 token)
 *   2. 对 uploadUrl 直接 PUT 原始文件字节 —— 预签名直传不属于 openapi 契约接口,无法经 createClient
 *      表达,这是仓库内允许的原生 fetch(local 驱动 uploadUrl=/uploads/local/:token;mock 由 msw 拦截)
 * 返回入库用的真实 ossKey;任一步失败抛错(调用方提示用户、不落假 key)。
 */
export async function uploadAnswerPhoto(file: File): Promise<string> {
  if (file.size > MAX_ANSWER_PHOTO_BYTES) throw new Error('照片不能超过 15MB,请压缩后重试');
  const sts = await api.post('/uploads/sts', {
    body: { purpose: 'answer_photo', fileName: file.name },
  });
  const { uploadUrl, ossKey } = sts.data;
  const res = await fetch(uploadUrl, { method: 'PUT', body: file });
  if (!res.ok) throw new Error(`照片上传失败(HTTP ${res.status}),请重试`);
  return ossKey;
}

/** 业务错误文案(contracts 未导出 ApiError 类,按形状取 message) */
export function errorMessage(e: unknown, fallback: string): string {
  if (e instanceof Error && e.message && e.message !== 'error') return e.message;
  return fallback;
}
