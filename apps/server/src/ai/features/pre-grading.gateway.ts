import { Inject, Injectable } from '@nestjs/common';
import { round1 } from '../../admin/helpers';
import type {
  AiGateway,
  PreGradeContext,
  PreGradeInput,
  PreGradeOutput,
} from '../../grading/ai/ai-gateway';
import { loadAiConfigText } from '../config-loader';
import { LlmGatewayService } from '../llm/llm-gateway.service';
import { PRE_GRADE_INPUT_CLOSE, PRE_GRADE_INPUT_OPEN } from '../llm/providers/mock.provider';
import { OCR_SERVICE, OcrService } from '../ocr/ocr.service';
import { JsonSchema, validateJsonSchema } from './json-schema';

/** 预批 LLM 输出契约(设计文档 §8.2:{ai_score, steps[], error_tags[]}),严格校验 */
export const PRE_GRADE_OUTPUT_SCHEMA: JsonSchema = {
  type: 'object',
  required: ['ai_score', 'steps', 'error_tags'],
  additionalProperties: false,
  properties: {
    ai_score: { type: 'number', minimum: 0 },
    steps: {
      type: 'array',
      items: {
        type: 'object',
        required: ['step', 'ok'],
        additionalProperties: false,
        properties: {
          step: { type: 'integer', minimum: 1 },
          ok: { type: 'boolean' },
          comment: { type: 'string' },
        },
      },
    },
    error_tags: { type: 'array', items: { type: 'string' } },
  },
};

interface RawPreGradeOutput {
  ai_score: number;
  steps: { step: number; ok: boolean; comment?: string }[];
  error_tags: string[];
}

/**
 * 主观题预批能力(A7 接管 A5 的 AI_GATEWAY token,消费链路不变):
 * A5 worker(a5:pre_grading 队列)→ GradingService.processPreGrade → 本类。
 * 流程:OCR(photo 占位 → OCR 接口,当前 local stub)→ 提示词(配置文件)+
 * rubric/参考答案/OCR 文本打包 → LlmGateway(feature=pre_grading,计量/额度在网关内)
 * → 输出按 JSON Schema 严格校验(验收项)→ 映射为 A5 契约的 PreGradeOutput。
 */
@Injectable()
export class LlmPreGradeGateway implements AiGateway {
  constructor(
    private readonly llm: LlmGatewayService,
    @Inject(OCR_SERVICE) private readonly ocr: OcrService,
  ) {}

  async preGrade(input: PreGradeInput, ctx: PreGradeContext): Promise<PreGradeOutput> {
    const ocrText = await this.resolveOcrText(input.ocrText);
    const payload = JSON.stringify({
      ocrText,
      referenceAnswer: input.referenceAnswer,
      rubric: input.rubric,
    });
    const text = await this.llm.complete({
      feature: ctx.feature,
      orgId: ctx.orgId,
      messages: [
        { role: 'system', content: loadAiConfigText('pre-grading-prompt.md') },
        { role: 'user', content: `${PRE_GRADE_INPUT_OPEN}${payload}${PRE_GRADE_INPUT_CLOSE}` },
      ],
    });
    const raw = this.parseStrictJson(text);
    const errors = validateJsonSchema(raw, PRE_GRADE_OUTPUT_SCHEMA);
    if (errors.length) {
      throw new Error(`预批输出 JSON Schema 校验失败:${errors.join('; ')}`);
    }
    const out = raw as RawPreGradeOutput;
    return {
      aiScore: round1(out.ai_score),
      steps: out.steps.map((s) => (s.comment === undefined ? { step: s.step, ok: s.ok } : { step: s.step, ok: s.ok, comment: s.comment })),
      errorTags: out.error_tags,
    };
  }

  /** A5 worker 对拍照作答传 `[photo:{ossKey}]` 占位 → 经 OCR 接口取识别文本 */
  private async resolveOcrText(ocrText: string): Promise<string> {
    const m = /^\[photo:(.*)\]$/.exec(ocrText.trim());
    if (!m) return ocrText;
    return this.ocr.recognize(m[1]);
  }

  /** 容忍模型输出包了 markdown 代码块/前后杂文本的情况,提取首个 JSON 对象 */
  private parseStrictJson(text: string): unknown {
    const trimmed = text.trim();
    try {
      return JSON.parse(trimmed);
    } catch {
      const start = trimmed.indexOf('{');
      const end = trimmed.lastIndexOf('}');
      if (start >= 0 && end > start) {
        try {
          return JSON.parse(trimmed.slice(start, end + 1));
        } catch {
          /* fallthrough */
        }
      }
      throw new Error(`预批输出不是合法 JSON:${trimmed.slice(0, 120)}`);
    }
  }
}
