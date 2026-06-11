import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';

/** 设计视口:1180×820 平板横屏(任务卡 B1);整体等比缩放适配实际窗口 */
export const STAGE_W = 1180;
export const STAGE_H = 820;

export function Stage({ children }: { children: ReactNode }) {
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const onResize = () =>
      setScale(Math.min(window.innerWidth / STAGE_W, window.innerHeight / STAGE_H, 1));
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return (
    <div className="flex min-h-screen items-center justify-center overflow-hidden bg-ink/90">
      <div
        className="flex flex-col overflow-hidden rounded-[17px] bg-bg shadow-card"
        style={{ width: STAGE_W, height: STAGE_H, transform: `scale(${scale})`, transformOrigin: 'center' }}
      >
        {children}
      </div>
    </div>
  );
}
