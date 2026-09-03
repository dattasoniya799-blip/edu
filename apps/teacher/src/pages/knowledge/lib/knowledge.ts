/** 知识点内容库的纯逻辑(学科 / 图谱选择、关键词过滤),便于单测 */
import type { CourseDto, KpGraphDto, KpNodeDto } from '@qiming/contracts';

/** 有教材知识图谱的学科(按图谱顺序去重);知识点库的学科切换项来源 */
export function curriculumSubjects(graphs: readonly KpGraphDto[]): string[] {
  const out: string[] = [];
  for (const g of graphs) if (g.graphType === 'curriculum_knowledge' && !out.includes(g.subject)) out.push(g.subject);
  return out;
}

/**
 * 默认学科:优先教师在带课程的学科(第一门),其次第一张教材图谱的学科。
 * 2026-09-02 走查 A-1 之前页面直接取第一张教材图谱(导入顺序决定,演示库恰为化学),数学老师看不到数学知识点。
 */
export function defaultKnowledgeSubject(graphs: readonly KpGraphDto[], courses: readonly Pick<CourseDto, 'subject'>[]): string {
  const subjects = curriculumSubjects(graphs);
  const fromCourse = courses.map((c) => c.subject).find((s) => subjects.includes(s));
  return fromCourse ?? subjects[0] ?? '';
}

/**
 * 选教材知识图谱:给了学科 → 该学科的 curriculum_knowledge 图谱;
 * 没给或该学科没有教材图谱 → 第一张 curriculum_knowledge,再缺省退回第一个图谱。
 * 树渲染只依赖此图谱的 /kp/nodes,不依赖内容包/资源/卷等次要数据。
 */
export function pickKnowledgeGraph(graphs: readonly KpGraphDto[], subject = ''): KpGraphDto | undefined {
  if (subject) {
    const hit = graphs.find((g) => g.graphType === 'curriculum_knowledge' && g.subject === subject);
    if (hit) return hit;
  }
  return graphs.find((g) => g.graphType === 'curriculum_knowledge') ?? graphs[0];
}

/** 按名称关键词过滤知识点(空关键词=全部) */
export function filterNodesByKeyword(nodes: readonly KpNodeDto[], keyword: string): KpNodeDto[] {
  const kw = keyword.trim();
  return kw ? nodes.filter((n) => n.name.includes(kw)) : [...nodes];
}
