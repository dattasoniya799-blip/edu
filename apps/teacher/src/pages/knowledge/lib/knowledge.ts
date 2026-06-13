/** 知识点内容库的纯逻辑(图谱选择 / 关键词过滤),便于单测 */
import type { KpGraphDto, KpNodeDto } from '@qiming/contracts';

/**
 * 选教材知识图谱:优先 curriculum_knowledge,缺省退回第一个图谱。
 * 树渲染只依赖此图谱的 /kp/nodes,不依赖内容包/资源/卷等次要数据。
 */
export function pickKnowledgeGraph(graphs: readonly KpGraphDto[]): KpGraphDto | undefined {
  return graphs.find((g) => g.graphType === 'curriculum_knowledge') ?? graphs[0];
}

/** 按名称关键词过滤知识点(空关键词=全部) */
export function filterNodesByKeyword(nodes: readonly KpNodeDto[], keyword: string): KpNodeDto[] {
  const kw = keyword.trim();
  return kw ? nodes.filter((n) => n.name.includes(kw)) : [...nodes];
}
