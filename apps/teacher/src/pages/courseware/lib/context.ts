/**
 * 向导上下文(query 参数 ?lessonId=&kpNodeId=&job=)
 * lessonId/kpNodeId 从编排页进入时携带,用于「将结合知识点 XX 生成」提示与完成后「返回编排课堂」。
 * job 是第 3 步开始轮询后写回地址栏的 jobId(后端任务在 Redis 存 24h),
 * 刷新或离开再回来时据此直接恢复到进度页。纯函数,vitest 覆盖。
 */
export interface WizardContext {
  lessonId: number | null;
  kpNodeId: number | null;
  /** 恢复轮询用的 jobId(契约里是 Redis 运行态字符串,不是数字 id) */
  jobId: string | null;
  /**
   * 当前步骤(?step=1|2|3)。步骤进地址栏后浏览器返回键退到上一步而不是直接退出向导 ——
   * 教师在第 2 步改了半天大纲、想回第 1 步换风格时按返回,不该丢掉整个向导。
   * 缺省/非法值 → null(由页面按有无 ?job= 决定落到第 1 步还是第 3 步)。
   */
  step: 1 | 2 | 3 | null;
}

export const EMPTY_CONTEXT: WizardContext = { lessonId: null, kpNodeId: null, jobId: null, step: null };

/** 正整数 id 才认;空/非数字/0/负数 → null */
function parseId(raw: string | null): number | null {
  if (raw == null || raw.trim() === '') return null;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export function parseWizardContext(search: URLSearchParams | string): WizardContext {
  const params = typeof search === 'string' ? new URLSearchParams(search) : search;
  const step = parseId(params.get('step'));
  return {
    lessonId: parseId(params.get('lessonId')),
    kpNodeId: parseId(params.get('kpNodeId')),
    jobId: params.get('job')?.trim() || null,
    step: step === 1 || step === 2 || step === 3 ? step : null,
  };
}

/**
 * 向导自身的地址(含 query):第 3 步开始轮询时把 jobId 写进 ?job=,
 * 同时保留原有 lessonId/kpNodeId —— 刷新后既能恢复进度,也不丢编排上下文。
 */
export function wizardPath(ctx: WizardContext, jobId?: string | null, step?: 1 | 2 | 3 | null): string {
  const qs = new URLSearchParams();
  if (ctx.lessonId != null) qs.set('lessonId', String(ctx.lessonId));
  if (ctx.kpNodeId != null) qs.set('kpNodeId', String(ctx.kpNodeId));
  const job = jobId?.trim();
  if (job) qs.set('job', job);
  if (step != null) qs.set('step', String(step));
  const s = qs.toString();
  return s ? `/courseware/new?${s}` : '/courseware/new';
}

/** 提交给端点的可选上下文字段(null 不下发,避免脏字段) */
export function contextBody(ctx: WizardContext): { lessonId?: number; kpNodeId?: number } {
  return {
    ...(ctx.lessonId != null ? { lessonId: ctx.lessonId } : {}),
    ...(ctx.kpNodeId != null ? { kpNodeId: ctx.kpNodeId } : {}),
  };
}

/** 完成后「返回编排课堂」路径;非编排页进入 → null(不显示该按钮) */
export function arrangePath(ctx: WizardContext): string | null {
  return ctx.lessonId == null ? null : `/lessons/${ctx.lessonId}/arrange`;
}

/**
 * 上下文提示文案;无上下文 → null(不显示提示条)。
 * 知识点名 / 讲次标题由页面按既有契约端点解析(拿不到时退化为 id 展示)。
 */
export function contextHint(
  ctx: WizardContext,
  names: { kpNodeName?: string | null; lessonTitle?: string | null } = {},
): string | null {
  if (ctx.lessonId == null && ctx.kpNodeId == null) return null;
  const kpName = names.kpNodeName?.trim();
  const lessonTitle = names.lessonTitle?.trim();
  const parts = [
    kpName ? `将结合知识点「${kpName}」生成` : ctx.kpNodeId != null ? `将结合知识点 #${ctx.kpNodeId} 生成` : null,
    lessonTitle ? `来自《${lessonTitle}》的编排` : ctx.lessonId != null ? `来自讲次 #${ctx.lessonId} 的编排` : null,
  ].filter((s): s is string => s != null);
  return parts.join(' · ');
}
