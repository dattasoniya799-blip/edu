/**
 * 卡片内容壳。
 * 卡纸(米白底 + 手绘描边)由画布底座的 embeddable 元素画,所以这里**不能上不透明背景**,
 * 否则画在卡纸之上的红圈会被 DOM 盖住(见 board/ExcalidrawBoard.tsx 的注释)。
 */
import type { ReactNode } from 'react';

export function CardBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={`card-body${className ? ` ${className}` : ''}`}>{children}</div>;
}

/** 紫色手写 + 黄马克笔的卡内标题(列标题走画布的 text 元素,不用这个)。 */
export function MarkerTitle({ children }: { children: ReactNode }) {
  return <span className="card-title">{children}</span>;
}
