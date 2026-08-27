/**
 * A7 业务错误码(模式同 A3/A4/A5:响应体 {code: 业务码, message, detail?})。
 * BizException / BizExceptionFilter 复用 A4 沉淀实现(只 import,不修改)。
 *
 * [2026-08-22 audit-fix-server · C1] 号码本身一律取自单一注册表
 * `common/biz-codes.ts`,本文件只做本域的 re-export。QA 限流从 4501
 * (与 grading 的 ERR_GRADING_PENDING 双占)迁到未占用的 **4505**。
 */
export { BizException, BizExceptionFilter } from '../course/business.exception';

export {
  /** /ai/qa 限流:每生 6 次/分钟,第 7 次返回(HTTP 429) */
  ERR_AI_QA_RATE_LIMIT,
  /** 机构 AI 月额度已超且 over_policy 关闭该能力(默认关答疑 + 生成课件) */
  ERR_AI_QUOTA_EXCEEDED,
  /** admin 把生图能力切真实但 IMAGE_API_KEY 未配置(HTTP 409) */
  ERR_AI_IMAGE_KEY_MISSING,
  /** 大纲生成失败:模型输出非合法 JSON / Schema 不通过 / 文本模型不可用 */
  ERR_COURSEWARE_OUTLINE_INVALID,
  /** 生图任务不存在/已过期/不属于当前教师(运行态 24h TTL;跨租户一并按此处理) */
  ERR_COURSEWARE_JOB_NOT_FOUND,
  /** courseware 端点按教师限流,或在飞任务数超上限(HTTP 429) */
  ERR_COURSEWARE_RATE_LIMIT,
} from '../common/biz-codes';
