/**
 * A5 业务错误码(模式同 A3 的 4301 / A4 的 42xx、43xx:
 * HTTP 409 + 响应体 {code: 业务码, message, detail?},经 BizExceptionFilter 下发)。
 * BizException / BizExceptionFilter 复用 A4 沉淀的实现(只 import,不修改)。
 */
export { BizException, BizExceptionFilter } from '../course/business.exception';

/** finalize 时仍有主观题未复核(detail = {pendingAnswerIds}) */
export const ERR_GRADING_PENDING = 4501;
/** attempt 状态冲突(非进行中作答/重复交卷) */
export const ERR_ATTEMPT_STATE = 4502;
/** 错题不可重做(已 cleared / 无 open 错题) */
export const ERR_WRONG_NOT_REDOABLE = 4503;
