/**
 * question 域业务错误([2026-08-22 audit-fix-server · C2]):
 * 原先本文件自带一套 `BusinessException` / `BusinessExceptionFilter`,与 course 域的
 * `BizException` 并行存在且**丢弃 detail** —— 同一个契约 `ErrResp` 有两种下发行为。
 * 现已删除该副本,全域统一 `BizException`(响应体含可选 detail),本文件只保留
 * 域内错误码的 re-export 与异常类/过滤器的转出,调用点无需感知实现在哪个目录。
 */
export { BizException, BizExceptionFilter } from '../course/business.exception';

/** 题目被试卷引用,禁止删除 */
export { ERR_QUESTION_IN_PAPER } from '../common/biz-codes';
