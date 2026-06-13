/** 入班候选名单计算(纯函数,便于单测) */

/** 课程名单行的最小形状:学号 id + 在册状态 */
export interface RosterMemberLike {
  studentId: number;
  status: string;
}

/**
 * 计算「添加学生」候选名单 = 全部学生 − 当前课程的 active 名单。
 * - 只把状态为 active 的在册学生视为"已在本课程",已退课(quit/非 active)的可重新入班。
 * - 新课(roster 为空)时返回全部学生,均可选。
 */
export function candidateStudents<T extends { id: number }>(
  allStudents: readonly T[],
  roster: readonly RosterMemberLike[],
): T[] {
  const enrolled = new Set(roster.filter((r) => r.status === 'active').map((r) => r.studentId));
  return allStudents.filter((s) => !enrolled.has(s.id));
}
