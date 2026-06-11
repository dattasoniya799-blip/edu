import type { ReactNode } from 'react';

export interface CardProps {
  /** 卡片标题(15px/700,基线规约) */
  title?: ReactNode;
  /** 头部右侧动作区(如「查看全部 →」) */
  extra?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}

export function Card({ title, extra, children, className = '', bodyClassName = '' }: CardProps) {
  return (
    <div className={`bg-card border border-line rounded-lg shadow-card ${className}`}>
      {(title || extra) && (
        <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-line">
          <h3 className="text-[15px] font-bold text-ink">{title}</h3>
          {extra && <div className="text-[13px] text-ink-2">{extra}</div>}
        </div>
      )}
      <div className={`p-5 ${bodyClassName}`}>{children}</div>
    </div>
  );
}
