import type { JwtUser } from '../auth/auth.service';
import type { TenantClient } from '../prisma/prisma.service';

/** 归属判定所需的作业最小切片(teacher 锚点 + course 锚点原料) */
export interface AssignmentAnchor {
  id: bigint;
  teacherId: bigint | null;
  lessonId: bigint | null;
  target: unknown;
}

/**
 * 解析一批作业的 course 锚点:
 * - lessonId 非空 → lesson.courseId;
 * - 否则 target.courseId(整班作业);
 * - 二者皆无(target={studentIds} 且 lessonId=null,如错题自助 wrong_redo)→ null(无锚点)。
 */
export async function resolveAssignmentCourses(
  client: TenantClient,
  assignments: { id: bigint; lessonId: bigint | null; target: unknown }[],
): Promise<Map<string, string | null>> {
  const lessonIds = [
    ...new Set(assignments.filter((a) => a.lessonId != null).map((a) => a.lessonId as bigint)),
  ];
  const lessons = lessonIds.length
    ? await client.lesson.findMany({
        where: { id: { in: lessonIds } },
        select: { id: true, courseId: true },
      })
    : [];
  const courseByLesson = new Map(lessons.map((l) => [String(l.id), String(l.courseId)]));
  const out = new Map<string, string | null>();
  for (const a of assignments) {
    let courseId: string | null = null;
    if (a.lessonId != null) {
      courseId = courseByLesson.get(String(a.lessonId)) ?? null;
    } else {
      const t = a.target as { courseId?: number } | null;
      if (t?.courseId != null) courseId = String(t.courseId);
    }
    out.set(String(a.id), courseId);
  }
  return out;
}

/**
 * 教师端作业归属统一规则(经用户批准的 teacher 锚点,迁移 0002):
 * 可见/可操作 当且仅当
 *  - assignment.teacherId = 当前教师;或
 *  - teacherId IS NULL 且有 course 锚点且该课程属当前教师(兼容回填前口径);
 * teacherId IS NULL 且无 course 锚点(学生自发 wrong_redo / 历史遗留)→ 任何教师不可见不可操作。
 * 返回:归属当前教师的作业 id 集合(String(id))。
 */
export async function ownedAssignmentIds(
  client: TenantClient,
  user: JwtUser,
  assignments: AssignmentAnchor[],
): Promise<Set<string>> {
  const owned = new Set<string>();
  const legacy: AssignmentAnchor[] = [];
  for (const a of assignments) {
    if (a.teacherId != null) {
      if (String(a.teacherId) === String(user.uid)) owned.add(String(a.id));
    } else {
      legacy.push(a);
    }
  }
  if (legacy.length) {
    const anchors = await resolveAssignmentCourses(client, legacy);
    const mine = await client.course.findMany({
      where: { teacherId: BigInt(user.uid) },
      select: { id: true },
    });
    const myCourses = new Set(mine.map((c) => String(c.id)));
    for (const a of legacy) {
      const courseId = anchors.get(String(a.id)) ?? null;
      if (courseId != null && myCourses.has(courseId)) owned.add(String(a.id));
    }
  }
  return owned;
}
