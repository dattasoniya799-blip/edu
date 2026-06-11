import { useEffect, useState } from 'react';
import { toString as qrToString } from 'qrcode';

export interface QrCodeProps {
  /** 编码内容(如平板登录码的 ticket token) */
  value: string;
  /** 渲染边长(px) */
  size?: number;
  className?: string;
}

/**
 * 二维码(qrcode 库 → SVG data URI,矢量清晰、可扫)
 * 生成中显示骨架,生成失败显示文案(基线:状态必须可见)
 */
export function QrCode({ value, size = 180, className = '' }: QrCodeProps) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    setSrc(null);
    setFailed(false);
    qrToString(value, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' })
      .then((svg) => { if (alive) setSrc(`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`); })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [value]);

  if (failed) {
    return (
      <div className={`flex items-center justify-center rounded-md bg-bg text-xs text-ink-3 ${className}`} style={{ width: size, height: size }}>
        二维码生成失败
      </div>
    );
  }
  if (!src) {
    return <div className={`animate-pulse rounded-md bg-bg ${className}`} style={{ width: size, height: size }} aria-label="二维码生成中" />;
  }
  return <img src={src} width={size} height={size} className={className} alt="登录二维码" />;
}
