/**
 * A5 业务错误码(模式同 A3 的 4301 / A4 的 42xx、43xx:
 * HTTP 409 + 响应体 {code: 业务码, message, detail?},经 BizExceptionFilter 下发)。
 * BizException / BizExceptionFilter 复用 A4 沉淀的实现(只 import,不修改)。
 */
export { BizException, BizExceptionFilter } from '../course/business.exception';

/**
 * 错误码一律来自单一注册表 `common/biz-codes.ts`([2026-08-22 audit-fix-server · C1])。
 * 4501 曾被本域(finalize 未复核)与 ai 域(QA 限流)双占,后者已迁至 4505。
 */
export {
  ERR_GRADING_PENDING,
  ERR_ATTEMPT_STATE,
  ERR_WRONG_NOT_REDOABLE,
} from '../common/biz-codes';
