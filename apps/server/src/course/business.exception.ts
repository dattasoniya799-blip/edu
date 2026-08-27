import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';

/**
 * A4 业务错误(契约 ErrResp:code=业务码,detail=补充信息):
 * HTTP 状态用合适的 4xx(本域统一 409),响应体 { code: 业务码, message, detail? }。
 * 全局 AllExceptionsFilter 会把 code 写成 HTTP 状态码,故配套控制器级
 * BizExceptionFilter(就近优先)保证业务码与 detail 原样下发(模式同 A3)。
 */
export class BizException extends HttpException {
  constructor(
    readonly bizCode: number,
    message: string,
    readonly detail?: unknown,
    status: HttpStatus = HttpStatus.CONFLICT,
  ) {
    super({ code: bizCode, message, detail }, status);
  }
}

/**
 * 错误码一律来自单一注册表 `common/biz-codes.ts`([2026-08-22 audit-fix-server · C1]),
 * 本文件只 re-export 本域用到的那几个,不再各自定义数字。
 */
export {
  ERR_LESSON_CHECKLIST,
  ERR_PAPER_ASSIGNED,
  ERR_RESOURCE_IN_USE,
} from '../common/biz-codes';

@Catch(BizException)
export class BizExceptionFilter implements ExceptionFilter {
  catch(exception: BizException, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse();
    const body = exception.getResponse() as { code: number; message: string; detail?: unknown };
    res.status(exception.getStatus()).json({
      code: body.code,
      message: body.message,
      ...(body.detail !== undefined ? { detail: body.detail } : {}),
    });
  }
}
