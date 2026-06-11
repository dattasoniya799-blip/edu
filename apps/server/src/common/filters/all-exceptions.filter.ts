import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { maskSensitive } from '../logging/mask';

/** 全局异常过滤器:统一错误体 {code, message, detail?}(openapi ErrResp) */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exceptions');

  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse();
    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = '服务器内部错误';
    let detail: unknown;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'string') {
        message = body;
      } else if (body && typeof body === 'object') {
        const b: any = body;
        // class-validator 的报错:message 是数组 → 收进 detail
        if (Array.isArray(b.message)) {
          message = '请求参数不合法';
          detail = b.message;
        } else {
          message = b.message ?? exception.message;
          detail = b.detail;
        }
      }
    } else {
      this.logger.error(maskSensitive(String((exception as Error)?.stack ?? exception)));
    }

    res.status(status).json({ code: status, message, ...(detail !== undefined ? { detail } : {}) });
  }
}
