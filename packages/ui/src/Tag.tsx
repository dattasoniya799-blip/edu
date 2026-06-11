import type { ReactNode } from 'react';

export type TagTone = 'primary' | 'green' | 'orange' | 'red' | 'violet' | 'gray';

export interface TagProps {
  tone?: TagTone;
  children: ReactNode;
  className?: string;
}

/** 状态胶囊:soft 底 + 语义色字(基线「.tag」规约);AI 相关一律 violet */
export function Tag({ tone = 'gray', children, className = '' }: TagProps) {
  const tones: Record<TagTone, string> = {
    primary: 'bg-primary-soft text-primary',
    green: 'bg-green-soft text-green',
    orange: 'bg-orange-soft text-orange',
    red: 'bg-red-soft text-red',
    violet: 'bg-violet-soft text-violet',
    gray: 'bg-bg text-ink-2',
  };
  return (
    <span className={`inline-flex items-center rounded-pill px-2.5 py-0.5 text-xs font-semibold ${tones[tone]} ${className}`}>
      {children}
    </span>
  );
}
