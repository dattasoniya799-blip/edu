/**
 * AI 生成课件向导(/courseware/new,纯前端 + msw mock 版本,供产品走查)
 *
 * 三步单页向导(各步 UI 在 steps/Step{1,2,3}*.tsx,本文件只管状态与流转):
 *   ① 输入:课件名称 + 文字稿/内容范围 + 期望页数 + PPT 风格 → POST /courseware/outline
 *   ② 大纲编辑:逐页改标题/要点/画面描述,增删调序 → POST /courseware/jobs(逐页 GPT Image 生图入队)
 *   ③ 生成进度:轮询 GET /courseware/jobs/{jobId}(2s),失败页可重试,完成后成品落资源库
 * 支持 ?lessonId=&kpNodeId=(从编排页进入),完成后可返回编排课堂;
 * 步骤与 jobId 都进地址栏(?step=&job=):返回键退到上一步而不是退出向导,刷新也能恢复轮询。
 * 端点与报文均已进契约(2026-08-22),调用见 lib/coursewareApi.ts —— 无类型放宽。
 */
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { CoursewareJobDto, CoursewareJobPageDto, CoursewareOutlinePageDto } from '@qiming/contracts';
import { Button, Card, EmptyState, useToast } from '@qiming/ui';
import { api } from '../../api';
import { PageHead } from '../Shell';
import { arrangePath, contextBody, contextHint, parseWizardContext, wizardPath } from './lib/context';
import { PAGE_COUNT_DEFAULT, validateInput, validateOutline } from './lib/outline';
import { ARCHIVING_POLL_MS, deriveProgress, isJobExpired } from './lib/progress';
import { createCoursewareJob, fetchCoursewareJob, generateOutline, retryCoursewareJob } from './lib/coursewareApi';
import { CUSTOM_STYLE_ID, DEFAULT_STYLE_ID, validateStyle } from './lib/styles';
import { Step1Input } from './steps/Step1Input';
import { Step2Outline } from './steps/Step2Outline';
import { Step3Progress } from './steps/Step3Progress';

const POLL_MS = 2000;
/** 距上次成功轮询超过这个时长,放大预览前先重拉一次 job(签名直链有效期通常 10–15 分钟) */
const STALE_JOB_MS = 5 * 60_000;
const STEPS = [{ n: 1, label: '输入内容' }, { n: 2, label: '编辑大纲' }, { n: 3, label: '生成进度' }] as const;

