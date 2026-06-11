import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';

/**
 * 业务错误(契约 ErrResp 的 code 为业务码,如 4301):
 * HTTP 状态用合适的 4xx,响应体 { code: 业务码, message }。
 * 全局 AllExceptionsFilter 会把 code 写成 HTTP 状态码,故配套
 * 控制器级 BusinessExceptionFilter(就近优先)保证业务码原样下发。
 */
export class BusinessException extends HttpException {
  constructor(
    readonly bizCode: number,
    message: string,
    status: HttpStatus = HttpStatus.CONFLICT,
  ) {
    super({ code: bizCode, message }, status);
  }
}

/** 题目被试卷引用,禁止删除 */
export const ERR_QUESTION_IN_PAPER = 4301;

@Catch(BusinessException)
export class BusinessExceptionFilter implements ExceptionFilter {
  catch(exception: BusinessException, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse();
    const body = exception.getResponse() as { code: number; message: string };
    res.status(exception.getStatus()).json({ code: body.code, message: body.message });
  }
}
