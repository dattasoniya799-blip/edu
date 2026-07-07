/**
 * 题库目录(知识体系)的纯逻辑:学科↔目录联动 + 节点辅助查询(vitest 覆盖)。
 * 展示层把「图谱」称作「知识体系」(对教师更直白);代码标识符仍沿用 graph。
 */
import type { KpGraphDto, KpNodeDto } from '@qiming/contracts';

/**
 * 学科筛选下可见的知识体系列表:
 * 选了学科 → 只列该学科的;学科=全部('')→ 列全部。
 * 该学科没有任何图谱(数据异常)时回退全部,避免下拉被清空。
 */
export function graphsForSubject(graphs: readonly KpGraphDto[], subject: string): KpGraphDto[] {
  if (!subject) return [...graphs];
  const bySubject = graphs.filter((g) => g.subject === subject);
  return bySubject.length > 0 ? bySubject : [...graphs];
}

/**
 * 学科切换后应选中的知识体系(以学科为主):
 * - 当前所选仍在可见范围内 → 保持不变(不打断教师);
 * - 否则切到该学科的「教材知识点」体系,缺省退回该学科第一张;
 * - 一张图谱都没有 → null。
 */
export function resolveGraphForSubject(
  graphs: readonly KpGraphDto[],
  subject: string,
  currentGraphId: number | null,
): number | null {
  const visible = graphsForSubject(graphs, subject);
  if (visible.length === 0) return null;
  if (currentGraphId != null && visible.some((g) => g.id === currentGraphId)) return currentGraphId;
  const curriculum = visible.find((g) => g.graphType === 'curriculum_knowledge');
  return (curriculum ?? visible[0]).id;
}

/** 节点关键词匹配:name / chapter / section 任一命中(辅助查询加强口径) */
export function nodeMatchesKeyword(n: KpNodeDto, keyword: string): boolean {
  const kw = keyword.trim();
  if (!kw) return true;
  return n.name.includes(kw) || (n.chapter?.includes(kw) ?? false) || (n.section?.includes(kw) ?? false);
}

/**
 * 关键词过滤 + 按章节分组(教材体系用 chapter;能力/策略体系用 category;都没有归「其他」)。
 * 保序:组按首次出现顺序,组内按原顺序,让"找一个知识点"有章节路径感。
 */
export function filterAndGroupNodes(
  nodes: readonly KpNodeDto[],
  keyword: string,
): [string, KpNodeDto[]][] {
  const map = new Map<string, KpNodeDto[]>();
  for (const n of nodes) {
    if (!nodeMatchesKeyword(n, keyword)) continue;
    const key = n.chapter ?? n.category ?? '其他';
    map.set(key, [...(map.get(key) ?? []), n]);
  }
  return [...map.entries()];
}

/** 该学科的「教材知识点」体系(组卷按知识点筛题的目录来源);没有则 undefined */
export function curriculumGraphForSubject(
  graphs: readonly KpGraphDto[],
  subject: string,
): KpGraphDto | undefined {
  return graphs.find((g) => g.subject === subject && g.graphType === 'curriculum_knowledge');
}

/** 节点列表里的章节序列(去重、保序;无 chapter 的节点不产生章节项) */
export function chaptersOf(nodes: readonly KpNodeDto[]): string[] {
  return [...new Set(nodes.map((n) => n.chapter).filter((c): c is string => !!c))];
}

/** 某章节下的节点(chapter='' 时返回全部,配合「全部章节」选项) */
export function nodesInChapter(nodes: readonly KpNodeDto[], chapter: string): KpNodeDto[] {
  return chapter ? nodes.filter((n) => n.chapter === chapter) : [...nodes];
}
