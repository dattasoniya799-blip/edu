import type { RubricStep } from '@qiming/contracts';

/**
 * AI 预批网关接口(任务卡 A5,形状按《后端设计文档》§8.1/§8.2):
 * - 输入:OCR 文本(或手写识别结果)+ 参考答案 + rubric
 * - 输出:{ai_score, steps[], error_tags[]}(本接口字段为驼峰镜像:aiScore/steps/errorTags)
 * - 宪法 §4:业务模块禁止 import LLM SDK,一律经本接口;
 *   本卡绑定 StubAiGateway(规则返回),A7 落地真实网关时只替换 AI_GATEWAY 的 Provider 绑定。
 */
export interface PreGradeInput {
  /** OCR 文本或手写识别结果(拍照作答在 stub 阶段用 `[photo:{ossKey}]` 占位) */
  ocrText: string;
  /** 题目参考答案(questions.answer.referenceLatex) */
  referenceAnswer: string;
  /** 评分要点(questions.rubric) */
  rubric: RubricStep[];
}

export interface PreGradeStep {
  step: number;
  ok: boolean;
  comment?: string;
}

export interface PreGradeOutput {
  /** ai_score:预批得分 */
  aiScore: number;
  /** steps:逐步骤判定 [{step, ok, comment}] */
  steps: PreGradeStep[];
  /** error_tags:错因标签 */
  errorTags: string[];
}

export interface PreGradeContext {
  orgId: number;
  feature: 'pre_grading';
}

export interface AiGateway {
  preGrade(input: PreGradeInput, ctx: PreGradeContext): Promise<PreGradeOutput>;
}

/** Nest DI token:A7 真实网关上线时仅替换该 token 的 Provider */
export const AI_GATEWAY = Symbol('AI_GATEWAY');
