/**
 * 答题器视图类型(B5)
 *
 * ⚠️ 契约缺口(已随 B5 提交「契约变更申请 B5-1」,见 apps/student/README.md):
 * openapi 的 Attempt 仅含 answers[].questionId,而学生侧没有任何可取题面
 * (stemLatex/options)的端点(/questions/{id}、/papers/{id} 均为 [teacher])。
 * 申请为 /student/attempts(POST)与 /student/attempts/{id}(GET)的响应
 * 增补纯增量字段 data.questions(学生视图,不含 isCorrect/answer;
 * correctAnswer/analysisLatex 仅在 status != 'in_progress' 时下发)。
 * mock 先按该形状实现;若申请被否决,改造点集中在 useAttempt 的取题逻辑。
 */
import type { AttemptDto, QuestionType } from '@qiming/contracts';

/** 学生视角的卷面题目(契约变更申请 B5-1 的形状) */
export interface AttemptQuestionView {
  seq: number;
  questionId: number;
  /** 本题卷面分 */
  score: number;
  type: QuestionType;
  stemLatex: string;
  figures: { ossKey: string; position: number }[];
  /** 选择题选项,不含 isCorrect */
  options: { label: string; contentLatex: string }[];
  /** 仅 status != 'in_progress' 时下发 */
  correctAnswer: string | null;
  /** 仅 status != 'in_progress' 时下发 */
  analysisLatex: string | null;
}

export type AttemptWithQuestions = AttemptDto & { questions: AttemptQuestionView[] };
