/**
 * 答题器视图类型(C1GAP-front)
 *
 * 题面现由契约保证:`AttemptDto.questions: AttemptQuestionView[]`(2026-06-13 批准·C1)。
 * 此前 B5 的「契约缺口降级私有形状」已收敛 —— 本文件不再自定义题面,直接转出契约类型。
 * 防作弊口径(契约):correctAnswer/analysisLatex 仅在该题已判定或交卷后(status != 'in_progress')下发。
 */
import type { AttemptDto } from '@qiming/contracts';

export type { AttemptQuestionView } from '@qiming/contracts';

/** 历史别名:契约已将 questions 并入 AttemptDto,二者等价(保留以减少改动面) */
export type AttemptWithQuestions = AttemptDto;
