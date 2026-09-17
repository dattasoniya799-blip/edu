/** 剧本契约 v2 由 shared/schema.ts 冻结;web 侧只 import type,不做任何本地副本。 */
export type {
  Animation,
  AudioClip,
  BoardLine,
  BoardScript,
  Card,
  Column,
  Figure,
  FlowItem,
  LessonStage,
  LessonState,
  Phase,
  Step,
  Subject,
} from '../../shared/schema';

import type { BoardScript, LessonStage, LessonState } from '../../shared/schema';

/** protocol.md「SSE」一节的事件体,两侧共用的形状在此镜像(schema.ts 里没有它)。 */
export type ServerEvent =
  | { type: 'snapshot'; state: LessonState }
  | { type: 'stage'; stage: LessonStage; status: 'start' | 'done' | 'error'; message?: string; ms?: number }
  | { type: 'script'; script: BoardScript }
  | { type: 'figure'; id: string; status: 'ready' | 'failed'; src?: string; error?: string }
  | {
      type: 'animation';
      id: string;
      status: 'ready' | 'failed';
      kind?: 'template' | 'html' | 'static';
      html?: string;
      svg?: string;
      error?: string;
    }
  | { type: 'audio'; key: string; src: string; durationMs?: number; text: string }
  | { type: 'complete' }
  | { type: 'error'; message: string };

export type TakeawayGroup = 'knowledge' | 'pitfalls' | 'methods' | 'variants';
