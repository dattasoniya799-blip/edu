/** 分页条(原型 .pager:「第 x-y 条,共 n 条」+ 页码按钮,当前页 primary 实底) */
import { pageWindow } from '../lib/paging';

export interface PagerProps {
  page: number;
  size: number;
  total: number;
  onChange: (page: number) => void;
}

export function Pager({ page, size, total, onChange }: PagerProps) {
  const pages = Math.max(1, Math.ceil(total / size));
  if (total <= 0) return null;
  const from = (page - 1) * size + 1;
  const to = Math.min(total, page * size);
  return (
    <div className="flex items-center justify-between px-4 py-3 text-[12.5px] text-ink-2">
      <span className="tabular-nums">第 {from}-{to} 条,共 {total} 条</span>
      <div className="flex gap-1.5">
        {pageWindow(page, pages).map((n, i) =>
          n === '…' ? (
            <span key={`gap-${i}`} className="flex h-7 w-7 items-center justify-center text-ink-3">…</span>
          ) : (
            <button
              key={n}
              type="button"
              onClick={() => onChange(n)}
              className={`h-7 w-7 rounded-[8px] border text-[12.5px] tabular-nums transition-colors ${
                n === page ? 'border-primary bg-primary font-bold text-card' : 'border-line bg-card text-ink-2 hover:border-ink-3'
              }`}
            >
              {n}
            </button>
          ),
        )}
      </div>
    </div>
  );
}
