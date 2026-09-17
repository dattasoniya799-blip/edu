import { createContext, useContext } from 'react';
import type { BoardScript } from './types';

/** 一张动画卡对外暴露的控制口(template / html / static 三条路都实现它)。 */
export interface AnimController {
  kind: 'template' | 'html' | 'static';
  apply(action: Record<string, unknown>, opts: { instant: boolean }): Promise<void>;
  unlock(params: string[]): void;
  reset(): void;
}

export interface BoardContextValue {
  script: BoardScript;
  /** 已浮现的 cardId / lineId / `takeaway:<group>:<index>` */
  revealed: ReadonlySet<string>;
  /** 动手环节:被解锁的动画卡 id 与任务 */
  explore: { animationId: string; unlock: string[]; tasks: string[] } | null;
  registerAnim(id: string, ctrl: AnimController): () => void;
  /** 「讲到哪」:当前这句 say 的 ref 目标(念完 300ms 淡出),同一时刻只有一组 */
  speaking: ReadonlySet<string>;
  /** 「亮到哪」留痕:emph:'mark' 念完保留的黄底目标(circle 由 ExcalidrawBoard 画,不进这里) */
  kept: ReadonlyMap<string, 'mark' | 'circle'>;
}

export const BoardContext = createContext<BoardContextValue | null>(null);

export function useBoard(): BoardContextValue {
  const ctx = useContext(BoardContext);
  if (!ctx) throw new Error('BoardContext 缺失');
  return ctx;
}
