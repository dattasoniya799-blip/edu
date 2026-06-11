/**
 * 复核名单数据源(可替换适配层)
 *
 * 契约缺口(已在 B4 报告中提出契约变更申请):openapi 没有「按作业列出主观题答卷」端点 ——
 * /grading/pending 仅返回聚合数,4501 detail 只含未复核 id,学生切换条无法从契约端点枚举。
 * 申请新增:GET /grading/assignments/{id}/answers → GradingItem[]。
 *
 * 端点落地前的临时口径:mock 按 seed(第 3 讲作业的 4 份解答题)固定 answerId 41–44,
 * 每份详情仍走契约端点 GET /grading/answers/{id}(404 自动剔除)。
 * 契约补齐后只改本文件的 listGradingItems 实现,页面零改动。
 */
import type { GradingItemDto } from '@qiming/contracts';
import { api } from '../../api';

/** mock/seed 口径:assignmentId → 主观题 answerId 列表 */
const KNOWN_ANSWER_IDS: Record<number, number[]> = { 1: [41, 42, 43, 44] };

export async function listGradingItems(assignmentId: number): Promise<GradingItemDto[]> {
  const ids = KNOWN_ANSWER_IDS[assignmentId] ?? [];
  const results = await Promise.all(
    ids.map((id) => api.get('/grading/answers/{id}', { params: { id } }).catch(() => null)),
  );
  return results.flatMap((r) => (r ? [r.data as GradingItemDto] : []));
}
