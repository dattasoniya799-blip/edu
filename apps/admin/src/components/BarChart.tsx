/** 柱状图(原型 .bars:普通柱 primary/20,高亮柱 primary 渐变,标签 11px ink-3) */
export interface BarChartItem {
  label: string;
  value: number;
  hi?: boolean;
}

export function BarChart({ data, height = 150 }: { data: BarChartItem[]; height?: number }) {
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <div className="flex items-end gap-2.5 pt-2.5" style={{ height }}>
      {data.map((d) => (
        <div key={d.label} className="flex h-full flex-1 flex-col items-center justify-end gap-1.5">
          <div
            className={`w-full max-w-[34px] rounded-t-[7px] ${d.hi ? 'bg-gradient-to-b from-primary to-primary-deep' : 'bg-primary/20'}`}
            style={{ height: `${Math.max(4, (d.value / max) * 100)}%` }}
            title={`${d.label}:${d.value}`}
          />
          <small className="whitespace-nowrap text-[11px] text-ink-3">{d.label}</small>
        </div>
      ))}
    </div>
  );
}
