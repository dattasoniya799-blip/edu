import type { ButtonHTMLAttributes, ReactNode } from 'react';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** primary=主按钮实底带投影;secondary=白底 1.5px 线框;danger-link=危险操作文字链(基线规约) */
  variant?: 'primary' | 'secondary' | 'danger-link';
  block?: boolean;
  /** 提交中:自动 disabled(防重复提交)并在文案前显示转圈 */
  loading?: boolean;
  children: ReactNode;
}

export function Button({
  variant = 'secondary', block, loading = false, disabled, className = '', children, ...rest
}: ButtonProps) {
  const base = 'rounded-[10px] text-[13.5px] font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed';
  const styles = {
    primary: 'px-4 py-[9px] bg-primary text-card border-[1.5px] border-primary shadow-btn-sm hover:bg-primary-deep',
    secondary: 'px-4 py-[9px] bg-card text-ink border-[1.5px] border-line hover:border-ink-3',
    'danger-link': 'px-1 py-0 text-red text-[13px] font-medium hover:underline',
  } as const;
  return (
    <button
      type="button"
      className={`${base} ${styles[variant]} ${block ? 'w-full' : ''} ${loading ? 'inline-flex items-center justify-center gap-1.5' : ''} ${className}`}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading && <Spinner />}
      {children}
    </button>
  );
}

/** 纯 CSS 转圈(currentColor 描边,自动跟随按钮前景色) */
function Spinner() {
  return (
    <span
      aria-hidden="true"
      className="inline-block h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-current border-r-transparent align-[-1px]"
    />
  );
}
