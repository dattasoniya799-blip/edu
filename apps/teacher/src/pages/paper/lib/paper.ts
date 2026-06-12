/**
 * 组卷页纯逻辑:分值汇总 / 发布前校验 / PaperInput 变换(vitest 覆盖,验收项「分值汇总」)
 */
import type { PaperType, QuestionType } from '@qiming/contracts';

export interface PaperItem {
  questionId: number;
  score: number;
}

/** 当前总分 = Σ分值(非法分值按 0 计) */
export function totalScore(items: PaperItem[]): number {
  return items.reduce((sum, it) => sum + (Number.isFinite(it.score) ? it.score : 0), 0);
}

/** 缺省分值(seed 口径:解答题 10 分,其余 5 分) */
export function defaultScore(type: QuestionType): number {
  return type === 'solution' ? 10 : 5;
}

/** 发布/保存前校验:返回错误文案列表(空 = 通过) */
export function validatePaper(name: string, items: PaperItem[]): string[] {
  const errors: string[] = [];
  if (!name.trim()) errors.push('请填写作业名称');
  if (items.length === 0) errors.push('至少选择 1 道题');
  if (items.some((it) => !Number.isFinite(it.score) || it.score <= 0)) errors.push('每题分值需为正数');
  const seen = new Set<number>();
  for (const it of items) {
    if (seen.has(it.questionId)) { errors.push('存在重复题目'); break; }
    seen.add(it.questionId);
  }
  return errors;
}

/** 组卷页状态 → 契约 PaperInput(题序 = 数组顺序,A4 口径) */
export function toPaperInput(name: string, type: PaperType, items: PaperItem[]): {
  name: string; type: PaperType; questions: { questionId: number; score: number }[];
} {
  return {
    name: name.trim(),
    type,
    questions: items.map((it) => ({ questionId: it.questionId, score: it.score })),
  };
}

/** 切换选中:已选则移除,未选则按缺省分值追加 */
export function toggleQuestion(items: PaperItem[], questionId: number, type: QuestionType): PaperItem[] {
  return items.some((it) => it.questionId === questionId)
    ? items.filter((it) => it.questionId !== questionId)
    : [...items, { questionId, score: defaultScore(type) }];
}
