/**
 * 生成进度归约(向导第 3 步)
 * 把 GET /courseware/jobs/{jobId} 的响应折成页面直接用的派生量:
 * 百分比、失败页、是否还需轮询、是否可重试。纯函数,vitest 覆盖。
 */
import { ApiError, ERROR_CODES } from '@qiming/contracts';
import type { CoursewareJobDto, CoursewareJobPageDto } from '@qiming/contracts';

export interface JobProgress {
  /** 0–100(total=0 时为 0) */
  percent: number;
  done: number;
  total: number;
  /** 失败页序号(升序) */
  failedSeqs: number[];
  /** 存在失败页 → 显示「重试失败页」 */
  canRetry: boolean;
  /** queued/running 或「入库中」→ 继续轮询;failed / 已入库 → 停止 */
  shouldPoll: boolean;
  /** 全部页生成完成**且成品已入资源库**(展示完成态 + 成品入口) */
  finished: boolean;
  /**
   * status=done 但 resourceId 还没回填:图片都出来了、Resource 还在落库。
   * 此时不能报「已存入资源库」(点进去会扑空),只提示入库中并降频续轮。
   */
  archiving: boolean;
}

/** 入库中的低频轮询间隔(ms):图片已生成,只等 Resource 落库,不必 2s 一次 */
export const ARCHIVING_POLL_MS = 5000;

export const PAGE_STATUS_LABEL: Record<CoursewareJobPageDto['status'], string> = {
  pending: '生成中', done: '已生成', failed: '生成失败',
};

export function deriveProgress(job: CoursewareJobDto | null): JobProgress {
  if (!job) {
    return { percent: 0, done: 0, total: 0, failedSeqs: [], canRetry: false, shouldPoll: true, finished: false, archiving: false };
  }
  const total = Math.max(0, job.total);
  const done = Math.min(total, Math.max(0, job.done));
  const failedSeqs = job.pages.filter((p) => p.status === 'failed').map((p) => p.seq).sort((a, b) => a - b);
  const archiving = job.status === 'done' && job.resourceId == null;
  return {
    percent: total === 0 ? 0 : Math.round((done / total) * 100),
    done,
    total,
    failedSeqs,
    canRetry: failedSeqs.length > 0,
    shouldPoll: job.status === 'queued' || job.status === 'running' || archiving,
    finished: job.status === 'done' && job.resourceId != null,
    archiving,
  };
}

/**
 * 任务已不存在 / 已过期(轮询该终止,提示教师重新生成)。
 * 契约里 jobId 是 Redis 运行态字符串(后端存 24h,mock 是内存表刷新即失效),
 * 所以带 ?job= 回到本页时必须能识别这种 404。三种口径都要认:mock 的 4040、
 * 真实后端的业务码 4602、以及 HTTP 404 本身(真实后端通用 404 的 code 就是 404)。
 */
export function isJobExpired(e: unknown): boolean {
  if (!(e instanceof ApiError)) return false;
  return e.code === ERROR_CODES.NOT_FOUND
    || e.code === ERROR_CODES.COURSEWARE_JOB_NOT_FOUND
    || e.httpStatus === 404;
}

/** 进度文案(顶部一句话状态) */
export function progressText(job: CoursewareJobDto | null): string {
  const p = deriveProgress(job);
  if (!job) return '正在读取生成进度…';
  if (job.status === 'queued') return '已排队,等待 AI 开始逐页生图…';
  if (job.status === 'running') return `正在逐页生成图片:已完成 ${p.done}/${p.total} 页`;
  if (job.status === 'failed') return `有 ${p.failedSeqs.length} 页生成失败,可重试失败页`;
  if (p.archiving) return '图片已生成,正在入库…';
  return `全部 ${p.total} 页已生成完成`;
}
