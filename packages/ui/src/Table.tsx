import type { ReactNode } from 'react';
import { EmptyState } from './EmptyState';

export interface TableColumn<T> {
  key: string;
  title: ReactNode;
  render?: (row: T, index: number) => ReactNode;
  className?: string;
}

export interface TableProps<T> {
  columns: TableColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string | number;
  /** 空态文案(基线:每个列表必须有空态) */
  emptyText?: string;
  loading?: boolean;
  className?: string;
}

/** 表头 12px ink-2 灰底,行 hover 微底色(基线表格规约;灰底由 bg token 派生) */
export function Table<T>({ columns, rows, rowKey, emptyText = '暂无数据', loading, className = '' }: TableProps<T>) {
  if (loading) {
    return (
      <div className={`animate-pulse space-y-2 p-4 ${className}`} aria-label="加载中">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-9 rounded-md bg-bg" />
        ))}
      </div>
    );
  }
  if (!rows.length) return <EmptyState text={emptyText} />;
  return (
    <table className={`w-full border-collapse text-sm tabular-nums ${className}`}>
      <thead>
        <tr className="bg-bg/50">
          {columns.map((c) => (
            <th key={c.key} className={`px-4 py-2.5 text-left text-xs font-semibold text-ink-2 border-b border-line ${c.className ?? ''}`}>
              {c.title}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={rowKey(row)} className="hover:bg-bg/40 transition-colors">
            {columns.map((c) => (
              <td key={c.key} className={`px-4 py-3 border-b border-line text-ink ${c.className ?? ''}`}>
                {c.render ? c.render(row, i) : String((row as Record<string, unknown>)[c.key] ?? '')}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
