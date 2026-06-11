import type { ReactNode } from 'react';

export interface StatCardProps {
  /** 顶部色带(语义 token) */
  ribbon?: 'primary' | 'violet' | 'green' | 'orange' | 'red';
  label: ReactNode;
  value: ReactNode;
  /** 底部说明,如「↑ 本月新增 2 人」 */
  delta?: ReactNode;
  deltaTone?: 'up' | 'plain';
  className?: string;
}

/** 统计四卡(原型 .stats > .stat) */
export function StatCard({ ribbon = 'primary', label, value, delta, deltaTone = 'plain', className = '' }: StatCardProps) {
  const ribbons = { primary: 'bg-primary', violet: 'bg-violet', green: 'bg-green', orange: 'bg-orange', red: 'bg-red' };
  return (
    <div className={`relative overflow-hidden rounded-lg border border-line bg-card p-5 shadow-card ${className}`}>
      <div className={`absolute left-0 top-0 h-1 w-full ${ribbons[ribbon]}`} />
      <div className="text-xs text-ink-2">{label}</div>
      <div className="mt-1.5 text-[26px] font-extrabold tabular-nums text-ink">{value}</div>
      {delta && <div className={`mt-1 text-xs ${deltaTone === 'up' ? 'text-green' : 'text-ink-3'}`}>{delta}</div>}
    </div>
  );
}
