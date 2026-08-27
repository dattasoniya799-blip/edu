/** 接口调用唯一入口:contracts createClient(宪法:禁止手写 fetch) */
import { ApiError, createClient, ERROR_CODES } from '@qiming/contracts';
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
 * 端点响应 data 的推导类型(从客户端签名反推,页面不再本地重声明报文形状 ——
 * 契约一改立刻编译报错,而 `.data as X` 只要新旧形状部分重叠就照过)。
 */
export type GetData<P extends Parameters<typeof api.get>[0]> =
  Awaited<ReturnType<typeof api.get<P>>> extends { data: infer D } ? D : never;
export type PostData<P extends Parameters<typeof api.post>[0]> =
  Awaited<ReturnType<typeof api.post<P>>> extends { data: infer D } ? D : never;

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

/** 业务错误文案(ApiError 的 message 即服务端下发的 message) */
export function errorMessage(e: unknown, fallback: string): string {
  if (e instanceof Error && e.message && e.message !== 'error') return e.message;
  return fallback;
}

/**
 * 409·唯一约束冲突(server P2002 →「资源已存在或唯一约束冲突」):
 * dev StrictMode 双发 POST /student/attempts 撞唯一索引的典型症状。
 * 服务端正在做创建幂等化 —— 此类错误重试一次创建即可拿到已有 attempt。
 */
export function isConflictAlreadyExists(e: unknown): boolean {
  if (!(e instanceof ApiError)) return false;
  return e.httpStatus === 409 && (e.message.includes('已存在') || e.message.includes('唯一约束'));
}

/**
 * 409·作业已完成(server BizException 4502「该作业已完成,不可重复作答」):
 * 无 ?attempt= 直开已完成作业时触发 —— 应改从作业列表取 myAttempt.attemptId 看成绩单。
 */
export function isConflictAttemptCompleted(e: unknown): boolean {
  if (!(e instanceof ApiError)) return false;
  return (e.httpStatus === 409 || e.code === ERROR_CODES.ATTEMPT_STATE)
    && (e.message.includes('已完成') || e.message.includes('不可重复作答'));
}
