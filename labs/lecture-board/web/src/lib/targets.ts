/**
 * 目标字符串(`target` 与 `ref` 共用一套写法,见 shared/schema.ts「目标字符串」):
 *   <cardId> | <lineId> | mark:<text> | analysis:<block>[:<i>] | takeaways:<group>:<i>
 * 解析与生成都收在这里,别处只用这些函数,免得各处自己拼字符串拼歪。
 */
import type { BoardScript, FlowItem, TakeawayGroup } from '../types';

export const ANALYSIS_BLOCKS = ['given', 'hidden', 'find', 'ideas'] as const;
export type AnalysisBlock = (typeof ANALYSIS_BLOCKS)[number];

export const ANALYSIS_BLOCK_TITLE: Record<AnalysisBlock, string> = {
  given: '已知',
  hidden: '隐含条件',
  find: '求什么',
  ideas: '思路切入',
};

export type ParsedTarget =
  /** 题干里的某个高亮片段 */
  | { kind: 'mark'; text: string }
  /** 审题卡的一块;index 省略 = 整块 */
  | { kind: 'analysis'; block: AnalysisBlock; index?: number }
  /** 总结卡的某一条 */
  | { kind: 'takeaway'; group: TakeawayGroup; index: number }
  /** 卡 id 或板书行 id(分不分得清要查剧本索引) */
  | { kind: 'id'; id: string };

const TAKEAWAY_GROUPS_SET = new Set(['knowledge', 'pitfalls', 'methods', 'variants']);
const ANALYSIS_BLOCKS_SET = new Set<string>(ANALYSIS_BLOCKS);

export function parseTarget(raw: string): ParsedTarget {
  // mark 的文本里可能有冒号,只切第一个
  if (raw.startsWith('mark:')) {
    const text = raw.slice('mark:'.length);
    return text ? { kind: 'mark', text } : { kind: 'id', id: raw };
  }
  if (raw.startsWith('analysis:')) {
    const [block, idx] = raw.slice('analysis:'.length).split(':');
    if (!ANALYSIS_BLOCKS_SET.has(block)) return { kind: 'id', id: raw };
    const index = idx == null ? undefined : Number(idx);
    if (idx != null && !Number.isInteger(index)) return { kind: 'id', id: raw };
    return { kind: 'analysis', block: block as AnalysisBlock, index };
  }
  if (raw.startsWith('takeaways:')) {
    const [group, idx] = raw.slice('takeaways:'.length).split(':');
    const index = Number(idx);
    if (!TAKEAWAY_GROUPS_SET.has(group) || !Number.isInteger(index)) return { kind: 'id', id: raw };
    return { kind: 'takeaway', group: group as TakeawayGroup, index };
  }
  return { kind: 'id', id: raw };
}

export function markTarget(text: string): string {
  return `mark:${text}`;
}

export function analysisTarget(block: AnalysisBlock, index?: number): string {
  return index == null ? `analysis:${block}` : `analysis:${block}:${index}`;
}

export function takeawayTarget(group: TakeawayGroup, index: number): string {
  return `takeaways:${group}:${index}`;
}

/** say 的 ref 归一成数组;没写 ref 返回 null(区别于「写了但是空」)。 */
export function refTargets(item: Extract<FlowItem, { say: string }>): string[] | null {
  const ref = item.ref;
  if (ref == null) return null;
  const list = (Array.isArray(ref) ? ref : [ref]).filter((t) => typeof t === 'string' && t.length > 0);
  return list.length ? list : null;
}

/* --------------------------- 浮现判定 --------------------------- */

/**
 * 审题列的新初态只在「剧本有 phase=analysis 的 step」时生效:
 * 题干高亮与审题四块都要等 reveal。旧剧本(没有审题 step)整列照旧全可见。
 */
export function isMarkRevealed(revealed: ReadonlySet<string>, text: string, analysisDriven: boolean): boolean {
  return !analysisDriven || revealed.has(markTarget(text));
}

/** 块标题是否已现:整块 reveal 过,或块里任意一条 reveal 过。 */
export function isAnalysisBlockRevealed(
  revealed: ReadonlySet<string>,
  block: AnalysisBlock,
  analysisDriven: boolean,
  itemCount = 0,
): boolean {
  if (!analysisDriven) return true;
  if (revealed.has(analysisTarget(block))) return true;
  for (let i = 0; i < itemCount; i++) if (revealed.has(analysisTarget(block, i))) return true;
  return false;
}

export function isAnalysisItemRevealed(
  revealed: ReadonlySet<string>,
  block: AnalysisBlock,
  index: number,
  analysisDriven: boolean,
): boolean {
  if (!analysisDriven) return true;
  return revealed.has(analysisTarget(block)) || revealed.has(analysisTarget(block, index));
}

/**
 * 审题列新初态只在「剧本有 phase=analysis 的 step」时生效(schema.ts Card 注释)。
 *
 * 光看 step.col 的列 phase 不够:实测真实旧剧本(server 早期出的 v2 剧本,如
 * `20260917-104306-yeqe-03-浮力潜艇`)**列本身就是 phase=analysis**、也确实有 step 落在这一列,
 * 但那些 step 只对着整张 `k_analysis` 卡 `fx:circle/underline`,从来不 `reveal mark:<text>` /
 * `analysis:<block>`——按列 phase 判会把这批旧剧本也误判成「新初态」,marks/四块永远等不到 reveal,
 * 白板上的审题列直接开天窗(已用这道真题验证过,是本轮排查中发现的真实回归)。
 * 改用更准的信号:剧本是否**真的**发过 `mark:`/`analysis:` 这两种 reveal——发了才说明这剧本是
 * 按新契约出的,没发就是旧剧本,乖乖回退整列可见。
 */
export function hasAnalysisStep(script: Pick<BoardScript, 'steps'>): boolean {
  return script.steps.some((s) =>
    s.flow.some(
      (item) =>
        'do' in item &&
        item.do === 'reveal' &&
        (item.target.startsWith('mark:') || item.target.startsWith('analysis:')),
    ),
  );
}
