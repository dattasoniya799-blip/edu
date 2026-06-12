/**
 * A7 业务错误码(模式同 A3/A4/A5:响应体 {code: 业务码, message, detail?})。
 * BizException / BizExceptionFilter 复用 A4 沉淀实现(只 import,不修改)。
 * 说明:4501 为任务卡 A7 验收明确指定的限流码(与 A5 在 /grading/* 的 4501
 * 不同接口域,运行时不冲突,已在 README 备注)。
 */
export { BizException, BizExceptionFilter } from '../course/business.exception';

/** /ai/qa 限流:每生 6 次/分钟,第 7 次返回(HTTP 429) */
export const ERR_AI_QA_RATE_LIMIT = 4501;
/** 机构 AI 月额度已超且 over_policy 关闭该能力(默认关答疑、保课堂伴学) */
export const ERR_AI_QUOTA_EXCEEDED = 4504;
