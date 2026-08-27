import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import type { CoursewareOutlinePageDto, CoursewareStyleInput } from '@qiming/contracts';
import { BizException, ERR_COURSEWARE_OUTLINE_INVALID } from '../ai.codes';
import { loadAiConfigJson, loadAiConfigText } from '../config-loader';
import { LlmGatewayService } from '../llm/llm-gateway.service';
import { MOCK_IMAGE_PROVIDER_NAME } from '../llm/providers/mock-image.provider';
import { ENV_MODEL } from '../llm/providers/openai-compatible.provider';
import { RouteTableService } from '../llm/route-table.service';
import type { AiTrace, RouteEntry } from '../llm/types';
import { styleLabel } from './courseware-style';
import { JsonSchema, validateJsonSchema } from './json-schema';

/** 大纲 LLM 输出契约:{pages:[{title, body, imagePrompt}]},严格校验(仿预批) */
export const OUTLINE_OUTPUT_SCHEMA: JsonSchema = {
  type: 'object',
  required: ['pages'],
  additionalProperties: false,
  properties: {
    pages: {
      type: 'array',
      items: {
        type: 'object',
        required: ['title', 'body', 'imagePrompt'],
        additionalProperties: false,
        properties: {
          title: { type: 'string' },
          body: { type: 'string' },
          imagePrompt: { type: 'string' },
        },
      },
    },
  },
};

/**
 * 大纲那一步的文本路由:courseware 的路由表条目指向**生图**供应商,取不到文本供应商,
 * 故此处显式指定文本条目(model=env → 运行态/env 的 LLM_MODEL)。不设 fallback ——
 * 真实模式下静默退回 mock 文本会产出非 JSON、最终照样报 4601,不如让失败原因直白暴露。
 */
const OUTLINE_TEXT_ROUTE: RouteEntry = { provider: 'openai_compatible', model: ENV_MODEL, fallback: null };

interface OutlineStageTemplate {
  label: string;
  bullets: string[];
  figure: string;
}

interface OutlineTemplates {
  topicFallback: string;
  head: OutlineStageTemplate;
  middle: OutlineStageTemplate[];
  tail: OutlineStageTemplate[];
}

export interface OutlineInput {
  orgId: number;
  sourceText: string;
  pageCount: number;
  style: CoursewareStyleInput;
  /** 可选知识点上下文(由业务模块按 lessonId/kpNodeId 查名后传入) */
  lessonName?: string | null;
  kpNodeName?: string | null;
  trace?: AiTrace;
}

/** 页数护栏(契约 pageCount 3-20;缺省 8) */
const MIN_PAGES = 3;
const MAX_PAGES = 20;
const DEFAULT_PAGES = 8;

/**
 * 文字稿 → 逐页大纲(AI 生成课件第 1 步)。
 * - 路由 courseware=real:提示词(`config/courseware-outline-prompt.md`)+ {文字稿/页数/风格名/
 *   知识点上下文} 交给文本 LLM,输出经 parseStrictJson + JSON Schema **严格校验**(仿预批),
 *   不合法即 BizException 4601(不把脏数据放进教师的编辑器);
 * - 路由 courseware=mock:走 `config/courseware-outline-templates.json` 的确定性教学页序
 *   (引入 → 概念/推导/例题/变式/易错/应用/结构 → 分层练习 → 小结与作业),
 *   与 apps/teacher 走查用的 msw mock 同口径 —— 无 key 环境也能跑通全流程。
 */
@Injectable()
export class CoursewareOutlineService {
  private readonly logger = new Logger('CoursewareOutline');

  constructor(
    private readonly llm: LlmGatewayService,
    private readonly routes: RouteTableService,
  ) {}

  async generate(input: OutlineInput): Promise<CoursewareOutlinePageDto[]> {
    const count = this.normalizeCount(input.pageCount);
    const route = await this.routes.resolve('courseware');
    if (route.provider === MOCK_IMAGE_PROVIDER_NAME) return this.fromTemplate(input, count);
    return this.fromLlm(input, count);
  }

  // ---------------- 真实链路 ----------------

