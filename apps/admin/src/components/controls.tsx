/** 表单/工具栏基础控件(原型 .toolbar / .field 形态;颜色全部来自 token 类) */
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';

const box =
  'rounded-[10px] border-[1.5px] border-line bg-card px-3 py-2 text-[13px] text-ink outline-none transition-colors placeholder:text-ink-3 focus:border-primary disabled:opacity-50';

export function TextInput({ className = '', ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`${box} ${className}`} {...rest} />;
}

export function Select({ className = '', children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={`${box} ${className}`} {...rest}>
      {children}
    </select>
  );
}

/** 模态表单字段:label + 控件 + 行内错误(红字) */
export function Field({ label, error, children }: { label: ReactNode; error?: string; children: ReactNode }) {
  return (
    <label className="flex min-w-0 flex-1 flex-col gap-1.5 text-[12.5px] font-semibold text-ink-2">
      {label}
      {children}
      {error && <span className="text-xs font-normal text-red">{error}</span>}
    </label>
  );
}

/** 一行两字段(原型 .frow) */
export function FormRow({ children }: { children: ReactNode }) {
  return <div className="flex gap-3">{children}</div>;
}

/** 模态底部说明(原型 .role-note) */
export function RoleNote({ children }: { children: ReactNode }) {
  return <div className="mt-3 rounded-[10px] bg-bg px-3.5 py-2.5 text-xs leading-relaxed text-ink-2">{children}</div>;
}

/** 表格行内操作文字链(原型 .link;危险操作用 danger) */
export function LinkButton({ danger, className = '', children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { danger?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      className={`text-[13px] font-medium ${danger ? 'text-red' : 'text-primary'} hover:underline disabled:opacity-50 ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

/** 列表卡工具栏(原型 .toolbar:卡片顶部一行筛选) */
export function Toolbar({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap gap-2.5 border-b border-line px-4 py-3.5">{children}</div>;
}
