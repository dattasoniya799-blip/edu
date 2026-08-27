/**
 * AI 生成课件 · 端点调用(契约已正式化,全部走 createClient 的类型化路径)
 *
 * 2026-08-22:四个 /courseware/* 端点已进 openapi,原先「api.post as unknown」的类型放宽已删除。
 * 请求体类型从 api.post 的签名反推(见 PostBody),响应类型由客户端按契约推导 ——
 * 前端不再本地重声明任何报文形状,契约一改这里立刻编译报错。
 */
import type { CoursewareJobDto, CoursewareOutlinePageDto } from '@qiming/contracts';
import { api } from '../../../api';

/** 契约请求体类型(从类型化客户端反推,避免本地重复声明报文) */
type PostBody<P extends Parameters<typeof api.post>[0]> =
  NonNullable<NonNullable<Parameters<typeof api.post<P>>[1]>['body']>;

/** 文本 LLM 生成逐页大纲(需数秒);pageCount 契约里可选(3–20,后端缺省 8) */
export async function generateOutline(
  body: PostBody<'/courseware/outline'>,
): Promise<CoursewareOutlinePageDto[]> {
  const r = await api.post('/courseware/outline', { body });
  return r.data.pages;
}

/** 建生图任务(后端 BullMQ 入队),返回 Redis 运行态 jobId */
export async function createCoursewareJob(body: PostBody<'/courseware/jobs'>): Promise<string> {
  const r = await api.post('/courseware/jobs', { body });
  return r.data.jobId;
}

/** 轮询任务进度(前端 setInterval 2s);任务过期/不存在时抛 404,由 isJobExpired 识别 */
export async function fetchCoursewareJob(jobId: string): Promise<CoursewareJobDto> {
  const r = await api.get('/courseware/jobs/{jobId}', { params: { jobId } });
  return r.data;
}

/** 重试失败页(无 body),之后继续轮询 */
export async function retryCoursewareJob(jobId: string): Promise<void> {
  await api.post('/courseware/jobs/{jobId}/retry', { params: { jobId } });
}
