/**
 * 业务错误码常量(ErrResp.code)
 *
 * 唯一事实来源是服务端各域的 codes 文件,本文件只是把散落三端的裸字面量集中命名,
 * 不新增/不改写任何码值:
 * - `apps/server/src/course/business.exception.ts`   → 4201 / 4302 / 4303
 * - `apps/server/src/question/business.exception.ts` → 4301
 * - `apps/server/src/grading/business.exception.ts`  → 4501 / 4502 / 4503
 * - `apps/server/src/ai/ai.codes.ts`                 → 4501(QA 限流)/ 4504 / 4601 / 4602
 *
 * 通用码口径注意:真实后端的 `AllExceptionsFilter` 把 `code` 写成 HTTP 状态码
 * (400 / 404),而三端 msw mock 沿用 4000 / 4040 的四位约定。判「不存在」这类
 * 通用错误时两边都要认,例如 `e.code === ERROR_CODES.NOT_FOUND || e.httpStatus === 404`。
 */

export const ERROR_CODES = {
  /** 通用·请求参数不合法(mock 4000;真实后端为 HTTP 400) */
  BAD_REQUEST: 4000,
  /** 通用·资源不存在(mock 4040;真实后端为 HTTP 404) */
  NOT_FOUND: 4040,

  /** 讲次发布:备课检查未通过(detail = 缺失项键数组 empty/practice/homework) */
  LESSON_CHECKLIST: 4201,

  /** 题目已被试卷引用,禁止删除 */
  QUESTION_IN_PAPER: 4301,
  /** 试卷已被作业(assignment)引用,禁止修改 */
  PAPER_ASSIGNED: 4302,
  /** 资源已被讲次引用,禁止删除(detail = usedByLessons) */
  RESOURCE_IN_USE: 4303,

  /** 出分时仍有主观题未复核(detail = {pendingAnswerIds}) */
  GRADING_PENDING: 4501,
  /** 作答状态冲突(非进行中作答 / 重复交卷) */
  ATTEMPT_STATE: 4502,
  /** 错题不可重做(已 cleared / 无 open 错题) */
  WRONG_NOT_REDOABLE: 4503,
  /** 机构 AI 月额度已超且 over_policy 关闭该能力 */
  AI_QUOTA_EXCEEDED: 4504,

  /** 课件大纲生成失败:模型输出非合法 JSON 或 Schema 校验不通过 */
  COURSEWARE_OUTLINE_INVALID: 4601,
  /** 生图任务不存在 / 已过期 / 不属于当前教师(运行态 24h TTL) */
  COURSEWARE_JOB_NOT_FOUND: 4602,

  /** 功能未对当前用户开放(内测分级 E1:off 或 beta 白名单外;HTTP 403) */
  FEATURE_NOT_ENABLED: 4701,
} as const;

/**
 * `/ai/qa` 限流码。服务端 `ai.codes.ts` 明确复用了 4501 这个数值
 * (与 `/grading/*` 的 GRADING_PENDING 不同接口域,运行时不冲突)——
 * 别名单列,以免调用方误以为拿到的是「有主观题待复核」。
 */
export const ERR_AI_QA_RATE_LIMIT = ERROR_CODES.GRADING_PENDING;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];
