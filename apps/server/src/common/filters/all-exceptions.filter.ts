import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { maskSensitive } from '../logging/mask';

/** Prisma 已知错误码 → HTTP 状态 + 人话提示(其余仍走 500) */
function mapPrismaKnownError(
  e: Prisma.PrismaClientKnownRequestError,
): { status: number; message: string } | null {
  switch (e.code) {
    case 'P2002': // 唯一约束冲突
      return { status: HttpStatus.CONFLICT, message: '资源已存在或唯一约束冲突' };
    case 'P2025': // 记录不存在
      return { status: HttpStatus.NOT_FOUND, message: '资源不存在' };
    case 'P2003': // 外键约束冲突
      return { status: HttpStatus.BAD_REQUEST, message: '关联资源不存在或被引用' };
    case 'P2000': // 值超出列长度
      return { status: HttpStatus.BAD_REQUEST, message: '字段值超出允许范围' };
    default:
      return null;
  }
}

/** 数值溢出判定:Postgres 22003 / numeric field overflow(各 Prisma 错误类型口径统一) */
function isNumericOverflow(e: unknown): boolean {
  const msg = String((e as { message?: string })?.message ?? '');
  return /22003|numeric field overflow|out of range/i.test(msg);
}

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
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      const mapped = mapPrismaKnownError(exception);
      if (mapped) {
        status = mapped.status;
        message = mapped.message;
      } else if (isNumericOverflow(exception)) {
        status = HttpStatus.BAD_REQUEST;
        message = '数值超出允许范围';
      } else {
        this.logger.error(maskSensitive(String(exception.stack ?? exception)));
      }
    } else if (isNumericOverflow(exception)) {
      // 数值溢出(Postgres 22003)在部分场景被 Prisma 包成 Unknown/Validation 错误
      status = HttpStatus.BAD_REQUEST;
      message = '数值超出允许范围';
    } else {
      this.logger.error(maskSensitive(String((exception as Error)?.stack ?? exception)));
    }

    res.status(status).json({ code: status, message, ...(detail !== undefined ? { detail } : {}) });
  }
}
