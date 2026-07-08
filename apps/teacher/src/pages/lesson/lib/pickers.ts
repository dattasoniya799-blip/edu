/**
 * 编排页两个弹窗的数据口径(纯逻辑,vitest 覆盖):
 * ① 「选择知识点」按讲次所属课程的学科取教材知识点图谱(此前恒取第一张 curriculum 图谱 → 永远数学);
 * ② 课后作业「选择已有卷」的候选卷(任意已发布卷都能布置,2026-07 用户批准)。
 * 复用 bank/lib/kpTree 与 paper/lib/questionLibrary 的既有工具,勿另造。
 */
import type { KpGraphDto, PaperDto } from '@qiming/contracts';
import { resolveGraphForSubject } from '../../bank/lib/kpTree';
import { resolveDefaultSubject } from '../../paper/lib/questionLibrary';

/**
 * 编排页「选择知识点」的图谱:按课程学科取该学科教材知识点图谱(缺省退该学科第一张);
 * 课程缺失(异常)→ subject='' = 全部图谱里优先教材知识点(与旧口径兼容);一张图谱都没有 → null。
 */
export function arrangeKpGraphId(
  graphs: readonly KpGraphDto[],
  courses: { id: number; subject: string }[],
  courseId: number,
): number | null {
  return resolveGraphForSubject(graphs, resolveDefaultSubject(courses, courseId), null);
}

/**
 * 课后作业「选择已有卷」候选(2026-07 用户批准"任意已发布卷都能布置"):
 * 此前只列 type=homework,练习/考试卷被静默排除 → 改为全部已发布卷都可选;
 * 另保留「未发布的作业卷」旧口径(可先挂草稿作业卷,讲次发布门槛仍会拦截未发布卷)。
 * 默认排序:homework 优先置顶,组内保持原序。
 */
export function homeworkPaperChoices(papers: readonly PaperDto[]): PaperDto[] {
  const eligible = papers.filter((p) => p.status === 'published' || p.type === 'homework');
  return [
    ...eligible.filter((p) => p.type === 'homework'),
    ...eligible.filter((p) => p.type !== 'homework'),
  ];
}