  private async fromLlm(input: OutlineInput, count: number): Promise<CoursewareOutlinePageDto[]> {
    const payload = {
      sourceText: input.sourceText,
      pageCount: count,
      styleName: styleLabel(input.style),
      kpContext: [input.lessonName, input.kpNodeName].filter(Boolean).join(' · ') || null,
    };
    let text: string;
    try {
      text = await this.llm.complete({
        feature: 'courseware',
        orgId: input.orgId,
        route: OUTLINE_TEXT_ROUTE,
        ...(input.trace ? { trace: input.trace } : {}),
        messages: [
          { role: 'system', content: loadAiConfigText('courseware-outline-prompt.md') },
          { role: 'user', content: JSON.stringify(payload) },
        ],
      });
    } catch (e) {
      // 额度/限流等业务错误原样上抛;只有供应商侧的裸 Error 才转成业务码
      if (e instanceof BizException) throw e;
      throw this.providerFailure(e as Error);
    }
    const raw = this.parseStrictJson(text);
    const errors = validateJsonSchema(raw, OUTLINE_OUTPUT_SCHEMA);
    if (errors.length) {
      this.logger.warn(`大纲输出 Schema 校验失败:${errors.slice(0, 3).join('; ')}`);
      throw new BizException(
        ERR_COURSEWARE_OUTLINE_INVALID,
        'AI 大纲生成失败:模型输出格式不合法,请稍后重试',
        errors.slice(0, 3),
      );
    }
    const pages = (raw as { pages: CoursewareOutlinePageDto[] }).pages
      .map((p) => ({ title: p.title.trim(), body: p.body.trim(), imagePrompt: p.imagePrompt.trim() }))
      .filter((p) => p.title && p.body);
    if (!pages.length) {
      throw new BizException(ERR_COURSEWARE_OUTLINE_INVALID, 'AI 大纲生成失败:模型未产出任何有效页,请稍后重试');
    }
    // 多出的页直接截掉(契约 pageCount 是上限约定);少给的页由教师在第 2 步补
    return pages.slice(0, count);
  }

  /**
   * 供应商侧失败 → 4601 业务错误([2026-08-22 audit-fix-server · P2-16])。
   *
   * `OUTLINE_TEXT_ROUTE` 无 fallback,而路由表允许「只配 IMAGE_API_KEY」就把 courseware 切真实。
   * 该组合下 `openai_compatible` 抛的是普通 Error(没 key / 没 model / 上游 HTTP 错),
   * 原样冒泡到 AllExceptionsFilter 就成了裸 500「服务器内部错误」—— 教师完全不知道是
   * 「文本模型没配」。这里统一转成大纲域既有的 4601 口径,消息直说原因。
   */
  private providerFailure(e: Error): BizException {
    const reason = (e.message || '未知错误').slice(0, 200);
    this.logger.warn(`大纲文本供应商调用失败:${reason}`);
    return new BizException(
      ERR_COURSEWARE_OUTLINE_INVALID,
      'AI 大纲生成失败:文本模型未配置或不可用,请联系管理员检查 AI 接口配置',
      reason,
      HttpStatus.CONFLICT,
    );
  }

  /** 容忍模型输出包了 markdown 代码块/前后杂文本的情况,提取首个 JSON 对象(同预批口径) */
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
      throw new BizException(
        ERR_COURSEWARE_OUTLINE_INVALID,
        'AI 大纲生成失败:模型输出不是合法 JSON,请稍后重试',
        trimmed.slice(0, 120),
        HttpStatus.CONFLICT,
      );
    }
  }

  // ---------------- mock 链路(确定性模板) ----------------

  private fromTemplate(input: OutlineInput, count: number): CoursewareOutlinePageDto[] {
    const t = loadAiConfigJson<OutlineTemplates>('courseware-outline-templates.json');
    const topic = this.topicOf(input.sourceText, input.kpNodeName, t.topicFallback);
    const styleName = styleLabel(input.style);
    // 页数不足 5 时舍掉「分层练习」,保证末页恒为小结(与 teacher msw mock 同口径)
    const tail = count >= 5 ? t.tail : t.tail.slice(1);
    const middleCount = Math.max(0, count - 1 - tail.length);
    const stages: { stage: OutlineStageTemplate; round: number }[] = [
      { stage: t.head, round: 0 },
      ...Array.from({ length: middleCount }, (_, i) => ({
        stage: t.middle[i % t.middle.length],
        round: Math.floor(i / t.middle.length),
      })),
      ...tail.map((stage) => ({ stage, round: 0 })),
    ];
    const fill = (tpl: string) => tpl.replace(/\{topic\}/g, topic);
    return stages.map(({ stage, round }) => ({
      title: `${fill(stage.label)}${round > 0 ? `(${round + 1})` : ''}`,
      body: stage.bullets.map((b) => `· ${fill(b)}`).join('\n'),
      imagePrompt: `【风格:${styleName}】${fill(stage.figure)}`,
    }));
  }

  /** 主题词:优先知识点名,否则取文字稿首个短句(≤14 字),都没有则兜底文案 */
  private topicOf(sourceText: string, kpNodeName: string | null | undefined, fallback: string): string {
    const kp = (kpNodeName ?? '').trim();
    if (kp) return kp.length > 14 ? kp.slice(0, 14) : kp;
    const first = sourceText
      .split(/[。;;,,!!??::\n\r]/)
      .map((s) => s.trim())
      .find((s) => s.length > 0);
    if (!first) return fallback;
    return first.length > 14 ? first.slice(0, 14) : first;
  }

  private normalizeCount(pageCount: number): number {
    const n = Math.round(Number(pageCount)) || DEFAULT_PAGES;
    return Math.min(MAX_PAGES, Math.max(MIN_PAGES, n));
  }
}
