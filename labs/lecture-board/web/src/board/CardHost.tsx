/**
 * embeddable 里的那层壳:量高 + 量每个 fx 目标在卡内的偏移 + 150 ms 淡入。
 * 纯 React,不 import excalidraw(适配层只把它塞进 renderEmbeddable)。
 */
import { useEffect, useRef, type ReactNode } from 'react';

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface CardMetrics {
  height: number;
  /** data-fx-target → 卡内偏移(布局像素,不受画布 scale 影响) */
  parts: Map<string, Box>;
}

/**
 * 量出元素在卡内的盒子(布局坐标,画布 scale 变了也不用重算)。
 * 块级元素(整卡 / 板书行 / 审题条目)用 offsetTop/offsetLeft 累加就行;
 * 题干里的 mark 是行内 span,题干句子一长就会跨行——offsetWidth/offsetHeight
 * 对跨行的行内元素给的是「首行左上角到末行右下角」的诡异大框,红圈会飘到文字外面去。
 * 用 getClientRects() 挑占比最大的那一段(通常就是没跨行的那一整段,跨了行也只圈住主体那一行),
 * 再用 root 的「视口宽度 / 布局宽度」比例换回布局像素——跟 board/ExcalidrawBoard.tsx 的
 * snippetBox() 是同一个换算口径,只是这里不需要现搜文字,元素自己就是那个目标。
 */
function offsetWithin(el: HTMLElement, root: HTMLElement): Box {
  const rects = Array.from(el.getClientRects());
  if (!rects.length) {
    let top = 0;
    let left = 0;
    let node: HTMLElement | null = el;
    while (node && node !== root) {
      top += node.offsetTop;
      left += node.offsetLeft;
      node = node.offsetParent as HTMLElement | null;
    }
    return { top, left, width: el.offsetWidth, height: el.offsetHeight };
  }
  const rect = rects.reduce((best, r) => (r.width * r.height > best.width * best.height ? r : best));
  const rootRect = root.getBoundingClientRect();
  const scale = rootRect.width && root.offsetWidth ? rootRect.width / root.offsetWidth : 1;
  return {
    top: (rect.top - rootRect.top) / scale,
    left: (rect.left - rootRect.left) / scale,
    width: rect.width / scale,
    height: rect.height / scale,
  };
}

export function measureCard(root: HTMLElement): CardMetrics {
  const parts = new Map<string, Box>();
  for (const el of Array.from(root.querySelectorAll<HTMLElement>('[data-fx-target]'))) {
    const target = el.dataset.fxTarget;
    if (target) parts.set(target, offsetWithin(el, root));
  }
  return { height: root.offsetHeight, parts };
}

export function CardHost({
  cardId,
  children,
  onMeasure,
}: {
  cardId: string;
  children: ReactNode;
  onMeasure(cardId: string, metrics: CardMetrics): void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    let raf = 0;
    const report = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        // 卡被画布裁到视口外时 Excalidraw 会 display:none,量到 0 —— 这种读数要丢掉,
        // 否则下面的卡会整列往上塌。
        if (!root.offsetHeight) return;
        onMeasure(cardId, measureCard(root));
      });
    };
    const ro = new ResizeObserver(report);
    ro.observe(root);
    // 图片/KaTeX/动画 SVG 落地后高度还会变,补两拍
    const timers = [60, 400, 1200].map((ms) => window.setTimeout(report, ms));
    report();
    return () => {
      ro.disconnect();
      cancelAnimationFrame(raf);
      timers.forEach((t) => window.clearTimeout(t));
    };
  }, [cardId, onMeasure]);

  return (
    <div className="card-host" data-card-root={cardId} ref={ref}>
      {children}
    </div>
  );
}
