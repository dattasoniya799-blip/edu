/**
 * 编排页两个弹窗的数据口径(纯逻辑,vitest 覆盖):
 * ① 「选择知识点」按讲次所属课程的学科取教材知识点图谱(此前恒取第一张 curriculum 图谱 → 永远数学);
 * 复用 bank/lib/kpTree 与 paper/lib/questionLibrary 的既有工具,勿另造。
 */
import type { KpGraphDto } from '@qiming/contracts';
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
