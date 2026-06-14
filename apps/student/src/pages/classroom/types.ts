/**
 * 课堂模式视图类型(B6)
 *
 * CoursewarePageView / MiniQuizView 已于 [2026-06-14 批准·B6课堂] 提升进 @qiming/contracts
 * (真实模式下 ClassSnapshot 顶层可选 questions?/courseware? 下发课件/题面)。
 * 本地不再重复定义,直接复用契约类型 —— 字段与契约逐字一致,避免双源漂移。
 *
 * ClassSnapshot 已含可选 questions?: AttemptQuestionView[] / courseware?: CoursewarePageView[],
 * 故 ClassJoinSnapshot 简化为其别名(消费侧零改动:仍可读 .me/.session/.questions/.courseware)。
 */
import type { ClassSnapshot } from '@qiming/contracts';

export type { CoursewarePageView, MiniQuizView } from '@qiming/contracts';

/** join ack 的快照(契约 ClassSnapshot 已含可选 questions/courseware,直接复用) */
export type ClassJoinSnapshot = ClassSnapshot;
