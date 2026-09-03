# packages/contracts · 契约变更记录

> **这篇解决什么问题、写给谁**:`packages/contracts`(`openapi.yaml` / `dto.ts` / `ws-protocol.ts` /
> `design-tokens.ts` / `error-codes.ts`)与 `apps/server/prisma/schema.prisma` 是全仓「唯一事实」,
> 任何改动都必须**先提「契约变更申请」、经用户批准**(纪律见 `docs/00-协作纪律.md`),
> 并在**改契约的同一个提交/PR 里**往本文末尾追加一条记录。读本文可知每个字段、端点、迁移
> 「为什么长这样」;以仓库当前代码为准,已记录的项**勿重复申请**。
>
> 记录格式(沿用既有条目):`[日期,经用户批准,task/分支] 标题` + 口径 / 影响的端 / 迁移与否 / 验证。
>
> 本文 2026-09-02 自 `启明智学-开工包/01-项目宪法.md`(已归档至 `_archive/启明智学-开工包-2026-06/`)
> 原样迁入,以下条目为迁入时原文,按时间顺序;其中少数为非契约文件的跨边界改动报备
> (如模块 exports、品牌名),当时同记于此,一并保留。

## 已生效的契约变更记录(以仓库当前代码为准,勿重复申请)
- [2026-06-11,经仲裁批准,task/A1] schema.prisma 的 20 个枚举由非法单行写法重排为
  合法多行格式,零语义变化(枚举名/值/顺序/表结构全部不变,数据库无需操作)。
  现 `prisma validate` 与 `prisma generate` 均可正常通过;若你发现枚举格式与早期
  文档截图不一致,这是预期内的,不要再提变更申请。
- [2026-06-12,经仲裁批准,A6 提请] ws-protocol.ts 的 C2SEvents 补充 `'class:control':
  (p: ClassControl) => void`(教师下发暂停/继续/下课/强制切环节;服务端校验仅本课教师)。
  设计文档 7.3 原文即注明"教师/系统下发",属契约漏写,纯增量。服务端 A6 已实现该事件。
- [2026-06-12,经仲裁批准] AttemptModule 增加 exports: [AttemptService](非契约文件,
  跨任务边界改动报备):供 ClassroomModule 复用判分口径。
- [2026-06-13,经仲裁批准] 题目插图方案A:QuestionFigure 的 figures[] 元素增可选
  `anchor:{target:stem|option|analysis|reference|rubric, ref?}`,使选项/解析/参考答案/评分要点
  均可插图。figures 为题目级 Json,**无数据库迁移**;缺省 anchor=题干,向后兼容。
- [2026-06-13,经仲裁批准] WrongBookItem 增 `subject: string`(源自题目学科),错题本按学科分组。
- [2026-06-13,经仲裁批准,行为约定非契约字段] 填空混合判分:简单填空(纯数字/文本)即时判分;
  含公式(参考答案为 LaTeX)的填空走 AI 预批+教师复核(与解答题同管线,answer.isCorrect 置空待批),
  检测规则由后端实现(参考答案含 LaTeX 控制符即视为公式填空),无新增契约字段。
- [2026-06-13,经仲裁批准] 学生改密码登录:新增 `POST /auth/student/login {studentNo,password}`,
  删除 `/auth/student/qr-exchange`;`/admin/students/{id}/login-ticket` 改为 `/admin/students/{id}/reset-password`
  (返回明文临时密码,无短信)。去掉扫码/设备绑定/额度(平板留机构内用)。devices/login_tickets 表保留不用。
- [2026-06-13,经仲裁批准] 入班:新增 `POST /admin/courses/{id}/students {studentIds}`(幂等 active)
  与 `DELETE /admin/courses/{id}/students/{studentId}`(置 quit)。
- [2026-06-13,经仲裁批准] 讲次自由编排:LessonSegment 增可空 `kp_node_id`(schema 迁移)+ DTO 增
  `kpNodeId`(读写)/`kpNodeName`(只读);发布规则放宽——不再强制四类环节齐备,仅要求至少 1 环节 +
  practice/homework 挂的卷须已发布(4201 的 detail 改为 ['empty'] 或含 'practice'|'homework')。
