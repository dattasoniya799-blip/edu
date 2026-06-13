/**
 * 资源库(原型 v0.4 id=t-res)
 * 课件、讲义、视频统一存放,显示被哪些讲次引用(usedByLessons 反查),编排课堂时挂载到讲次。
 * FIX2 问题3:此页原属分工缝隙(B3=题库、B4=course/lesson/paper/grading/monitor,/resources 无人认领),
 *   后端 A4 已实现 /resources;此处按 A4 契约形状走 createClient + mock 补齐前端页面。
 * 数据:GET /resources(分页 + type 过滤)· POST /resources(两步直传后落库)· DELETE /resources/{id}
 */
import { useEffect, useRef, useState } from 'react';
import type { ResourceDto, ResourceType } from '@qiming/contracts';
import { Button, EmptyState, Skeleton, Tag, useToast } from '@qiming/ui';
import { api } from '../../api';
import { PageHead } from '../Shell';
import { ACCEPT_RESOURCE, TYPE_META, formatResourceMeta, formatUsedBy } from './lib/resource';

const PAGE_SIZE = 12;

/** 直传两步流第 2 步(预签名 PUT 不属 openapi,与 A3 同口径用唯一允许的原生 fetch;mock 由 msw 拦截) */
async function uploadResource(file: File): Promise<{ ossKey: string }> {
  const sts = await api.post('/uploads/sts', { body: { purpose: 'resource', fileName: file.name } });
  const { uploadUrl, ossKey } = sts.data;
  const res = await fetch(uploadUrl, { method: 'PUT', body: file });
  if (!res.ok) throw new Error(`资源直传失败(HTTP ${res.status})`);
  return { ossKey };
}

/** 由文件扩展名/MIME 猜测资源类型(MVP:ppt/pdf/video/image) */
function guessType(file: File): ResourceType {
  const name = file.name.toLowerCase();
  if (name.endsWith('.pdf') || file.type === 'application/pdf') return 'pdf';
  if (name.endsWith('.ppt') || name.endsWith('.pptx')) return 'ppt';
  if (file.type.startsWith('video/') || name.endsWith('.mp4')) return 'video';
  return 'image';
}

const TYPE_TABS: { value: '' | ResourceType; label: string }[] = [
  { value: '', label: '全部' },
  { value: 'ppt', label: 'PPT' },
  { value: 'pdf', label: 'PDF' },
  { value: 'video', label: '视频' },
  { value: 'interactive', label: '互动' },
  { value: 'image', label: '图片' },
];

export function ResourcesPage() {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const [type, setType] = useState<'' | ResourceType>('');
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<ResourceDto[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false); // REV-front #2:加载失败(可重试)区别于空态
  const [uploading, setUploading] = useState(false);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    setLoading(true);
    setError(false);
    api.get('/resources', { query: { page, size: PAGE_SIZE, ...(type ? { type } : {}) } })
      .then((r) => { setItems(r.data.items); setTotal(r.data.total); })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [type, page, refresh]);

  const onPickFile = async (file: File) => {
    setUploading(true);
    try {
      const { ossKey } = await uploadResource(file);
      await api.post('/resources', {
        body: { type: guessType(file), name: file.name, ossKey, size: file.size, meta: {} },
      });
      toast('资源已上传,可在「编排课堂」时挂载到讲次');
      setPage(1);
      setRefresh((n) => n + 1);
    } catch (e) {
      toast(e instanceof Error ? e.message : '上传失败');
    } finally {
      setUploading(false);
    }
  };

  const onDelete = async (r: ResourceDto) => {
    if (!window.confirm(`确认删除「${r.name}」?`)) return;
    try {
      await api.del('/resources/{id}', { params: { id: r.id } });
      toast('资源已删除');
      setRefresh((n) => n + 1);
    } catch (e) {
      // REV-front #2:按后端返回的 message 显示(如被引用约束),不再硬编码原因
      toast(e instanceof Error && e.message ? e.message : '删除失败,请重试');
    }
  };

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div>
      <PageHead
        title="资源库"
        sub="课件、讲义、视频统一存放,在「编排课堂」时挂载到讲次 · 每个资源显示被哪些讲次引用"
        actions={
          <Button variant="primary" disabled={uploading} onClick={() => fileRef.current?.click()}>
            {uploading ? '上传中…' : '↑ 上传资源'}
          </Button>
        }
      />
      <input
        ref={fileRef}
        type="file"
        accept={ACCEPT_RESOURCE}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void onPickFile(file);
          e.target.value = '';
        }}
      />

      {/* 类型筛选(原型 .res-folder) */}
      <div className="mb-4 flex flex-wrap gap-1.5">
        {TYPE_TABS.map((t) => (
          <button
            key={t.value || 'all'}
            type="button"
            onClick={() => { setType(t.value); setPage(1); }}
            className={`rounded-[9px] px-3 py-1.5 text-[12.5px] font-semibold transition-colors ${
              type === t.value ? 'bg-primary text-card' : 'bg-card text-ink-2 hover:text-ink border border-line'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3.5">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-44 w-full" />)}
        </div>
      ) : error ? (
        <div className="rounded-lg border border-line bg-card shadow-card">
          <EmptyState icon="⚠" text="资源加载失败" hint="可能是网络波动,请重试"
            action={<Button variant="primary" onClick={() => setRefresh((n) => n + 1)}>重新加载</Button>} />
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-lg border border-line bg-card shadow-card">
          <EmptyState
            text={type ? '该类型下还没有资源' : '资源库还是空的'}
            hint="点击右上角「上传资源」添加课件、讲义或视频,上传后可在编排课堂时挂载到讲次"
            action={<Button variant="primary" onClick={() => fileRef.current?.click()}>↑ 上传资源</Button>}
          />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3.5">
            {items.map((r) => {
              const meta = TYPE_META[r.type];
              const used = formatUsedBy(r);
              return (
                <div key={r.id} className="flex flex-col overflow-hidden rounded-lg border border-line bg-card shadow-card">
                  <div className="relative flex h-[104px] items-center justify-center bg-bg text-[34px] text-ink-3">
                    <Tag tone={meta.tone} className="absolute left-2.5 top-2.5">{meta.label}</Tag>
                    {meta.icon}
                  </div>
                  <div className="flex flex-1 flex-col gap-1.5 p-3.5">
                    <b className="truncate text-[14px]" title={r.name}>{r.name}</b>
                    <div className="text-[12px] tabular-nums text-ink-3">{formatResourceMeta(r)}</div>
                    <div className={`text-[12px] ${used.referenced ? 'text-ink-2' : 'text-orange'}`}>{used.text}</div>
                    <div className="mt-auto flex items-center gap-3.5 pt-1.5 text-[13px] font-semibold">
                      <span className="text-ink-3">挂载到讲次</span>
                      {!used.referenced && (
                        <button type="button" className="ml-auto text-red" onClick={() => onDelete(r)}>删除</button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {pageCount > 1 && (
            <div className="mt-4 flex items-center justify-between text-[12.5px] text-ink-2">
              <span className="tabular-nums">共 {total} 个资源</span>
              <div className="flex gap-1.5">
                {Array.from({ length: pageCount }, (_, i) => i + 1).map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPage(p)}
                    className={`h-7 w-7 rounded-lg border text-[12.5px] tabular-nums ${
                      p === page ? 'border-primary bg-primary text-card' : 'border-line text-ink-2 hover:border-ink-3'
                    }`}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