export function CoursewareWizardPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const ctx = useMemo(() => parseWizardContext(searchParams), [searchParams]);

  // ① 输入
  const [name, setName] = useState('');
  const [sourceText, setSourceText] = useState('');
  const [pageCount, setPageCount] = useState(PAGE_COUNT_DEFAULT);
  const [styleId, setStyleId] = useState(DEFAULT_STYLE_ID);
  const [customText, setCustomText] = useState('');
  const [outlining, setOutlining] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  // ② 大纲
  const [pages, setPages] = useState<CoursewareOutlinePageDto[]>([]);
  const [submitting, setSubmitting] = useState(false);
  // ③ 进度(jobId 以地址栏为准:刷新 / 返回键都靠 ?job= 恢复)
  const jobId = ctx.jobId;
  const [job, setJob] = useState<CoursewareJobDto | null>(null);
  const [pollNonce, setPollNonce] = useState(0);
  const [pollError, setPollError] = useState(false);
  const [expired, setExpired] = useState(false);
  const [retrying, setRetrying] = useState(false);
  /** 本次会话没走过第 1、2 步(纯靠 ?job= 恢复)→ 名称/风格等本地状态不可信,不展示 */
  const [restored, setRestored] = useState(ctx.jobId != null);
  /** 上次成功轮询时刻:放大预览时据此判断签名直链是否可能过期 */
  const lastPolledAt = useRef(0);
  // 上下文名称(讲次标题 / 知识点名,经既有契约端点解析,失败则退化为 id 展示)
  const [names, setNames] = useState<{ lessonTitle?: string | null; kpNodeName?: string | null }>({});

  /**
   * 当前步骤以地址栏为准。刷新会丢掉大纲/名称等本地状态,所以带 ?step=2 直接进来时
   * 若没有大纲就退回第 1 步;?step=3 同理要求有 jobId,避免停在一屏永远转圈的进度页。
   */
  const step: 1 | 2 | 3 = (() => {
    const want = ctx.step ?? (jobId != null ? 3 : 1);
    if (want === 3) return jobId != null ? 3 : 1;
    if (want === 2) return pages.length > 0 ? 2 : 1;
    return 1;
  })();

  const goStep = useCallback(
    (next: 1 | 2 | 3, opts?: { jobId?: string | null; replace?: boolean }) => {
      const job = opts && 'jobId' in opts ? opts.jobId : ctx.jobId;
      navigate(wizardPath(ctx, job, next), { replace: opts?.replace });
    },
    [ctx, navigate],
  );

  useEffect(() => {
    if (ctx.lessonId == null) return;
    Promise.all([
      api.get('/lessons/{id}', { params: { id: ctx.lessonId } }),
      api.get('/lessons/{id}/segments', { params: { id: ctx.lessonId } }),
    ])
      .then(([l, s]) => {
        const seg = s.data.find((x) => x.kpNodeId === ctx.kpNodeId);
        setNames({ lessonTitle: l.data.title, kpNodeName: seg?.kpNodeName ?? null });
      })
      .catch(() => undefined);
  }, [ctx.lessonId, ctx.kpNodeId]);

  /**
   * 轮询:queued/running 继续(2s);status=done 但成品还没入库时降到 5s 续轮;
   * 全部落定或失败即停。卸载或重试时清理。
   */
  useEffect(() => {
    if (jobId == null) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const stop = () => { if (timer) clearTimeout(timer); timer = null; };
    const tick = async () => {
      try {
        const data = await fetchCoursewareJob(jobId);
        if (stopped) return;
        setJob(data);
        setPollError(false);
        lastPolledAt.current = Date.now();
        const p = deriveProgress(data);
        if (p.shouldPoll) timer = setTimeout(() => { void tick(); }, p.archiving ? ARCHIVING_POLL_MS : POLL_MS);
      } catch (e) {
        if (stopped) return;
        stop();
        // 任务过期/不存在(Redis 只存 24h;mock 内存表刷新即失效)与网络波动要分开提示
        if (isJobExpired(e)) setExpired(true);
        else setPollError(true);
      }
    };
    void tick();
    return () => { stopped = true; stop(); };
  }, [jobId, pollNonce]);

  /** 大纲有未提交内容时,关标签/刷新前给一次原生确认(提交建任务后就不再拦) */
  useEffect(() => {
    const dirty = step === 2 && pages.length > 0 && !submitting;
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [step, pages.length, submitting]);

  const progress = deriveProgress(job);
  const hint = contextHint(ctx, names);
  const backToArrange = arrangePath(ctx);
  const style = useMemo(
    () => ({ id: styleId, ...(styleId === CUSTOM_STYLE_ID ? { customText: customText.trim() } : {}) }),
    [styleId, customText],
  );

  const onGenerateOutline = async () => {
    const errs = [...validateInput({ name, sourceText, pageCount }), ...validateStyle(style)];
    setErrors(errs);
    if (errs.length) return;
    setOutlining(true);
    try {
      const outlinePages = await generateOutline({
        sourceText: sourceText.trim(), pageCount, style, ...contextBody(ctx),
      });
      setPages(outlinePages);
      goStep(2);
    } catch (e) {
      toast(e instanceof Error && e.message ? e.message : '大纲生成失败,请重试', { variant: 'error' });
    } finally {
      setOutlining(false);
    }
  };

  const onConfirmOutline = async () => {
    const errs = [...validateOutline(pages), ...validateStyle(style)];
    setErrors(errs);
    if (errs.length) return;
    setSubmitting(true);
    try {
      const newJobId = await createCoursewareJob({ name: name.trim(), pages, style, ...contextBody(ctx) });
      setJob(null);
      setExpired(false);
      setRestored(false);
      // jobId + 步骤进地址栏:刷新或离开再回来能恢复到这一步继续轮询(保留 lessonId/kpNodeId)
      goStep(3, { jobId: newJobId });
    } catch (e) {
      toast(e instanceof Error && e.message ? e.message : '提交生成任务失败,请重试', { variant: 'error' });
    } finally {
      setSubmitting(false);
    }
  };

  /** 任务过期后回第 1 步重来:清掉 ?job= 与进度态 */
  const onRestart = () => {
    setJob(null);
    setExpired(false);
    setPollError(false);
    setRestored(false);
    setErrors([]);
    goStep(1, { jobId: null, replace: true });
  };

  const onRetryFailed = async () => {
    if (jobId == null) return;
    setRetrying(true);
    try {
      await retryCoursewareJob(jobId);
      toast(`已重新提交 ${progress.failedSeqs.length} 页,正在生成`);
      setPollNonce((n) => n + 1);
    } catch (e) {
      toast(e instanceof Error && e.message ? e.message : '重试失败,请稍后再试', { variant: 'error' });
    } finally {
      setRetrying(false);
    }
  };

  /**
   * 放大预览前的取新:页面在后台停留超过 STALE_JOB_MS 时,缩略图上那条签名直链多半已过期,
   * 放大后就是一张裂图。先重拉一次 job 拿最新直链;拉不到就用手上这份(总比不开好)。
   */
  const onPreparePreview = useCallback(
    async (page: CoursewareJobPageDto): Promise<CoursewareJobPageDto | null> => {
      if (jobId == null || Date.now() - lastPolledAt.current < STALE_JOB_MS) return page;
      try {
        const fresh = await fetchCoursewareJob(jobId);
        setJob(fresh);
        lastPolledAt.current = Date.now();
        return fresh.pages.find((p) => p.seq === page.seq) ?? page;
      } catch (e) {
        if (isJobExpired(e)) {
          setExpired(true);
          toast('生成任务已过期,预览不可用', { variant: 'error' });
          return null;
        }
        return page;
      }
    },
    [jobId, toast],
  );

  return (
    <div>
      <PageHead
        title="AI 生成课件"
        sub="输入文字稿 → AI 出逐页大纲 → 教师确认 → 逐页生成幻灯片图片 → 成品自动入资源库"
        actions={<Button onClick={() => navigate('/resources')}>返回资源库</Button>}
      />

      {/* 步骤指示器 */}
      <div className="mb-4 flex items-center gap-3 rounded-lg border border-line bg-card px-5 py-3.5 shadow-card">
        {STEPS.map((s, i) => (
          <Fragment key={s.n}>
            <div className="flex shrink-0 items-center gap-2">
              <span
                className={`flex h-7 w-7 items-center justify-center rounded-pill text-[13px] font-bold ${
                  step === s.n ? 'bg-primary text-card' : step > s.n ? 'bg-green-soft text-green' : 'bg-bg text-ink-3'
                }`}
              >
                {step > s.n ? '✓' : s.n}
              </span>
              <span className={`text-[13.5px] ${step === s.n ? 'font-bold text-ink' : 'text-ink-2'}`}>{s.label}</span>
            </div>
            {i < STEPS.length - 1 && <div className="h-px flex-1 bg-line" />}
          </Fragment>
        ))}
      </div>

      {hint && (
        <div className="mb-4 flex items-center gap-2 rounded-lg bg-primary-soft px-4 py-2.5 text-[13px] font-semibold text-primary">
          <span>📘</span>{hint}
        </div>
      )}

      {errors.length > 0 && (
        <div className="mb-4 flex flex-col gap-1.5 rounded-lg bg-red-soft px-4 py-3 text-[13px] font-semibold text-red">
          {errors.map((m) => <div key={m}>✕ {m}</div>)}
        </div>
      )}

      {step === 1 && (
        <Step1Input
          name={name} onName={setName}
          sourceText={sourceText} onSourceText={setSourceText}
          pageCount={pageCount} onPageCount={setPageCount}
          styleId={styleId} onStyleId={setStyleId}
          customText={customText} onCustomText={setCustomText}
          style={style} outlining={outlining} onGenerate={() => void onGenerateOutline()}
        />
      )}

      {step === 2 && (
        <Step2Outline
          pages={pages} onPages={setPages}
          styleId={styleId} style={style}
          submitting={submitting}
          onConfirm={() => void onConfirmOutline()}
          onBack={() => { setErrors([]); goStep(1); }}
        />
      )}

      {step === 3 && expired && (
        <Card title="第 3 步 · 逐页生成幻灯片">
          <EmptyState
            icon="⏳" text="任务已过期,请重新生成"
            hint="生成任务只保留一段时间(mock 模式下刷新页面即失效);已生成完成的课件仍可在资源库中找到"
            action={
              <div className="flex flex-wrap justify-center gap-2.5">
                <Button variant="primary" onClick={onRestart}>回第 1 步重新生成</Button>
                <Button onClick={() => navigate('/resources')}>去资源库查看</Button>
              </div>
            }
          />
        </Card>
      )}

      {step === 3 && !expired && (
        <Step3Progress
          job={job}
          progress={progress}
          name={name}
          restored={restored}
          style={style}
          pollError={pollError}
          retrying={retrying}
          onReload={() => setPollNonce((n) => n + 1)}
          onRetryFailed={() => void onRetryFailed()}
          onGoResources={() => navigate('/resources')}
          backToArrange={backToArrange}
          onBackToArrange={() => backToArrange && navigate(backToArrange)}
          onPreparePreview={onPreparePreview}
        />
      )}
    </div>
  );
}