- [2026-06-13] 全局品牌:启明智学 → 鲸云AI教育平台(代码标识符 @qiming/* 与库名 qiming_* 保留)。
- [2026-06-13,C1联调缺口] AttemptDto 增必填 `questions: AttemptQuestionView[]`(学生作答题面;
  防作弊:correctAnswer/analysisLatex 仅该题已判或交卷后下发,否则 null);新增
  `GET /grading/assignments/{id}/answers`(教师枚举某作业逐题作答名单,?status=pending|graded)。
- [2026-06-13,C1第一轮发现的8个问题修复] ① 教师 reset-password 返回明文密码(去短信,同学生);
  ② 新增 `POST /admin/teachers|students/{id}/enable`(启用),停用只置 status=disabled 不软删,
  /admin/students 加 ?status 过滤;③ 讲次=知识点单元:LessonSegment 加 `unitSeq`(同 unitSeq+kpNodeId
  为一单元,固定三段讲解lecture/随堂练practice/小结summary),Lesson 加 `openingConfig`(开场白,
  经 PUT /lessons/{id} 读写);④ Question 加 `analysisBriefLatex/analysisDetailLatex`(三种解析:
  简单/正常/详细);⑤ 进课堂改为按 lesson.status 发布即可进(去掉到点时间校验);⑥ TexText 升级为
  标准 Markdown+LaTeX($行内/$$行间)。入班候选/工作台按钮重复为纯前端 bug 已修。
  [待跟进] 学生视图(WrongBookItem/AttemptQuestionView)三种解析字段未加,学生侧暂只见正常解析。
- [2026-06-14,经仲裁批准,B6课堂真实模式] 在线课堂真实下发讲义/随堂题:`ws-protocol.ts` 的
  `ClassSnapshot` 增两个**可选**字段 `questions?: AttemptQuestionView[]`(随堂练题面,复用 C1 学生
  安全视图,课中 correctAnswer/analysisLatex 恒 null 防作弊)与 `courseware?: CoursewarePageView[]`
  (课件分页);`dto.ts` 新增 `CoursewarePageView`(title/body/narration/quiz?)与 `MiniQuizView`
  (课件打点小测,客户端本地反馈不走判分)——原为 apps/student 本地类型,真实下发需提升进契约。
  **可选字段、向后兼容、无 schema 迁移**(后端纯只读组装 lesson_segments→paper/resource);缺省时
  前端 applySnapshot 优雅降级。
- [2026-06-14,经仲裁批准,B6课堂] `LessonDto` 增**必填** `sessionId: number | null`(当前讲次最新
  未结束 ClassSession id,供教师课堂监控页拿真实 sessionId 连 WS;无在开会话则 null)。取数复用
  既有 `latestOpenSessions` 口径(查 class_session where lessonId in […] and status≠'ended',
  orderBy id desc 每讲取首条)——提取为共享 helper `apps/server/src/common/session-lookup.ts`,
  列表端点(/courses/:id/lessons、/student/courses/:id/lessons)批量一次 in 查避免 N+1,detail 单查;
  与学生端 `LessonTimelineItem.sessionId` 先例同口径。**无 schema 迁移**(纯只读查询);三端构造 LessonDto
  的 mock/fixture 同步补该字段(已发布讲次带会话 id、其余 null)。
- [2026-06-15,经仲裁批准·AI管理] 管理端新增「AI 接口管理」契约(只动 packages/contracts):`dto.ts` 增
  `AiProviderConfigDto`(读,`apiKeyMasked` 脱敏绝不回明文 / `source: runtime|env`)、`AiProviderConfigInput`
  (写,`apiKey?` 留空=保留现有不覆盖)、`AiFeatureRoutesDto`(qa/pre_grading/class_companion/diagnosis 各
  `real|mock`)、`AiTestResultDto`,并补 `AiFeatureMode` 类型;`openapi.yaml` 增 `GET/PUT /admin/ai/config`、
  `GET/PUT /admin/ai/routes`、`POST /admin/ai/test`(body 可选 `{feature?}`),严格仿 `/admin/ai-quota` 写法
  (data 包裹 + OkVoid + default Err)。口径:**全局一把 key**(机构间不分租户,管理员运行态配置 base_url/
  model/key)、**运行态可改不重启**(存 Redis `a7:ai:provider`/`a7:ai:routes`,env 为兜底,生效来源由 `source`
  标识)、新增**并发闸** `concurrency` 字段(全局同时在飞的 LLM 调用上限)。**无 schema 迁移**(纯运行态配置)。

## 2026-07-02 全功能核验后的契约/schema 变更(经用户仲裁批准)
- [schema,迁移0002] `Assignment` 增可空 `teacherId BigInt?`(列 teacher_id,+索引 org_id,teacher_id;批准文本为 Int?,因 users.id 为 BIGINT 按惯例取 BigInt,DTO 不暴露):教师发布(homework/in_class/correction/consolidation)=发布者,学生自发(wrong_redo)=null;存量按 lessons→courses 回填。归属统一口径 assignment-ownership.util.ts:teacherId=本人 ∨ (null 且课程锚点属本人);null 且无锚点→任何教师不可见。**修复红线**:任何教师可读他人 studentIds 定向作业的批改数据 + 定向作业不在创建教师总览。
- [契约] openapi 补 `DELETE /admin/students/{id}`(停用学生,照教师停用口径,OkVoid);管理端学生页补停用按钮+mock。
- [无契约] 手机号格式校验(^1[3-9]\d{9}$,Teacher/Student 写入 DTO);重置/修改密码吊销旧 accessToken(Redis auth:pwdreset:{userId} 记 epoch 秒,JWT 守卫 iat< 值则 401,fail-open)。
- [定性不修] finalize 重复调用返回 200 幂等空操作(CAS 已防重复入账),不改 409。

## 2026-07-05 契约变更(经用户批准,task/contract-teacher-comment)
- [契约] 学生 attempt 视图 `AnswerDto` 增**可选** `teacherComment?: string`(教师复核点评/知识点点评):
  现状 comment 只存 grading_records、只回教师端 GradingItemDto,学生端零出口,而教师批改页文案承诺
  「将随解析推送给学生」——本变更兑现该承诺。口径:仅 attempt 已 finalize(status=graded)且教师写了
  非空点评时下发;未 finalize / 空点评一律省略字段(与解析同门禁,防提前泄露批改中间态)。
  `openapi.yaml` Answer schema 同步增字段并重新 gen:sdk;**无 schema 迁移**(读现有 grading_records.comment,
  attempt 详情 include grading 批量取,无 N+1)。学生端 ResultView 逐题「我的答案」下有点评时展示「老师点评」块
  (沿用现有卡片样式);错题本卡片刻意不做(控制变更面)。e2e:fixc-comment 套件(139594 号段,qiming_fixc 库)
  验 finalize 前不下发/后下发/空点评不下发;student vitest 两态渲染。
- [新发现缺口,留二期] wrong_redo 含主观题(solution/公式填空)时交卷停在 submitted 无人批(teacherId=null 不进任何教师批改列表;此前靠"全机构可见"的越权面误掩盖),correct_redo_count 不累计;需产品决策(重做限客观题 or 归口授课教师)。

## 2026-07-06 契约变更(经用户批准,task/subject-filter)
- [契约] `GET /questions` 增**可选** query 参数 `subject?: string`(按学科精确匹配,如 数学/物理/化学):
  题库已 143 题混装数学/物理/化学,而列表接口无学科筛选,教师端题库页与组卷选题器全学科混杂卡使用。
  口径:空串或缺省 = 不按学科过滤(与既有 keyword/type 同门禁,falsy 不进 where);向后兼容、**无 schema 迁移**。
  `openapi.yaml` GET /questions parameters 增该项并重新 gen:sdk;后端 `QuestionListQueryDto` 增
  `@IsOptional() @IsString() @MaxLength(16) subject?`,`question.service.list()` where 增 `...(q.subject ? { subject: q.subject } : {})`。
  教师端:题库列表页筛选行加「学科」下拉(全部/学科),组卷选题弹窗(QuestionPicker)加学科筛选并把 subject
  透传服务端拉取(`collectQuestionPages` 增 subject 参数,减少翻页量);讲次组卷(PaperBuilderPage)默认预选
  该讲次所属课程的学科,独立组卷(PaperEditorPage)默认全部。学科常量 `SUBJECTS` 统一收敛到
  `bank/lib/transform.ts`(题库/组卷/录题三处复用,不再散落字面量)。e2e:question 套件补 subject 过滤用例
  (=物理只返物理、不传=全部、空串不过滤);teacher vitest 补 collectQuestionPages 透传 + resolveDefaultSubject 预选。

## 2026-07-06 契约变更(经用户批准,task/student-history)
- 背景/用户原话:「学生端需要可以看到以前的课程、以前的题目。现在只能看到当前的,导致什么都没有,这个东西不是一次性的。」
  调研:历史数据都在(`GET /student/assignments?status=all` 有全部历史;课程时间线 myHomework 有 assignmentId/score/wrongCount),
  但已完成作业只是不可点的静态分数标签,题目/我的答案/解析没有任何前端出口,学生端也没有「作业历史」页;
  而 `useAttempt` 的 `?attempt=` 恢复机制对已判分 attempt 会直接进 ResultView(含题目/我的答案/解析/老师点评)——
  只要拿到 attemptId 即可打开成绩单。故本变更「给历史一个入口」。
- [契约] `AssignmentDto` 增**可选** `myAttempt?: { attemptId: number; status: 'in_progress'|'submitted'|'graded'; score: number | null } | null`:
  **学生视角**下发本人对该作业的最新一次 attempt(历史页/时间线据此直达成绩单);**教师视角不下发**(字段缺失)。
  学生可见但从未作答 → null。`assignment.service.listForStudent` 批量查 attempt(按 attemptNo 取最新,防 N+1)后经
  `toDto(a, myAttempt?)` 附带;教师侧 `create()` 不传该参数 → 出参不变。**无 schema 迁移**。
- [契约] 学生课程时间线 `LessonTimelineItem.myHomework` 增 `attemptId: number | null`(本人最新 attempt id;从未作答为 null,
  与既有 `score` 同源)。`student-misc.service.lessonTimeline` 顺手带出已查到的 attempt id。openapi 内联 schema 同步 required。
- 学生端:新增「作业」历史页(路由 `/homework` 列表页,与既有答题器 `/homework/:assignmentId` 并存),用
  `GET /student/assignments?status=all` 分「待完成/已完成」两组——待完成点击进答题器;已完成点击 →
  `/homework/{id}?attempt={myAttempt.attemptId}` 直接看成绩单;导航栏加「作业」入口(仿今日/课程/错题本/报告)。
  课程时间线「作业 X 分」Tag 在 `myHomework.attemptId` 有值时变为可点(同样跳 `?attempt=`),缺失时保持不可点。
  mock 数据 assignments 补 myAttempt、timeline 补 attemptId。openapi 同步 + gen:sdk + lint:openapi。
  e2e:student-history 套件(139597 号段,qiming_fixe 库)验学生列表带 myAttempt(graded 有 score/未作答为 null)、
  教师侧不带、时间线 attemptId 正确;既有 a4/a5/fix1 的 AssignmentDto/myHomework 键集断言同步更新。
  student vitest 补历史页两组渲染+点击跳转、时间线分数可点两态。

## 2026-08-22 契约变更(经用户批准,task/courseware)
- 口径:教师端「AI 生成课件」= 教师贴文字稿 → 文本 LLM 出**逐页大纲**(title/body/imagePrompt)→ 教师逐页
  编辑确认 → 后端逐页调 GPT Image **生整页幻灯片图片** → 全部页成功后成品落 `Resource`(type=ppt)。
  `jobId` 为 **Redis 运行态字符串**(非自增数字 id),**任务状态不落库**(队列/逐页进度只在运行态),
  故 `GET /courseware/jobs/{jobId}` 的 path 参数用 `{type: string}` 独立声明,**不复用**数字 `idPath`;
  任务过期/不存在按 404 口径返错。整套课件一个风格:`style.id` 为内置风格,`id='custom'` 时 `customText`
  为教师描述的视觉主题(风格清单与提示词模板归服务端 ai 配置,前端只传 id)。
- [schema,迁移0003] `enum AiFeature` 增第 5 个值 `courseware`(供 ai_usage_logs.feature 记账与真假路由)。
  新增 `prisma/migrations/0003_ai_feature_courseware/migration.sql`:仅一条 PG
  `ALTER TYPE "AiFeature" ADD VALUE IF NOT EXISTS 'courseware'`,**追加在枚举末尾、无表结构变化**;
  因 PG 的 ADD VALUE 新值不能在同一事务内被引用,迁移刻意只放该单条语句且不自带 BEGIN/COMMIT
  (沿用 0001/0002 的 `psql -v ON_ERROR_STOP=1 -f` 逐条自动提交口径)。本会话**只写迁移文件,未对任何库执行**。
- [契约] `openapi.yaml` 增 4 个端点(全部 [teacher],严格仿既有写法:data 包裹 / OkVoid / default Err / 复用 components):
  `POST /courseware/outline`(body `{sourceText(必填,≤8000)、pageCount(3-20)、lessonId?、kpNodeId?、style(必填)}`
  → `{pages: CoursewareOutlinePage[]}`)、`POST /courseware/jobs`(body `{name(必填)、lessonId?、kpNodeId?、
  style(必填)、pages(必填 1-20 页)}` → `{jobId: string}`)、`GET /courseware/jobs/{jobId}`(→ `CoursewareJob`)、
  `POST /courseware/jobs/{jobId}/retry`(重试失败页 → OkVoid)。新增 components schema
  `CoursewareStyleInput` / `CoursewareOutlinePage` / `CoursewareJobPage` / `CoursewareJob`
  (建任务的 pages 直接复用 `CoursewareOutlinePage`,与大纲出参同形)。
- [契约] `dto.ts`:`AiFeature` 联合镜像加 `'courseware'`;`AiFeatureRoutesDto` 增**必填** `courseware: AiFeatureMode`
  (第 5 个真假路由开关,openapi 的 `AiFeatureRoutes` required 同步);新增 `CoursewareStyleInput`、
  `CoursewareOutlinePageDto`、`CoursewareJobPageDto`(seq/title/status + `imageUrl?`)、`CoursewareJobDto`
  (jobId/status/total/done/pages + `resourceId?`);形状以已走查通过的 teacher mock 报文为基准正式化。
- [契约] `CoursewarePageView` 增**可选** `imageUrl?: string`(课堂下发整页图片课件用):有该字段则课堂整页渲染
  图片,缺省则按 title/body 文字渲染。**可选、向后兼容、无 schema 迁移**;本波只加字段,**课堂组装(ClassSnapshot
  →courseware)后续接线**。
- 影响的端:**teacher 主用**(前端已按 mock 实现并走查通过,待把 `pages/courseware/lib/types.ts` 的本地类型
  切回从 `@qiming/contracts` 导入);**admin** 的 AI 接口管理页需补 `courseware` 真假路由开关(`AiFeatureRoutesDto`
  必填字段,admin mock/fixture 需同步补该字段否则键集断言失败);**student 课堂**本波不动,仅预留 imageUrl。
- mock 与 e2e 计划:teacher msw 已有 4 个端点的有状态 mock(形状与本契约一致,唯 `GET jobs/{jobId}` 的
  mock 报文未带 `jobId`,后端实现须按契约补上);admin mock 补 routes 的 courseware 字段;新建 e2e 套件
  `courseware` 用**独立库**(仿 fixc/fixe 的独立库+号段隔离口径),验大纲出参/建任务/轮询进度/重试失败页
  与租户隔离。`gen:sdk` + `lint:openapi` + `check` 三连已过(paths=77 / operations=97)。

## [2026-08-22,经用户批准,task/audit-fix] 契约包纯增量导出 ApiError 与 ERROR_CODES 常量,无 schema/端点变化
- `packages/contracts/src/index.ts` 补 `export { ApiError }`(类本就在 `client.ts` 导出,只是出口文件漏转):
  三端此前只能对 `createClient` 抛出的错误做鸭子类型判定(`apps/student/src/api.ts`、
  `pages/courseware/lib/progress.ts`、`pages/lesson/lib/segments.ts` 均有自白注释),现统一改 `instanceof ApiError`。
- 新增 `packages/contracts/src/error-codes.ts`,导出 `ERROR_CODES` 常量对象 + `ErrorCode` 类型,
  把散落三端的裸字面量 4000/4040/4201/4301/4302/4303/4501/4502/4503/4504/4601/4602 集中命名。
  码值与语义**逐个对照服务端各域 codes 文件核实**,不新增、不改写任何码值:
  `course/business.exception.ts`(4201/4302/4303)、`question/business.exception.ts`(4301)、
  `grading/business.exception.ts`(4501/4502/4503)、`ai/ai.codes.ts`(4501 QA 限流别名 /4504/4601/4602)。
  4000/4040 是 msw mock 的四位约定,真实后端 `AllExceptionsFilter` 写的是 HTTP 状态码,注释里已标明两边都要认。
- **无 openapi.yaml 变化、无 dto.ts 变化、无端点/schema 变化**,`gen:sdk` 无需重跑;`npm run check` 已过。

## [2026-08-27,经用户批准,task/beta-zone] E1 内测区与功能分级:契约 4 端点 + 迁移0004 + 错误码 4701
- 口径:功能三级流水线 **lab(本地实验)→ beta(白名单账号)→ ga(按角色全量)**;`off`=全员不可见仅管理端登记。
  功能目录为**服务端代码内静态注册表**(`src/features/feature-catalog.ts`:key/name/description/audienceRole/
  defaultStage/knownIssues/acceptance),库表只存覆盖值与白名单;首批条目 `ai_courseware`(teacher,beta)、
  `photo_pregrade`(student,off)。需求唯一事实见 `tasks/E1-内测区与功能分级.md`。
- [schema,迁移0004] 新表 `feature_flags`(org_id+key 唯一,stage VARCHAR16 应用层校验)与
  `feature_access`(org_id+feature_key+user_id 唯一,白名单)。
- [契约] openapi/dto 增 4 端点:`GET /features/my`(任意已登录;ga 按 audienceRole 全下发、beta 仅白名单、
  off 不下发)、`GET /admin/features`(目录全量+stage+白名单明细+登记信息)、`PUT /admin/features/{key}`
  (body {stage},upsert;未知 key 404)、`PUT /admin/features/{key}/whitelist`(body {userIds},**replace 语义**,
  跨机构/不存在用户 400 不落库)。新增 schema `MyFeature/AdminFeature/AdminFeatureWhitelistItem/FeatureStage`;
  错误码新开 47xx 段:`FEATURE_NOT_ENABLED=4701`(HTTP 403,detail:{key}),contracts error-codes.ts 纯增量。
- 服务端硬门禁:courseware 4 端点挂 `FeatureGateService.assertEnabled`(UI 隐藏不是安全边界);
  拍照预批入队用非抛错 `isEnabled` 跳过(不打断作答),且与既有机构开关 `org.settings.ai.preGrading` 为 **AND**;
  admin 的 stage/白名单变更写 audit_logs。备案:wrong_redo「重做只组客观题+全主观 4503」为存量已实现,E1 仅补 e2e。
- 前端:教师端新增「实验室」分区(「AI 生成课件」入口自资源库页迁入;/courseware 路由不变,守卫按
  /features/my + 4701 双路拦截);学生端**删除**「回看课件」死按钮及 mock 自造 resources 字段(契约本无此字段),
  预批展示按 flag 隐藏(**含课堂预批结果卡**,范围宽于服务端 gate 属有意为之;拍照作答上传能力不受影响);
  管理端新增「实验室管理」页(阶段下拉+白名单弹窗)。新增 `apps/lab`(5176,本地实验专用永不部署,不进 deploy/CI)。
- 验证:新套件 feature-flags 18 用例;受影响 fixtures(courseware/a7/impl-back/c1gap 等)显式 INSERT flag 作为新前置;
  三端 vitest teacher 284/student 147/admin 67 全绿+三端 build+contracts 三连;合并前全量 e2e 回归(结果记路线图)。

## [2026-08-31,经用户批准·结构性债务计划 Wave 1] npm workspaces 迁移(contracts 仅打包语义变更,无契约内容变化)
- 仓库根新增 `package.json`(workspaces: apps/* + packages/*),全仓统一 `package-lock.json`,
  删除各目录 7 份 lockfile;根编排脚本 `check:all / test:mock / e2e`(本地与 CI 同源)。
- [contracts,纯打包语义] `packages/contracts/package.json` 增 `"type": "module"`:workspaces 提升后
  tsx/node 直跑的脚本(三端 `test:mock`)经 node_modules 符号链接按 CJS 互操作解析 contracts 源码,
  `export *` 的具名导出(如 ERROR_CODES)会丢失;声明 ESM 后恢复。**openapi.yaml / dto.ts / 端点 /
  schema / 错误码零变化**,`gen:sdk` 无需重跑。vite/tsc/nest build/e2e 路径不受影响。
- 三端 `vitest.config.ts` 删除旧布局时代把 react/katex 硬别名到 `<app>/node_modules` 的条目
  (提升后路径不存在,vi.mock 组件测试解析失败);dedupe 保留。
- 两个 Dockerfile 装依赖层改为根 lockfile + `npm ci --workspace=<目标>`(web 的 `pkgs` 阶段并入 deps)。
- 验证:contracts 三连 + ui 84 + admin 67 / teacher 284 / student 147 + 三端 build + lab build +
  server build + 三端 mock 冒烟 + 全量 e2e 30 套件/332 用例全绿;两镜像构建成功 +
  compose.prod 一次性栈冒烟(/healthz ok、三端页面 200、init:prod 建号登录成功)。

## [2026-08-31,经用户批准·结构性债务计划 Wave 3] 契约收口:3 个 uploads/storage 灰色端点进 OpenAPI(纯文档化,零行为变化)
- openapi.yaml 纯增量 3 路径(81→84 paths / 101→104 operations),形状照抄现有实现:
  `GET /uploads/view-url?ossKey=`([*] 已登录,返回 data:{url},仅放行本机构前缀 key)、
  `PUT /uploads/local/{token}`(security:[] 即 @Public,一次性 token 即凭证,application/octet-stream
  二进制 body,返回 data:{ossKey,size},25MB 上限)、
  `GET /storage/{ossKey}?exp&sig`(security:[],HMAC 签名即凭证,响应二进制;服务端为通配路由,
  契约以单参数表达多段路径,已注明)。
- 前端:student/teacher `api.ts` 的 fetchViewUrl 去掉 `as unknown` 类型放宽,改完全类型化调用;
  `uploadAnswerPhoto` 对预签名**绝对 URL** 的原生 PUT 保留为仓库唯一豁免(sts 下发的直传地址,
  OSS 驱动下指向外部对象存储,不属 createClient 相对路径语义),注释已标明豁免理由。
- server 端 upload.controller 三处「不属于 openapi 契约」过时注释同步更新;dto.ts 无变化。
- 验证:gen:sdk + lint:openapi + contracts check 三连、三端 build+test、upload e2e。

## [2026-08-31,经用户决策·假功能全部下线] 只保留真实闭环;openapi/dto/ws-protocol 零变更
- 口径:凡真实模式下以 stub/模板/mock 冒充真实能力的呈现,一律下线并留需求档
  (`qiming/docs/需求文档/2026-08-31-下线功能需求留档.md`:原始需求/可复用资产/重启验收条件)。
- 服务端:`feature-catalog.ts` 的 `ai_courseware` defaultStage beta→**off**(真实生图一并下线);
  课堂快照组装排除历史 ai_courseware 资源(原 P1-8 整页图签名逻辑随之移除,git 可寻);
  课堂作答旁白 narration 不再生成/下发(ack 置 null,协议字段本可空;`class:narration` 事件保留未删);
  `seed`/`init:prod` 的 org.settings.ai `classCompanion/diagnosis` 默认 true→**false**。
- 前端:教师端删写死「AI 预批·已开启」卡、批改/组卷文案改人工口径、学情页诊断按钮按
  org 设置条件渲染;学生端删「小启」旁白条(ClassFoot)与小结「AI」包装、「AI 伴学课堂」改「在线课堂」;
  管理端伴学/预批/诊断三开关改「已下线」登记态(防一键恢复假功能),删 Placeholder 死代码。
- 保留:AI 答疑(qa,真实接入,**部署须配 LLM_API_KEY**)、拍照上传(人工批改)、全部真实统计聚合、
  批改页历史 aiScore(如实标注)。
- e2e 断言随产品口径更新:feature-flags 默认态 off、a6 narration 恒 null 且事件不发、auth seed 设置。
- 验证:鲜库(重建+全量 seed)全量 e2e 30 套件/334 用例**连续三轮全绿**;check:all + 三端 mock 冒烟绿;
  真实栈冒烟(三角色登录、admin 发学生密码→学生登录闭环、features/my 空、diagnose 403)。

## [2026-09-02,经用户批准,task/workspace-tidy] 无契约内容变化:记录迁入本文件;`apps/lab` 迁至 `labs/playground`
- openapi.yaml / dto.ts / ws-protocol.ts / design-tokens.ts / error-codes.ts / schema.prisma **零变化**,`gen:sdk` 无需重跑。
- 仓库结构:`apps/lab` → `labs/playground`(根 workspaces 加 `labs/*`),退出根 `check:all`,CI 增非阻塞 `labs` job;
  两个 Dockerfile 仅同步 workspace `package.json` 的 COPY 路径。属协作纪律第 1 条(顶层目录)变更,记录见 `docs/00-协作纪律.md`。
- 协作纪律(原宪法 8 条 + 安全待跟进)迁至 `docs/00-协作纪律.md`;契约变更记录迁至本文件。此后两处各自追加,不再回写开工包。

## [2026-09-02,经用户批准,task/walk-contract] 走查修复:试卷分类 + 草稿态、课堂课件下发
- 口径来源:`docs/需求文档/2026-09-02-系统全面走查-缺陷清单.md` A-2 / F-6 / B-2,用户拍板「试卷要草稿态」。
- [契约·Paper] `PaperDto` 增**必填只读** `subject: string | null`(卷内题目学科聚合:全一致取该学科,混合取众数,空卷 null)
  与 `kpNodes: {id,name}[]`(卷内题目的教材知识点去重)。服务端从 `paper_questions → questions / question_tags` 推导,**不落列、无迁移**。
  `GET /papers` 增可选 query `subject?` / `kpNodeId?` / `status?: draft|published`(缺省不过滤)。
- [契约·草稿] `PaperInput` 增可选 `status?: 'draft'|'published'`(缺省 published,现有调用不变);新端点
  `POST /papers/{id}/publish`([teacher],draft → published,已 published 幂等 200,创建者本人或 admin)。
  草稿卷不可挂讲次 practice/homework(发布检查 4201 照旧拦)、不可布置作业;`papers.status` 列已存在,无迁移。
- [契约·WS] `CoursewarePageView` 增可选 `resource?: { type: ResourceType; name: string; url: string }`:
  讲解环节挂的非结构化课件以签名直链下发(有效期同 view-url,重连新快照重签);学生端按 type 渲染。
  此前快照只组装 `config.pages`/`meta.pages` 的结构化页,教师上传的课件在课堂里永远「暂不可用」(走查 B-2)。
- 影响端:teacher(试卷库 / 编排三处选卷面板按学科筛,组卷页保存草稿 / 发布,mock 数据补 subject/kpNodes)、
  student(LectureSegment 按 resource.type 渲染,mock 快照可选补)、admin 无。
- 验证:gen:sdk + lint:openapi(85 paths / 105 operations)+ contracts check 三连;server 侧 paper/e2e 见 task/walk-contract 后续提交。
