/**
 * 向导第 3 步 · 逐页生成进度(由 CoursewareWizardPage 拆出)
 * 含进度条、失败页重试、页面缩略图与放大预览。
 * 放大预览的签名直链有有效期:距上次轮询超过 STALE_JOB_MS 时先重拉一次 job 再展示,
 * 否则页面在后台停留很久后点开预览大概率吃 403(图片直接裂开)。
 */
import { useState } from 'react';
import type { CoursewareJobDto, CoursewareJobPageDto, CoursewareStyleInput } from '@qiming/contracts';
import { Button, Card, EmptyState, Modal, ProgressBar, Skeleton, Tag } from '@qiming/ui';
import { PAGE_STATUS_LABEL, progressText, type JobProgress } from '../lib/progress';
import { styleLabel } from '../lib/styles';

export interface Step3ProgressProps {
  job: CoursewareJobDto | null;
  progress: JobProgress;
  /** 本次会话填的课件名(靠 ?job= 恢复时不可信,由 restored 控制展示) */
  name: string;
  restored: boolean;
  style: CoursewareStyleInput;
  pollError: boolean;
  retrying: boolean;
  onReload: () => void;
  onRetryFailed: () => void;
  onGoResources: () => void;
  backToArrange: string | null;
  onBackToArrange: () => void;
  /**
   * 打开预览前的取新:返回该页最新数据(签名直链可能已刷新);
   * 距上次轮询很近时父页直接返回原页,不发请求。
   */
  onPreparePreview: (page: CoursewareJobPageDto) => Promise<CoursewareJobPageDto | null>;
}

export function Step3Progress({
  job, progress, name, restored, style, pollError, retrying,
  onReload, onRetryFailed, onGoResources, backToArrange, onBackToArrange, onPreparePreview,
}: Step3ProgressProps) {
  const [preview, setPreview] = useState<CoursewareJobPageDto | null>(null);
  const [previewLoadingSeq, setPreviewLoadingSeq] = useState<number | null>(null);

  const openPreview = async (page: CoursewareJobPageDto) => {
    setPreviewLoadingSeq(page.seq);
    try {
      const fresh = await onPreparePreview(page);
      setPreview(fresh ?? page);
    } finally {
      setPreviewLoadingSeq(null);
    }
  };

  return (
    <div className="flex flex-col gap-3.5">
      <Card title="第 3 步 · 逐页生成幻灯片">
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <b className="text-[14px]">{name.trim() || (restored ? '本次生成任务' : '未命名课件')}</b>
            {!restored && <Tag>{styleLabel(style)}</Tag>}
            {progress.finished && <Tag tone="green">已完成</Tag>}
            {progress.archiving && <Tag tone="violet">入库中</Tag>}
            {job?.status === 'failed' && <Tag tone="red">有失败页</Tag>}
            {(job?.status === 'queued' || job?.status === 'running') && <Tag tone="violet">生成中</Tag>}
            <span className="ml-auto text-[13px] tabular-nums text-ink-2">已生成 {progress.done}/{progress.total} 页</span>
          </div>
          <ProgressBar value={progress.percent} tone={progress.finished ? 'green' : 'primary'} />
          <div className="text-[13px] text-ink-2">{progressText(job)}</div>
          {pollError && (
            <div className="flex items-center gap-3 rounded-md bg-red-soft px-3.5 py-2.5 text-[13px] font-semibold text-red">
              进度读取失败(可能是网络波动)
              <button type="button" className="text-[13px] font-semibold text-primary hover:underline" onClick={onReload}>重新读取</button>
            </div>
          )}
          {progress.canRetry && (
            <div className="flex flex-wrap items-center gap-3 rounded-md bg-red-soft px-3.5 py-2.5">
              <span className="text-[13px] font-semibold text-red">
                第 {progress.failedSeqs.join('、')} 页生成失败
              </span>
              <Button variant="primary" loading={retrying} onClick={onRetryFailed}>
                {retrying ? '重试中…' : '重试失败页'}
              </Button>
            </div>
          )}
        </div>
      </Card>

      <Card title={<span>页面预览 <span className="text-[12px] font-normal text-ink-3">(点击已生成的页可放大)</span></span>}>
        {progress.total === 0 ? (
          <Skeleton lines={2} className="h-24 w-full" />
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3">
            {(job?.pages ?? []).map((p) => (
              <PageTile key={p.seq} page={p} loading={previewLoadingSeq === p.seq} onOpen={() => void openPreview(p)} />
            ))}
          </div>
        )}
      </Card>

      {progress.archiving && (
        <Card title="即将完成">
          <div className="text-[13px] text-ink-2">
            全部 {progress.total} 页图片已生成,成品正在存入资源库,稍等片刻这里会出现「去资源库查看」。
          </div>
        </Card>
      )}

      {progress.finished && (
        <Card title="生成完成">
          <div className="flex flex-col gap-3">
            <div className="text-[13px] text-ink-2">
              {name.trim() ? `《${name.trim()}》` : '本套课件'}共 {progress.total} 页已生成完成,并已存入资源库(课件类型),可在编排课堂时挂到讲解环节。
            </div>
            <div className="flex flex-wrap gap-2.5">
              <Button variant="primary" onClick={onGoResources}>去资源库查看</Button>
              {backToArrange && <Button onClick={onBackToArrange}>返回编排课堂</Button>}
            </div>
          </div>
        </Card>
      )}

      {/* 放大预览 */}
      <Modal
        open={preview != null}
        title={preview ? `第 ${preview.seq} 页 · ${preview.title}` : ''}
        width={980}
        onClose={() => setPreview(null)}
      >
        {preview?.imageUrl
          ? <img src={preview.imageUrl} alt={`第 ${preview.seq} 页 ${preview.title}`} className="w-full rounded-md border border-line" />
          : <EmptyState icon="▢" text="该页还没有生成图片" />}
      </Modal>
    </div>
  );
}

