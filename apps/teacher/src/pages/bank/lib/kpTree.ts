/**
 * 题库目录(知识体系)的纯逻辑:学科↔目录联动(vitest 覆盖)。
 */
import type { KpGraphDto } from '@qiming/contracts';

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
