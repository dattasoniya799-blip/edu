import { num } from '../admin/helpers';
import type { TenantClient } from '../prisma/prisma.service';

/**
 * 一批讲次各自"最新未结束 class_session"的 id(口径同 /student/today.sessionId):
 * lessonId(string)→ sessionId(number);无会话的讲次不入表。
 * 批量(一次 in 查询 N 个 lessonId,避免 N+1)。租户隔离由 PrismaService 注入(client 已带 orgId)。
 *
 * 复用先例:原为 StudentMiscService.latestOpenSessions(FIX4 · #1/#5),
 * 因 LessonDto 增 sessionId(B6 课堂)后被 lesson.service / student-misc 共用,提取为 helper。
 */
export async function latestOpenSessions(
  client: TenantClient,
  lessonIds: bigint[],
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (!lessonIds.length) return map;
  const sessions = await client.classSession.findMany({
    where: { lessonId: { in: lessonIds }, status: { not: 'ended' } },
    orderBy: { id: 'desc' }, // 倒序 → 每讲首次写入即最新一条
    select: { id: true, lessonId: true },
  });
  for (const s of sessions) {
    const key = String(s.lessonId);
    if (!map.has(key)) map.set(key, num(s.id));
  }
  return map;
}
