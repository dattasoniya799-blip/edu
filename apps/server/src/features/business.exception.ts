/**
 * E1 业务错误码(模式同 A3/A4/A5/A7:响应体 {code: 业务码, message, detail?})。
 * BizException / BizExceptionFilter 复用 A4 沉淀实现(只 import,不修改);
 * 号码来自单一注册表 `common/biz-codes.ts`(47xx = features 域)。
 */
export { BizException, BizExceptionFilter } from '../course/business.exception';

export {
  /** 功能未对当前用户开放(off 全员禁用 / beta 白名单外);HTTP 403 */
  ERR_FEATURE_NOT_ENABLED,
} from '../common/biz-codes';
