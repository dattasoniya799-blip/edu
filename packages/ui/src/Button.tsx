import type { ButtonHTMLAttributes, ReactNode } from 'react';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** primary=主按钮实底带投影;secondary=白底 1.5px 线框;danger-link=危险操作文字链(基线规约) */
  variant?: 'primary' | 'secondary' | 'danger-link';
  block?: boolean;
  children: ReactNode;
}

export function Button({ variant = 'secondary', block, className = '', children, ...rest }: ButtonProps) {
  const base = 'rounded-[10px] text-[13.5px] font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed';
  const styles = {
    primary: 'px-4 py-[9px] bg-primary text-card border-[1.5px] border-primary shadow-btn-sm hover:bg-primary-deep',
    secondary: 'px-4 py-[9px] bg-card text-ink border-[1.5px] border-line hover:border-ink-3',
    'danger-link': 'px-1 py-0 text-red text-[13px] font-medium hover:underline',
  } as const;
  return (
    <button type="button" className={`${base} ${styles[variant]} ${block ? 'w-full' : ''} ${className}`} {...rest}>
      {children}
    </button>
  );
}
