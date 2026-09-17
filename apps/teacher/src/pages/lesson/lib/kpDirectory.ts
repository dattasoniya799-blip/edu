/**
 * 知识点目录(B/C 挂载课件 / 选择试卷弹窗的分组数据源,纯逻辑,vitest 覆盖)。
 *
 * 背景(用户报告 B/C):挂载课件、选择随堂练/课后作业两个弹窗此前都是一张平铺列表,
 * 资源/试卷一多就没法找。不改契约,只用现有字段拼「目录」:
 *   - 资源(ResourceDto.kpNodeId)→ 经 GET /kp/graphs 找到该节点所属图谱的 subject,
 *     经 GET /kp/nodes?graphId= 拿节点的 grade/chapter → 学科 › 年级 › 章节。
 *   - 试卷(PaperDto.kpNodes 去重知识点)没有单一 kpNodeId,年级按卷内命中知识点的年级
 *     众数推(见 paperGrade);学科用 PaperDto.subject(契约已聚合,无需再查目录)。
 *
 * 只处理 graphType='curriculum_knowledge' 的图谱(教材知识点,带 subject/grade/chapter);
 * 能力/策略图谱不参与分组(节点没有 grade/chapter 语义)。
 */
import type { KpGraphDto, KpNodeDto, PaperDto, ResourceDto } from '@qiming/contracts';

export const UNCATEGORIZED = '未归类';
export const UNGRADED = '未标年级';
export const UNCHAPTERED = '未分章';

export interface KpDirEntry {
  subject: string;
  grade: string | null;
  chapter: string | null;
}

/** 本机构教材知识点体系(过滤能力/策略图谱) */
export function curriculumGraphs(graphs: readonly KpGraphDto[]): KpGraphDto[] {
  return graphs.filter((g) => g.graphType === 'curriculum_knowledge');
}

/**
 * 由「图谱列表 + 每图谱节点列表」拼出 kpNodeId → {subject,grade,chapter} 的查找表。
 * `nodesByGraph` 允许缺某图谱(尚未拉取/拉取失败)——缺的图谱下的节点不会出现在目录里,
 * 落到调用方的「未归类/未标年级」兜底,不阻塞渲染。
 */
export function buildKpDirectory(
  graphs: readonly KpGraphDto[],
  nodesByGraph: Record<number, KpNodeDto[] | undefined>,
): Map<number, KpDirEntry> {
  const dir = new Map<number, KpDirEntry>();
  for (const g of curriculumGraphs(graphs)) {
    for (const n of nodesByGraph[g.id] ?? []) {
      dir.set(n.id, { subject: g.subject, grade: n.grade, chapter: n.chapter });
    }
  }
  return dir;
}

/** 资源的目录路径:学科 › 年级 › 章节;未挂知识点或知识点不在目录里 → 单级「未归类」 */
export function resourceGroupPath(
  r: Pick<ResourceDto, 'kpNodeId'>,
  dir: ReadonlyMap<number, KpDirEntry>,
): string[] {
  if (r.kpNodeId == null) return [UNCATEGORIZED];
  const e = dir.get(r.kpNodeId);
  if (!e) return [UNCATEGORIZED];
  return [e.subject, e.grade ?? UNGRADED, e.chapter ?? UNCHAPTERED];
}

/**
 * 试卷的年级推断:卷内 kpNodes 命中目录的年级取众数(全一致即该年级;并列取先出现者);
 * 一个都没命中(未挂知识点 / 知识点不在目录里)→「未标年级」。
 */
export function paperGrade(
  p: Pick<PaperDto, 'kpNodes'>,
  dir: ReadonlyMap<number, KpDirEntry>,
): string {
  const grades = p.kpNodes
    .map((k) => dir.get(k.id)?.grade)
    .filter((g): g is string => !!g);
  if (grades.length === 0) return UNGRADED;
  const count = new Map<string, number>();
  for (const g of grades) count.set(g, (count.get(g) ?? 0) + 1);
  let best = grades[0];
  let bestN = 0;
  for (const [g, n] of count) if (n > bestN) { best = g; bestN = n; }
  return best;
}

/** 试卷的目录路径:学科(PaperDto.subject,已聚合)› 类型;学科缺失(空卷)→「未归类」 */
export function paperGroupPath(p: Pick<PaperDto, 'subject' | 'type'>, typeLabel: Record<PaperDto['type'], string>): string[] {
  return [p.subject ?? UNCATEGORIZED, typeLabel[p.type]];
}
