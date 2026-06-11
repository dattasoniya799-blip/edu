export interface SkeletonProps {
  /** 单块的尺寸类(默认 h-5 w-full) */
  className?: string;
  /** 重复块数 */
  lines?: number;
}

/** 加载骨架(基线:每页必须有加载骨架) */
export function Skeleton({ className = 'h-5 w-full', lines = 1 }: SkeletonProps) {
  if (lines <= 1) return <div className={`animate-pulse rounded-md bg-bg ${className}`} aria-label="加载中" />;
  return (
    <div className="animate-pulse space-y-2.5" aria-label="加载中">
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} className={`rounded-md bg-bg ${className}`} />
      ))}
    </div>
  );
}
