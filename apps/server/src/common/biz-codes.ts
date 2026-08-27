/**
 * 业务错误码单一注册表([2026-08-22 audit-fix-server · C1])。
 *
 * 契约 `ErrResp.code` 是**全局**业务码,前端可以按 code 分支而不看接口路径,
 * 因此同一个号码不允许被两个域占用。此前号段散在四个文件、无注册表,4501 被
 * grading(finalize 未复核)与 ai(QA 限流)双占;本文件把全部号段集中登记,
 * 各域的 `business.exception.ts` / `ai.codes.ts` 一律从这里 re-export,
 * **新增错误码必须先在本表登记**(否则无处确认号码是否空闲)。
 *
 * 号段划分(4 位,首两位=域):
 * - 42xx course   讲次/备课
 * - 43xx paper/resource/question(43xx 历史上跨了 course 与 question 两个文件,故一并登记)
 * - 45xx grading/attempt/wrongbook + ai 限流与额度
 * - 46xx courseware(AI 生成课件)
 * - 47xx features(内测区与功能分级 E1)
 *
 * 异常类:全域统一 `BizException`(响应体含 detail),配套 `BizExceptionFilter`。
 * question 域原有的 `BusinessException`(丢弃 detail)已于本波次删除。
 */

// ---------------- 42xx · course(讲次/备课) ----------------
/** 讲次发布:备课检查未通过(detail = 缺失项列表) */
export const ERR_LESSON_CHECKLIST = 4201;

// ---------------- 43xx · question / paper / resource ----------------
/** 题目被试卷引用,禁止删除 */
export const ERR_QUESTION_IN_PAPER = 4301;
/** 试卷已被作业(assignment)引用,禁止修改 */
export const ERR_PAPER_ASSIGNED = 4302;
/** 资源已被讲次引用,禁止删除(detail = usedByLessons) */
export const ERR_RESOURCE_IN_USE = 4303;

// ---------------- 45xx · grading / attempt / wrongbook ----------------
/** finalize 时仍有主观题未复核(detail = {pendingAnswerIds});HTTP 409 */
export const ERR_GRADING_PENDING = 4501;
/** attempt 状态冲突(非进行中作答/重复交卷) */
export const ERR_ATTEMPT_STATE = 4502;
/** 错题不可重做(已 cleared / 无 open 错题) */
export const ERR_WRONG_NOT_REDOABLE = 4503;

// ---------------- 45xx · ai(额度/限流) ----------------
/** 机构 AI 月额度已超且 over_policy 关闭该能力;HTTP 409 */
export const ERR_AI_QUOTA_EXCEEDED = 4504;
/**
 * /ai/qa 学生答疑限流:每生 6 次/分钟,第 7 次返回;HTTP 429。
 * [2026-08-22 audit-fix-server · C1] 原为 4501,与 ERR_GRADING_PENDING 双占,
 * 迁到本号段内未占用的 4505(三端 grep 确认无前端按 4501 分支答疑逻辑)。
 */
export const ERR_AI_QA_RATE_LIMIT = 4505;
/** admin 把生图能力切真实但 IMAGE_API_KEY 未配置;HTTP 409 */
export const ERR_AI_IMAGE_KEY_MISSING = 4506;

// ---------------- 46xx · courseware(AI 生成课件) ----------------
/** 大纲生成失败:模型输出非合法 JSON / Schema 不通过 / 文本模型不可用(detail = 前若干条错误) */
export const ERR_COURSEWARE_OUTLINE_INVALID = 4601;
/** 生图任务不存在/已过期/不属于当前教师(运行态 24h TTL;跨租户一并按此处理);HTTP 404 */
export const ERR_COURSEWARE_JOB_NOT_FOUND = 4602;
/** courseware 端点按教师限流,或在飞任务数超上限;HTTP 429 */
export const ERR_COURSEWARE_RATE_LIMIT = 4603;

// ---------------- 47xx · features(内测区与功能分级 E1) ----------------
/** 功能未对当前用户开放(off 全员禁用 / beta 白名单外);HTTP 403 */
export const ERR_FEATURE_NOT_ENABLED = 4701;
