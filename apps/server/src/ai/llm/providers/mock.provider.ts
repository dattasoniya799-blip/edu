import { Injectable } from '@nestjs/common';
import type { AiFeature } from '@qiming/contracts';
import type { Chunk, LlmProvider, Msg } from '../types';

/** 预批输入在 prompt 中的包裹标记(预批能力构造,mock 据此确定性解析) */
export const PRE_GRADE_INPUT_OPEN = '[[PRE_GRADE_INPUT]]';
export const PRE_GRADE_INPUT_CLOSE = '[[/PRE_GRADE_INPUT]]';

/** 触发"给最终答案"式回复的标记(验收:输出审查拦截重写用) */
export const MOCK_FINAL_ANSWER_TRIGGER = '直接告诉我答案';

/** 触发"内部思考过程泄漏"式回复的标记(fix-core A5:审查兜底拦截用例用) */
export const MOCK_META_LEAK_TRIGGER = '触发思考过程泄漏';

/**
 * 回显"构造消息中的对话尾巴"的标记(fix-core A2:跨题串扰验收用)。
 * 命中时把本次请求里除末条(触发消息本身)外的 user/assistant 历史原样拼回,
 * 供 e2e 断言换题后新题上下文里不含旧题对话尾巴。
 */
export const MOCK_ECHO_TAIL_TRIGGER = '回显对话尾巴';
export const MOCK_ECHO_TAIL_PREFIX = 'TAILECHO';

/** 模拟故障的模型名(验收 fallback 路径用):chat 即抛错 */
export const MOCK_BROKEN_MODEL = 'mock-broken';

interface PreGradeRubricStep {
  step: number;
  desc: string;
  score: number;
}

/**
 * mock 供应商(验收用,完全确定性、零网络):
 * - token 规则:tokensIn = 全部消息 content 长度之和;tokensOut = 回复文本长度
 *   (均按 JS string.length)→ 配合路由表单价,费用可手算;
 * - 预批:解析 prompt 中 [[PRE_GRADE_INPUT]] JSON,按与 A5 stub 完全一致的规则
 *   (第 1 步恒 ok,其余步骤 OCR 文本含 √{step} 才 ok)输出严格 JSON
 *   {ai_score, steps[], error_tags[]} —— 保证 A5 既有 23 个用例的预批分值不变;
 * - 答疑/旁白/诊断:确定性文本,分多块输出以覆盖流式路径;消息含
 *   「直接告诉我答案」时回复内嵌"最终答案是 B"模式,供输出审查拦截用例触发;
 * - model = mock-broken 时抛错,用于验证路由表 fallback。
 */
@Injectable()
export class MockProvider implements LlmProvider {
  readonly name = 'mock';

  healthy(): boolean {
    return true;
  }

  async *chat(req: { model: string; messages: Msg[]; feature: AiFeature }): AsyncIterable<Chunk> {
    if (req.model === MOCK_BROKEN_MODEL) throw new Error('mock 供应商故障(测试用)');
    const tokensIn = req.messages.reduce((s, m) => s + m.content.length, 0);
    const reply = this.replyFor(req.messages);
    // 分块输出覆盖流式;usage 按设计随最后一块给出
    const mid = Math.ceil(reply.length / 2);
    yield { delta: reply.slice(0, mid) };
    yield { delta: reply.slice(mid), usage: { tokensIn, tokensOut: reply.length } };
  }

  private replyFor(messages: Msg[]): string {
    const lastUser = [...messages].reverse().find((m) => m.role === 'user')?.content ?? '';
    const open = lastUser.indexOf(PRE_GRADE_INPUT_OPEN);
    if (open >= 0) {
      const close = lastUser.indexOf(PRE_GRADE_INPUT_CLOSE);
      const json = lastUser.slice(open + PRE_GRADE_INPUT_OPEN.length, close);
      return this.preGradeJson(json);
    }
    if (lastUser.includes(MOCK_FINAL_ANSWER_TRIGGER)) {
      return '这道题不难,最终答案是 B,选 B 就对了。';
    }
    if (lastUser.includes(MOCK_META_LEAK_TRIGGER)) {
      // 复刻线上实测的内部独白泄漏形态(fix-core A5),供输出审查兜底拦截用例触发
      return '（思考过程：学生问的是判别式作用,按原则1不直接给定义,先反问引导。）我们先想想,判别式在求根公式里的哪个位置?';
    }
    if (lastUser.includes(MOCK_ECHO_TAIL_TRIGGER)) {
      // fix-core A2:回显对话尾巴(末条触发消息本身除外),仅含 user/assistant 历史,
      // 不掺入 system 提示词/题目上下文,便于断言"换题后无旧题尾巴"。
      const convo = messages.filter((m) => m.role === 'user' || m.role === 'assistant');
      const tail = convo.slice(0, -1).map((m) => `${m.role}=${m.content}`).join(' || ');
      return `${MOCK_ECHO_TAIL_PREFIX}<<${tail}>>`;
    }
    return `我们一步步来:先回顾题目条件,你觉得第一步该用什么方法?(mock 引导回复,提问长度 ${lastUser.length})`;
  }

  /** 与 A5 StubAiGateway 同规则的确定性预批,输出严格 JSON(snake_case,设计文档 §8.2) */
  private preGradeJson(json: string): string {
    let input: { ocrText?: string; rubric?: PreGradeRubricStep[] };
    try {
      input = JSON.parse(json);
    } catch {
      return JSON.stringify({ ai_score: 0, steps: [], error_tags: ['预批输入解析失败'] });
    }
    const rubric = input.rubric ?? [];
    const ocrText = input.ocrText ?? '';
    const steps = rubric.map((r, i) => {
      const ok = i === 0 || ocrText.includes(`√${r.step}`);
      return ok ? { step: r.step, ok: true } : { step: r.step, ok: false, comment: `未完成:${r.desc}` };
    });
    const aiScore = rubric.reduce((sum, r, i) => sum + (steps[i].ok ? Number(r.score) : 0), 0);
    const errorTags = rubric.filter((_, i) => !steps[i].ok).map((r) => r.desc);
    return JSON.stringify({
      ai_score: Math.round(aiScore * 10) / 10,
      steps,
      error_tags: errorTags,
    });
  }
}
