import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { loadAiConfigJson } from '../config-loader';
import { LlmGatewayService } from '../llm/llm-gateway.service';
import type { AiTrace } from '../llm/types';

export interface DiagnosisInput {
  orgId: number;
  studentId: number;
  days: number;
  attemptCount: number;
  wrongCount: number;
  /** 掌握度薄弱节点(由调用方按 mastery_snapshots 取低分若干) */
  weakNodes: { name: string; mastery: number }[];
  trace?: AiTrace;
}

export interface DiagnosisOutput {
  summary: string;
  suggestion: string | null;
}

interface DiagnosisTemplates {
  summary: string;
  weak: string;
  noWeak: string;
  weakItem: string;
  suggestion: string;
}

/**
 * 学情诊断(设计文档 §8.2:错因摘要 + 建议文本):
 * MVP 模板实现(配置文件 diagnosis-templates.json);留 LLM 开关
 * env AI_DIAGNOSIS_USE_LLM=true 时经 LlmGateway(feature=diagnosis)生成摘要。
 * 掌握度增量本身由 A5 的 mastery 队列负责,本能力只产出文本摘要(归因 feature=diagnosis)。
 */
@Injectable()
export class DiagnosisService {
  constructor(
    private readonly cfg: ConfigService,
    private readonly llm: LlmGatewayService,
  ) {}

  async diagnose(input: DiagnosisInput): Promise<DiagnosisOutput> {
    if (this.cfg.get<string>('AI_DIAGNOSIS_USE_LLM', 'false') === 'true') {
      const summary = await this.llm.complete({
        feature: 'diagnosis',
        orgId: input.orgId,
        trace: input.trace ?? { userId: input.studentId },
        messages: [
          { role: 'system', content: '你是学情诊断助手,基于给定统计输出不超过120字的中文学情摘要与一条建议。' },
          { role: 'user', content: JSON.stringify({ days: input.days, attemptCount: input.attemptCount, wrongCount: input.wrongCount, weakNodes: input.weakNodes }) },
        ],
      });
      return { summary, suggestion: null };
    }
    return this.fromTemplate(input);
  }

  private fromTemplate(input: DiagnosisInput): DiagnosisOutput {
    const t = loadAiConfigJson<DiagnosisTemplates>('diagnosis-templates.json');
    const fill = (tpl: string, vars: Record<string, string | number>) =>
      tpl.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ''));
    const weakText = input.weakNodes.length
      ? fill(t.weak, { weakList: input.weakNodes.map((n) => fill(t.weakItem, n)).join('、') })
      : t.noWeak;
    const summary = fill(t.summary, {
      days: input.days,
      attemptCount: input.attemptCount,
      wrongCount: input.wrongCount,
      weakText,
    });
    const suggestion = input.weakNodes.length
      ? fill(t.suggestion, { topNode: input.weakNodes[0].name })
      : null;
    return { summary, suggestion };
  }
}
