/**
 * 生成进度归约(向导第 3 步):百分比 / 失败页 / 是否轮询 / 是否可重试 / 任务过期识别
 */
import { describe, expect, it } from 'vitest';
import { ApiError, ERROR_CODES } from '@qiming/contracts';
import type { CoursewareJobDto, CoursewareJobPageDto } from '@qiming/contracts';
import { deriveProgress, isJobExpired, progressText } from '../progress';

const job = (
  status: CoursewareJobDto['status'],
  pageStatuses: CoursewareJobPageDto['status'][],
  resourceId?: number,
): CoursewareJobDto => ({
  jobId: 'cw-job-1',
  status,
  total: pageStatuses.length,
  done: pageStatuses.filter((s) => s === 'done').length,
  pages: pageStatuses.map((s, i) => ({
    seq: i + 1, title: `第 ${i + 1} 页`, status: s,
    ...(s === 'done' ? { imageUrl: `data:image/svg+xml,page-${i + 1}` } : {}),
  })),
  ...(resourceId != null ? { resourceId } : {}),
});

describe('deriveProgress', () => {
  it('尚未拿到首帧(null)→ 0%,仍需轮询', () => {
    const p = deriveProgress(null);
    expect(p).toMatchObject({ percent: 0, done: 0, total: 0, shouldPoll: true, finished: false, canRetry: false });
  });

  it('queued:全部 pending → 0%,继续轮询', () => {
    const p = deriveProgress(job('queued', ['pending', 'pending', 'pending']));
    expect(p.percent).toBe(0);
    expect(p.shouldPoll).toBe(true);
    expect(p.finished).toBe(false);
  });

  it('running:2/8 完成 → 25%,继续轮询', () => {
    const p = deriveProgress(job('running', ['done', 'done', 'pending', 'pending', 'pending', 'pending', 'pending', 'pending']));
    expect(p.percent).toBe(25);
    expect(p.done).toBe(2);
    expect(p.total).toBe(8);
    expect(p.shouldPoll).toBe(true);
  });

  it('failed:第 3 页失败 → 停止轮询、可重试,失败页序升序', () => {
    const p = deriveProgress(job('failed', ['done', 'done', 'failed', 'done']));
    expect(p.failedSeqs).toEqual([3]);
    expect(p.canRetry).toBe(true);
    expect(p.shouldPoll).toBe(false);
    expect(p.finished).toBe(false);
    expect(p.percent).toBe(75);
  });

  it('done:100%、停止轮询、完成态,不再提示重试', () => {
    const p = deriveProgress(job('done', ['done', 'done', 'done'], 7));
    expect(p.percent).toBe(100);
    expect(p.shouldPoll).toBe(false);
    expect(p.finished).toBe(true);
    expect(p.canRetry).toBe(false);
  });

  it('done 但 resourceId 未回填(成品还在落库)→ 不算完成,降频续轮', () => {
    const p = deriveProgress(job('done', ['done', 'done', 'done']));
    expect(p.percent).toBe(100);
    expect(p.archiving).toBe(true);
    expect(p.finished).toBe(false);
    expect(p.shouldPoll).toBe(true);
  });

  it('异常数值:total=0 不除零;done 超过 total 时夹取', () => {
    expect(deriveProgress({ jobId: 'cw-job-1', status: 'queued', total: 0, done: 0, pages: [] }).percent).toBe(0);
    const p = deriveProgress({ ...job('running', ['done', 'pending']), done: 9 });
    expect(p.done).toBe(2);
    expect(p.percent).toBe(100);
  });
});

describe('progressText', () => {
  it('按状态给出一句话进度', () => {
    expect(progressText(null)).toBe('正在读取生成进度…');
    expect(progressText(job('queued', ['pending']))).toContain('已排队');
    expect(progressText(job('running', ['done', 'pending']))).toBe('正在逐页生成图片:已完成 1/2 页');
    expect(progressText(job('failed', ['done', 'failed']))).toBe('有 1 页生成失败,可重试失败页');
    expect(progressText(job('done', ['done', 'done']))).toBe('图片已生成,正在入库…');
    expect(progressText(job('done', ['done', 'done'], 7))).toBe('全部 2 页已生成完成');
  });
});

describe('isJobExpired', () => {
  const apiError = (code: number, httpStatus: number) =>
    new ApiError(code, '生成任务不存在或已过期', undefined, httpStatus);

  it('4040 / 4602 / HTTP 404 → 任务已过期(带 ?job= 回来时提示重新生成)', () => {
    expect(isJobExpired(apiError(ERROR_CODES.NOT_FOUND, 404))).toBe(true);
    expect(isJobExpired(apiError(ERROR_CODES.COURSEWARE_JOB_NOT_FOUND, 404))).toBe(true);
    expect(isJobExpired(apiError(-1, 404))).toBe(true);
    expect(isJobExpired(apiError(ERROR_CODES.NOT_FOUND, 200))).toBe(true);
  });

  it('其他错误(网络波动 / 5xx / 非 ApiError)→ 不当作过期,走「重新读取」', () => {
    expect(isJobExpired(apiError(5000, 500))).toBe(false);
    expect(isJobExpired(new Error('Failed to fetch'))).toBe(false);
    // 形状像但不是 ApiError:改用 instanceof 后一律不认(旧鸭子类型会误判裸 Error)
    expect(isJobExpired(Object.assign(new Error('x'), { code: ERROR_CODES.NOT_FOUND }))).toBe(false);
    expect(isJobExpired({ code: ERROR_CODES.NOT_FOUND })).toBe(false);
    expect(isJobExpired(null)).toBe(false);
  });
});
