import { Body, Controller, Get, HttpException, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import type { AiFeature } from '@qiming/contracts';
import type { JwtUser } from '../auth/auth.service';
import { CurrentUser, Roles } from '../common/decorators';
import { QaAskDto } from './ai.dto';
import { QaService } from './features/qa.service';
import { LlmGatewayService } from './llm/llm-gateway.service';
import { RouteTableService } from './llm/route-table.service';

/** SSE 下发块大小(对客户端保持流式;全文已先经输出审查) */
const SSE_CHUNK_CHARS = 24;

@Controller('ai')
export class AiController {
  constructor(
    private readonly qa: QaService,
    private readonly routes: RouteTableService,
    private readonly llm: LlmGatewayService,
  ) {}

  /**
   * POST /ai/qa [student]:SSE 流(openapi:event=delta data={"text"};结束 event=done)。
   * 自管响应(@Res)→ 全局拦截器/过滤器不参与,错误体在此按 ErrResp 形状手写
   * (BizException 保留业务码:4501 限流 / 4504 超额关闭)。
   */
  @Post('qa')
  @Roles('student')
  async ask(@CurrentUser() user: JwtUser, @Body() dto: QaAskDto, @Res() res: Response): Promise<void> {
    let result;
    try {
      result = await this.qa.ask(user, dto);
    } catch (e) {
      this.writeError(res, e);
      return;
    }
    res.status(200);
    res.setHeader('content-type', 'text/event-stream');
    res.setHeader('cache-control', 'no-cache');
    res.setHeader('connection', 'keep-alive');
    res.flushHeaders?.();
    for (let i = 0; i < result.text.length; i += SSE_CHUNK_CHARS) {
      this.writeEvent(res, 'delta', { text: result.text.slice(i, i + SSE_CHUNK_CHARS) });
    }
    this.writeEvent(res, 'done', { requestId: result.requestId });
    res.end();
  }

  /** GET /ai/health [admin]:当前路由表 + 各供应商可用性(走全局 Transform 包 {code,data}) */
  @Get('health')
  @Roles('admin')
  async health(): Promise<{ providers: { feature: string; provider: string; model: string; healthy: boolean }[] }> {
    const table = await this.routes.table();
    const providers = (Object.keys(table.routes) as AiFeature[]).map((feature) => {
      const route = table.routes[feature];
      return {
        feature,
        provider: route.provider,
        model: route.model,
        healthy: this.llm.providerOf(route.provider)?.healthy() ?? false,
      };
    });
    return { providers };
  }

  private writeEvent(res: Response, event: string, data: unknown): void {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  /** 错误体与全局过滤器口径一致:{code, message, detail?};BizException 保留业务码 */
  private writeError(res: Response, e: unknown): void {
    if (e instanceof HttpException) {
      const body = e.getResponse();
      const b = (typeof body === 'object' && body !== null ? body : {}) as {
        code?: number;
        message?: string;
        detail?: unknown;
      };
      res.status(e.getStatus()).json({
        code: b.code ?? e.getStatus(),
        message: b.message ?? e.message,
        ...(b.detail !== undefined ? { detail: b.detail } : {}),
      });
      return;
    }
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
}
