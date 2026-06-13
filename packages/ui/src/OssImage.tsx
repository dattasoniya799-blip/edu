/**
 * 单张题目插图渲染(REV-front #1):把 ossKey 经 resolveSrc 解析为可加载 URL 后出 <img>。
 *
 * resolveSrc 可同步(已是直链 / mock 占位)也可异步(真实模式两跳换签名直链):
 * - 同步返回 string → 直接出图(SSR 友好,renderToStaticMarkup 即可见,占位测试不破);
 * - 返回 Promise → 先 loading 占位(脉冲框),解析完成再换 <img>,失败/为 null → 占位框。
 * 解析按 resolveSrc 自身的缓存语义复用(见 oss.ts resolveOssUrlAsync 的 ossKey 缓存)。
 */
import { useEffect, useState } from 'react';
import { defaultResolveSrc } from './QuestionFigure';
import type { FigureSrcResolver } from './oss';

function isThenable(v: unknown): v is Promise<string | null> {
  return !!v && typeof (v as { then?: unknown }).then === 'function';
}

export interface OssImageProps {
  ossKey: string;
  alt: string;
  /** ossKey → 可加载 URL;默认仅识别 http/data/blob(同步) */
  resolveSrc?: FigureSrcResolver;
  /** <img> 的 className(尺寸/边框) */
  className?: string;
  /** loading / 占位框的 className(尺寸);省略时按 compact 取默认 */
  boxClassName?: string;
  /** 紧凑模式:更小的默认占位框 */
  compact?: boolean;
}

export function OssImage({ ossKey, alt, resolveSrc = defaultResolveSrc, className, boxClassName, compact }: OssImageProps) {
  // 首次同步求值:同步结果直接作为初始 src(SSR 即出图);异步则先进 loading
  const first = resolveSrc(ossKey);
  const syncSrc = isThenable(first) ? null : first;
  const [src, setSrc] = useState<string | null>(syncSrc);
  const [loading, setLoading] = useState<boolean>(isThenable(first));

  useEffect(() => {
    let alive = true;
    const r = resolveSrc(ossKey);
    if (isThenable(r)) {
      setLoading(true);
      r.then((u) => { if (alive) { setSrc(u); setLoading(false); } })
        .catch(() => { if (alive) { setSrc(null); setLoading(false); } });
    } else {
      setSrc(r);
      setLoading(false);
    }
    return () => { alive = false; };
  }, [ossKey, resolveSrc]);

  const box = boxClassName ?? (compact ? 'h-12 w-16' : 'h-[120px] w-[160px]');

  if (loading) {
    return (
      <span
        className={`inline-flex animate-pulse items-center justify-center rounded-md border border-line bg-bg text-ink-3 ${box}`}
        aria-label="插图加载中"
        data-figure-loading
      >
        <span aria-hidden>…</span>
      </span>
    );
  }
  if (!src) {
    return (
      <span
        className={`inline-flex items-center gap-1.5 rounded-[7px] bg-primary-soft px-2 py-1 text-primary ${compact ? 'text-[11px]' : 'text-xs'}`}
        title={ossKey}
      >
        <span aria-hidden>⛶</span> {alt}
      </span>
    );
  }
  return <img src={src} alt={alt} className={className} />;
}
