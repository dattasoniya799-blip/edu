import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { loadAiConfigJson } from '../config-loader';
import { LlmGatewayService } from '../llm/llm-gateway.service';
import type { AiTrace } from '../llm/types';

export interface NarrationInput {
  orgId: number;
  /** 触发场景(模板键):segment_switch / answer_correct / answer_wrong / answer_pending / idle */
  kind: 'segment_switch' | 'answer_correct' | 'answer_wrong' | 'answer_pending' | 'idle';
  /** 模板占位变量:{segment} {name} {topic} 等 */
  vars?: Record<string, string>;
  trace?: AiTrace;
}

/**
 * 课堂伴学旁白(设计文档 §8.2:旁白 ≤80 字,可降级为模板):
 * MVP 默认模板实现(配置文件 companion-templates.json,零成本零延迟);
 * 留 LLM 开关:env AI_COMPANION_USE_LLM=true 时经 LlmGateway(feature=class_companion)
 * 生成,网关内计量/额度照常生效。A6 课堂(classroom)后续接线只调本服务,本卡不改 classroom。
 */
@Injectable()
export class CompanionService {
  constructor(
    private readonly cfg: ConfigService,
    private readonly llm: LlmGatewayService,
  ) {}

  async narration(input: NarrationInput): Promise<string> {
    if (this.cfg.get<string>('AI_COMPANION_USE_LLM', 'false') === 'true') {
      const text = await this.llm.complete({
        feature: 'class_companion',
        orgId: input.orgId,
        trace: input.trace,
        messages: [
          { role: 'system', content: '你是课堂伴学助手,用一句不超过80字的中文旁白鼓励学生,不得出现题目答案。' },
          { role: 'user', content: `场景:${input.kind};上下文:${JSON.stringify(input.vars ?? {})}` },
        ],
      });
      return text.slice(0, 80);
    }
    return this.fromTemplate(input).slice(0, 80);
  }

  private fromTemplate(input: NarrationInput): string {
    const templates = loadAiConfigJson<Record<string, string>>('companion-templates.json');
    const tpl = templates[input.kind] ?? templates.idle ?? '';
    return tpl.replace(/\{(\w+)\}/g, (_, k: string) => input.vars?.[k] ?? '');
  }
}
