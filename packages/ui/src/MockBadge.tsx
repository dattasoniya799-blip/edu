/**
 * MOCK 数据角标(FIX4-front #5,P2-9 防混淆):三端通用。
 * mock 模式(VITE_USE_MOCK === 'true')时在右下角显示一个不挡操作的小角标,
 * 提醒当前是演示数据而非真实库;真实模式(未设 / 非 'true')不渲染。
 * 颜色仅取 design-tokens(orange / orange-soft)。
 */

function isMockMode(): boolean {
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
  return env?.VITE_USE_MOCK === 'true';
}

export interface MockBadgeProps {
  className?: string;
}

export function MockBadge({ className }: MockBadgeProps) {
  if (!isMockMode()) return null;
  return (
    <div
      // pointer-events-none:不拦截任何点击;固定右下角,避开主要操作区
      className={`pointer-events-none fixed bottom-3 right-3 z-[80] select-none rounded-pill border border-orange bg-orange-soft px-2.5 py-1 text-[11px] font-bold tracking-wide text-orange shadow-card ${className ?? ''}`}
      aria-hidden
      data-testid="mock-badge"
    >
      MOCK 数据
    </div>
  );
}
