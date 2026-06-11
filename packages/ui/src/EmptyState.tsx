import type { ReactNode } from 'react';

export interface EmptyStateProps {
  /** 简笔图标(字符即可,基线:居中 text3 文案 + 简笔图标) */
  icon?: ReactNode;
  text: ReactNode;
  hint?: ReactNode;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ icon = '▢', text, hint, action, className = '' }: EmptyStateProps) {
  return (
    <div className={`flex flex-col items-center justify-center gap-2 py-14 text-center ${className}`}>
      <div className="text-[28px] text-ink-3">{icon}</div>
      <div className="text-[13.5px] text-ink-3">{text}</div>
      {hint && <div className="text-xs text-ink-3">{hint}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