/** 单页缩略图:已生成显示图片,生成中显示骨架,失败红色标记 */
function PageTile({ page, loading, onOpen }: { page: CoursewareJobPageDto; loading: boolean; onOpen: () => void }) {
  // 契约里 imageUrl 是 string | null | undefined(未完成时缺省或 null)
  const imageUrl = page.imageUrl ?? undefined;
  const done = page.status === 'done' && !!imageUrl;
  const failed = page.status === 'failed';
  return (
    <div className={`overflow-hidden rounded-lg border ${failed ? 'border-red' : 'border-line'} bg-card`}>
      {/* 横版幻灯片比例:与生成图实际尺寸 1264×848 一致(见 mocks/data.ts SLIDE_WIDTH) */}
      <div className="relative aspect-[1264/848] bg-bg">
        {done ? (
          <button type="button" onClick={onOpen} className="h-full w-full" aria-label={`放大第 ${page.seq} 页`} aria-busy={loading || undefined}>
            <img src={imageUrl} alt={`第 ${page.seq} 页 ${page.title}`} className={`h-full w-full object-contain ${loading ? 'opacity-60' : ''}`} />
          </button>
        ) : failed ? (
          <div className="flex h-full w-full flex-col items-center justify-center gap-1.5 bg-red-soft text-red">
            <span className="text-[22px]">✕</span>
            <span className="text-[12px] font-semibold">生成失败</span>
          </div>
        ) : (
          <div className="flex h-full w-full items-center justify-center p-3">
            <Skeleton className="h-full w-full" />
          </div>
        )}
      </div>
      <div className="flex flex-col gap-0.5 px-2.5 py-2">
        <div className="truncate text-[12.5px] font-semibold" title={page.title}>{page.seq}. {page.title}</div>
        <div className={`text-[11.5px] ${failed ? 'text-red' : done ? 'text-green' : 'text-ink-3'}`}>
          {loading ? '正在获取最新预览…' : PAGE_STATUS_LABEL[page.status]}
        </div>
      </div>
    </div>
  );
}
