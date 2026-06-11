import { Injectable } from '@nestjs/common';
import { round1 } from '../../admin/helpers';
import {
  AiGateway,
  PreGradeContext,
  PreGradeInput,
  PreGradeOutput,
  PreGradeStep,
} from './ai-gateway';

/**
 * Stub 预批实现(任务卡 A5:"调 AiGateway 接口,本卡用 stub 实现固定返回"):
 * 确定性规则,零外部依赖 ——
 * - rubric 第 1 步默认判 ok(起步分);
 * - 其余步骤:OCR 文本包含标记 `√{step}` 才判 ok(便于测试构造任意得分),否则
 *   ok=false 并给出 comment;
 * - aiScore = Σ(ok 步骤的 rubric 分);errorTags = 未通过步骤的 desc。
 * 拍照作答(无 OCR 能力)经 worker 占位为 `[photo:{ossKey}]` → 仅得第 1 步分。
 */
@Injectable()
export class StubAiGateway implements AiGateway {
  async preGrade(input: PreGradeInput, _ctx: PreGradeContext): Promise<PreGradeOutput> {
    const rubric = input.rubric ?? [];
    const steps: PreGradeStep[] = rubric.map((r, i) => {
      const ok = i === 0 || input.ocrText.includes(`√${r.step}`);
      return ok ? { step: r.step, ok: true } : { step: r.step, ok: false, comment: `未完成:${r.desc}` };
    });
    const aiScore = round1(rubric.reduce((sum, r, i) => sum + (steps[i].ok ? Number(r.score) : 0), 0));
    const errorTags = rubric.filter((_, i) => !steps[i].ok).map((r) => r.desc);
    return { aiScore, steps, errorTags };
  }
}
