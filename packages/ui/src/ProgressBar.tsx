export interface ProgressBarProps {
  /** 0–100 */
  value: number;
  /** 缺省按基线规则取色:绿(≥80)/ 主色(60–79)/ 红(<60) */
  tone?: 'auto' | 'green' | 'primary' | 'orange' | 'red';
  className?: string;
}

export function ProgressBar({ value, tone = 'auto', className = '' }: ProgressBarProps) {
  const v = Math.max(0, Math.min(100, value));
  const auto = v >= 80 ? 'green' : v >= 60 ? 'primary' : 'red';
  const t = tone === 'auto' ? auto : tone;
  const fill = { green: 'bg-green', primary: 'bg-primary', orange: 'bg-orange', red: 'bg-red' }[t];
  return (
    <div
      className={`h-1.5 w-full overflow-hidden rounded-pill bg-bg ${className}`}
      role="progressbar"
      aria-valuenow={v}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className={`h-full rounded-pill transition-all ${fill}`} style={{ width: `${v}%` }} />
    </div>
  );
}
