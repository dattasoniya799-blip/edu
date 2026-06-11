# @qiming/server · A1 交付(后端骨架 + 认证 + 多租户 + RBAC)

## 怎么跑

```bash
# 前置:docker compose -f ../../docker-compose.dev.yml up -d(Postgres+Redis)
#       且已按 W0 README 完成迁移与 seed
npm install
npx prisma generate
npm test            # e2e 验收(连真实 Postgres/Redis,用 seed 数据)
npm run build && npm start   # 或 npm run start:dev;默认 :3000,healthz 在根路径
```

## 实现概览(任务卡 A1)

| 要求 | 落点 |
|---|---|
| org_id 自动注入(Client Extension + ALS) | `src/prisma/prisma.service.ts` + `src/common/tenant-context.ts` |
| 认证六接口(严格按 openapi.yaml) | `src/auth/`(login / qr-exchange / refresh 轮换 / logout / me / password) |
| scrypt 兼容 + 首登静默升级 argon2 | `src/auth/password.util.ts` |
| @Roles() + Guard | `src/common/decorators.ts`、`src/common/guards/` |
| 全局异常过滤器 {code,message,detail} | `src/common/filters/all-exceptions.filter.ts` |
| AuditService 写 audit_logs | `src/audit/audit.service.ts` |
| pino 日志手机号脱敏 | `src/common/logging/mask.ts` + `app.module.ts` redact/hooks |
| healthz / CORS / config 读 .env | `src/app.controller.ts`、`src/main.ts` |

设计要点:
- 租户机制三层防线:① 扩展对读/改/删自动 `AND {orgId}`、create 自动填充;② Org 表限定 `id=当前org`;③ **无上下文的查询直接抛错**(仅 auth 登录流程经 `runWithoutTenant` 显式豁免)。
- 刷新令牌存 Redis(schema 无 refresh 表,不动契约):`rt:{jti}` 一次性轮换,重放→401;改密/登出全量作废。
- ALS 注意点:PrismaPromise 是惰性的,`runWithoutTenant/runAsUser` 内部强制在上下文内 await(详见 tenant-context.ts 注释)。

## 验收项 ↔ 测试映射(npm test,18 用例全绿)

| 任务卡验收项 | 测试 |
|---|---|
| 两机构互查任何资源 → 404 | tenant-rbac:`两机构互查资源 → 404` |
| 无 token → 401 | auth:`无 token 访问 /me → 401`;tenant-rbac:`无 token 调 /admin/*` |
| teacher 调 /admin/* → 403 | tenant-rbac:`teacher 调 /admin/* → 403;admin → 200` |
| ticket 兑换成功且第二次失效 | auth:`学生 ticket 兑换成功且第二次失效` |
| 设备重复绑定被拒 | auth:`设备重复绑定被拒` |
| 管理员登录 → /me 返回 org settings | auth:`管理员登录 → /me 返回 org settings` |
| (附)scrypt→argon2 静默升级 | auth:`seed 的 scrypt 哈希在首次登录后静默升级` |
| (附)刷新轮换/登出/改密/审计 | auth 其余用例 |

测试夹具说明:`test/fixtures/probe.module.ts` 是**仅 e2e 挂载**的探针控制器(/admin/__probe、/__probe/users/:id),用于在 A2 业务接口落地前验证门禁与租户隔离,不进生产代码、不属于 openapi 契约。

## 边界声明

- 负责目录为 `apps/server/src` + 工程配置(package.json/tsconfig/.env.example/test);未触碰 `packages/contracts` 与业务域接口。
- 契约变更(已批准):`prisma/schema.prisma` 枚举重排为合法多行格式,零语义变化(原单行写法无法通过 `prisma generate`)。
- 短信发送(A2 重置密码用)未涉及;LLM 一律走 A7 AiGateway,本任务无 AI 调用。

---

# A2 交付 · 管理员域接口(/admin/*)

## 范围与落点

openapi.yaml 全部 `/admin/*` 接口,代码集中在 `src/admin/`(仅在 app.module.ts 挂载 AdminModule):

| 接口组 | 落点 |
|---|---|
| teachers CRUD + 重置密码 | `src/admin/teachers.service.ts` |
| students CRUD + 档案 + 登录码 + 解绑设备 | `src/admin/students.service.ts` |
| courses CRUD(创建自动生成空讲次)+ roster | `src/admin/courses.service.ts` |
| dashboard / ai-usage×3 / ai-quota / settings / audit-logs | `src/admin/insights.service.ts` |
| 短信(日志模拟,手机号脱敏、密码与登录码不落日志) | `src/admin/sms.service.ts` |
| 请求 DTO(校验对齐 openapi) | `src/admin/admin.dto.ts` |

复用 A1 骨架:租户注入 PrismaService、@Roles + Guards、AuditService、统一响应包/异常过滤器;
`/admin/settings` GET 直接复用 AuthService.me。无原生 SQL、无 LLM SDK。

## 简化口径(裁剪手册 1.1)与字段语义约定

- AI 用量:只做 本月总额 + 按功能拆分 + 近 N 日曲线;额度只存 monthlyLimit/alertThreshold/overPolicy(告警动作本身由 A7 网关消费)。
- 设置:仅 引导模式(ai.qaGuideOnly)与 使用时段(studentHours)可写,其余设置保持原值。
- `Course.currentLesson` = 已 finished 讲次数;`nextLessonAt` = 未来最近一讲开始时间。
- `attendanceRate` / `homeworkRate` 为 0–1 比例(到课率=已结束会话实际加入率;作业率=homework 交卷率),无数据 → null;
  roster 的 `attendance` 为 "实到/应到(已结束会话数)" 字符串,`homeworkAvg` 为得分率均值(0–100)。
- `weekStudySec` = 近 7 天 attempts.duration_sec 求和(UTC 窗口);AI 用量各时间窗一律 UTC。
- 创建学生即生成 7 天有效登录码并"短信"通知家长;重发登录码会作废旧票。
- 缩减课程讲次数:仅当多余讲次为未编排的 draft(无环节/无作业)时允许,否则 409。
- 新学生 status=pending,首次扫码登录由 A1 流程激活;停用教师=软删(deletedAt+disabled)并作废其刷新令牌。

## 验收项 ↔ 测试映射(npm test 43 用例全绿 = A1 18 + A2 25,test/admin.e2e-spec.ts)

| 任务卡验收项 | 测试 |
|---|---|
| 创建课程 → lessons 出现 N 条 seq 连续记录 | `创建课程 → lessons 自动生成 N 条 seq 连续记录(验收项)` |
| 学生档案 mastery / wrongOpenCount 与 seed 手算一致 | `学生档案:mastery 与 wrongOpenCount 与 seed 手算一致(验收项)`(按 seed 口径从 answers×question_tags 重新聚合比对) |
| dashboard 数字与 seed 对账 | `dashboard 数字与库一致` |
| ai-usage 数字与 seed 对账 | `ai-usage/summary 与 seed 8 条 ai_calls 对账`(13480 tokens / ¥0.18)、`ai-usage/daily 零填充且与库逐日一致`、`ai-usage/breakdown 按功能与库一致、占比合计≈100` |
| 重置密码写 audit_logs | `重置密码 → 写 audit_logs(验收项)且短信仅日志模拟` |
| 响应结构与 openapi 逐字段一致 | 全部用例:`@qiming/contracts` 类型断言 + `exactKeys` 精确键集合比对(Teacher/Student/Course/Mastery/Summary/Breakdown/Dashboard/Roster/Me 等) |
| 跨租户 404(宪法 §7) | `跨租户互查 → 404;列表彼此不可见`、`创建课程引用他租户教师/学生 → 404` |
| 其余 CRUD/过滤/登录码/解绑/额度/设置/审计 | teachers/students/courses/ai-quota/settings/audit-logs 各 describe |

测试夹具:自建机构与用户全部使用 1391 开头手机号,afterAll 逆依赖清理并还原 seed 的 ai_quotas 与 org.settings;seed 数据只读对账,套件可重复执行。

## 边界声明

- 改动范围:`src/admin/**`、`test/admin.e2e-spec.ts`、`README.md` 本节;`app.module.ts` 仅新增 AdminModule 的 import 与挂载。
- 未触碰:packages/contracts、prisma/schema.prisma、A1 其余骨架文件。

---

# A3 交付(知识图谱只读 + 题库 + 直传凭证)

负责目录:`src/kp/`、`src/question/`、`src/upload/` + 对应 e2e;`app.module.ts` 仅追加三个模块注册。

## 实现概览

| 要求 | 落点 |
|---|---|
| /kp/graphs /kp/nodes 只读(graphId 必填,grade/chapter/keyword 过滤) | `src/kp/`(graphId 指向他 org 或不存在 → 404) |
| 题目 CRUD + create 校验 + publish + 软删 | `src/question/`(校验集中在 `question.service.ts#validateInput`,create/put 共用) |
| 被 paper 引用时删除 → 业务码 4301 | `src/question/business.exception.ts`(HTTP 409,响应体 `code=4301`;控制器级过滤器就近覆盖全局过滤器) |
| /uploads/sts 直传凭证(storage 适配器) | `src/upload/`(详见下) |

## storage 适配器说明

- 接口:`src/upload/storage/storage.adapter.ts` 的 `StorageAdapter.presignPut(ossKey, expiresSec)`;
  注入 token `STORAGE_ADAPTER`,驱动由 `.env` 的 `STORAGE_DRIVER` 选择(默认 `local`)。
- **local(MVP,本地磁盘模拟 OSS)**:`local-storage.adapter.ts`。预签名 = 一次性 token(Redis,TTL 300s)
  + 上传端点 `PUT /api/v1/uploads/local/:token`(`@Public`,token 即凭证,Redis GETDEL 原子消费,复用 → 403;
  单文件上限 25MB)。该 PUT 端点等价于 OSS 的外部直传地址,不属于 openapi 契约。
- **oss(生产占位)**:`oss-storage.adapter.ts`,选用即报错提示,接入阿里云 STS 时替换实现即可,业务代码零改动。
- 环境变量(均有默认值,未写入 .env.example 以免越界):
  `STORAGE_DRIVER=local` · `UPLOAD_ROOT=./storage`(落盘根目录,已加根 .gitignore)·
  `UPLOAD_PUBLIC_BASE=http://127.0.0.1:3000`(预签名 URL 的 base)。
- ossKey 形如 `{purpose}/{orgId}/{yyyyMM}/{random24}.{ext}`,原文件名只保留扩展名(防路径注入);落盘前再校验路径不越出 UPLOAD_ROOT。

## 角色口径(openapi [角色] 标注的落地)

- /kp/*:`[teacher/admin]`。
- /questions 录题:`[teacher]`;列表/详情/编辑/删除/入库:`teacher+admin` 进门禁,
  编辑/删除/入库在 service 校验「仅 owner 或 admin」(openapi PUT 描述明示 admin 可改,delete/publish 同口径)。
- /uploads/sts:`[*]` 所有已登录角色(含学生,作答照片用)。

## 验收项 ↔ 测试映射(npm test 35 用例全绿 = A1 的 18 + A3 的 17)

| 任务卡验收项 | 测试 |
|---|---|
| 录入含 LaTeX/figures/rubric 的 solution 题 → 读取逐字段无损 | question:`录入含 LaTeX/figures/rubric 的 solution 题 → 读取逐字段无损(验收项)` |
| create 校验(options 必填/正确项数量、rubric 必填、≥1 教材知识点) | question:`create 校验:选择题 options/正确项数量、解答题 rubric、教材知识点标签` |
| publish 草稿→published | question:`publish:草稿 → published;重复入库 → 400` |
| 非 owner 改他人题 403(admin 可改) | question:`非 owner 改他人题 → 403;admin 可改(验收项)` |
| 组卷引用后删除 → 4301;软删 | question:`组卷引用后删除 → HTTP 409 + 业务码 4301;解除引用后软删成功(验收项)` |
| /kp/nodes?graphId=教材&chapter=一次函数 数量与导入报告一致 | kp:`教材图谱按章节"一次函数"查询:数量与导入源文件一致(验收项)`(27 个,动态对账源 JSON) |
| 图谱节点数 / 年级分布与 IMPORT_REPORT.md 对账 | kp:`/kp/graphs:三类图谱节点数与 IMPORT_REPORT.md 入库数一致`、`grade 过滤:…与报告"年级分布"一致` |
| /uploads/sts 预签名 PUT + 一次性 token | upload:`签发凭证 → PUT 直传 → 字节落盘一致;token 一次性(验收项)` |
| 跨租户 404(宪法 §7,kp/questions 均覆盖) | kp:`跨租户:他 org 的 graphId → 404…`;question:`跨租户读他 org 题目 → 404…` |

测试夹具:`test/fixtures/a3.fixtures.ts` 自建专属机构(手机号 1392 开头)+ 机构内小型图谱,afterAll 全量清理,不触碰 seed 数据;upload 用例的 UPLOAD_ROOT 指向系统临时目录,结束即删。

---

# A4 交付 · 课程/讲次/编排/试卷/作业发布

负责目录:`src/course/`、`src/lesson/`、`src/paper/`、`src/assignment/`、`src/resource/` + `test/a4.e2e-spec.ts`、`test/fixtures/a4.fixtures.ts`;`app.module.ts` 仅追加五个模块的 import 与挂载。
(附带修复:README 中 A3 合并时遗留的 git 冲突标记 `<<<<<<<`/`=======`/`>>>>>>>` 已移除,A2/A3 两节内容逐字保留。)

## 实现概览

| 要求 | 落点 |
|---|---|
| /teacher/courses 聚合(下次上课=未来最近 lesson;到课/作业口径同 A2) | `src/course/course.service.ts`(备课进度经 Lesson.prepChecklist 下发,契约 Course 无独立字段) |
| 讲次时间线 / 详情 / 改标题时间 | `src/lesson/`(/courses/:id/lessons [teacher/admin],其余 [teacher]) |
| segments PUT 全量替换(事务)+ config 形状轻校验(设计文档 §5.2) | `lesson.service.ts#replaceSegments`(deleteMany+createMany 同事务;每次替换同步重算 prep_checklist) |
| publish 校验:四类环节齐备 + practice/homework 的 paper 已 published | `lesson.service.ts#publish`;缺失 → **4201**(HTTP 409),`detail`=缺失项列表(prep_checklist 键),并同步落库 prep_checklist;通过 → status=ready |
| papers 创建/改题重算 totalScore;被 assignment 引用禁改 → **4302** | `src/paper/paper.service.ts`(totalScore=Σscore 服务端重算,题序=数组顺序) |
| assignments:target courseId/studentIds 二选一;correction/wrong_redo 不计分;progress | `src/assignment/assignment.service.ts` |
| resources CRUD;usedByLessons 反查;被讲次引用禁删 → **4303**(detail 带引用讲次);软删 | `src/resource/resource.service.ts` |
| 业务错误码(响应体 code=业务码,HTTP 409) | `src/course/business.exception.ts`(BizException + 控制器级过滤器,模式同 A3 的 4301) |

## 口径约定(契约未明说处)

- **paper 状态**:契约无 `/papers/:id/publish` 端点 → POST /papers 创建即 `status=published`(可被编排/作业引用);schema 的 draft 留给后续流程(seed 的 published 卷与此一致)。
- **prep_checklist 五键**:`warmup/lecture/practice/summary/homework`;warmup/lecture/summary=环节存在,practice/homework=环节存在且所挂 paper 全部 published。
- 挂载约束:resourceId 仅 lecture,paperId 仅 practice/homework(400);已 in_progress/finished 的讲次禁止再编排/发布(409)。
- 教师域接口按 openapi 角色标注做门禁(@Roles),org 内不再细分 owner(契约未要求)。

## 与 A5 的边界(验收项「目标学生可见/非目标不可见」)

`GET /student/assignments` 属 A5 学生域(不在本任务负责目录),故未注册路由;可见性逻辑沉淀在
`AssignmentService.listForStudent(user, status)`(target 解析唯一口径:courseId→active 选课,studentIds→包含本人;pending/done/all 过滤),`AssignmentModule` 已 export 供 A5 直接复用。
e2e 以服务层断言(runAsUser 注入学生租户上下文)+ assignments 表数据断言完成验收。

## 验收项 ↔ 测试映射(npm test 79 用例全绿 = A1 18 + A2 25 + A3 17 + A4 19,test/a4.e2e-spec.ts)

| 任务卡验收项 | 测试 |
|---|---|
| 缺 homework 时 publish → 4201 + 缺失项,prep_checklist 同步 | `验收:缺 homework 时 publish → 4201 + 缺失项列表,prep_checklist 同步落库` |
| 补齐后 publish → ready | `验收:补齐 homework(published paper)后 publish → ready,checklist 全绿` |
| practice 的 paper 未 published → 4201 | `publish:practice 挂的 paper 未 published(draft)→ 4201,detail 含 practice` |
| 发布后目标学生可见、非目标不可见 | `验收:发布后目标学生可见、非目标学生不可见(AssignmentService.listForStudent,A5 复用口径)` |
| /teacher/courses 聚合 | `/teacher/courses:仅本人课程,nextLessonAt=未来最近讲次,字段与契约一致` |
| segments PUT 全量替换(事务) | `PUT /lessons/:id/segments 全量替换(事务)+ GET 回读;再次 PUT 旧环节被整体替换` + `segments 校验…` |
| papers 创建/改题重算 totalScore | `papers:创建重算 totalScore(验收项)…`、`papers:改题/调分重算 totalScore(验收项)…` |
| 被 assignment 引用的 paper 禁改 4302 | `验收:已被 assignment 引用的 paper 禁改 → 4302` |
| target courseId/studentIds、correction 不计分 | `assignments:整班发布…`、`assignments:定向发布(studentIds),correction 不计分…` |
| progress 对账 | `progress:totalStudents/submitted/主观题复核进度逐项对账` |
| resources 被引用禁删 4303 + usedByLessons 反查 | `resources:usedByLessons 反查;被引用禁删 → 4303;解除引用后软删成功(验收项)` |
| 跨租户 404(宪法 §7,course/lesson/segments/paper/assignment/resource 全覆盖) | 各用例内的 seedTeacher/teacherA 双向 404 断言 |
| 响应结构与 openapi 逐字段一致 | 全部用例:`@qiming/contracts` 类型断言 + exactKeys(Course/Lesson/Segment/Paper/Assignment/Resource/Progress) |

测试夹具:`test/fixtures/a4.fixtures.ts` 自建专属机构(手机号 **1393** 开头)+ 课程/讲次/题目,afterAll 逆依赖全量清理,seed 数据只读;套件可重复执行(连跑多次全绿)。

---

# A5 交付 · 作答/自动批改/复核/错题/掌握度

负责目录:`src/attempt/`、`src/grading/`、`src/wrongbook/`、`src/mastery/` + `test/a5.e2e-spec.ts`、`test/fixtures/a5.fixtures.ts`;`app.module.ts` 仅追加四个模块的 import 与挂载。新增依赖:`bullmq`(异步任务队列,设计文档既定技术栈)。

## 实现概览

| 要求 | 落点 |
|---|---|
| /student/assignments(复用 A4 `AssignmentService.listForStudent`,禁止重写 target 解析) | `src/attempt/attempt.controller.ts`(仅控制器,逻辑全在 A4 服务) |
| 开始作答幂等(in_progress 直接返回=断点续答;否则 attempt_no+1 新开) | `src/attempt/attempt.service.ts#start` |
| 单题提交:single/multi 即时判分;blank 归一化(去空格+全角转半角)比对 | `attempt.service.ts#submitAnswer / normalizeBlank`(multi 乱序判对;判错才下发 correctAnswer+解析) |
| solution 存 photoOssKey/text → 投递 BullMQ pre_grading | `attempt.service.ts` → `src/grading/pre-grading.queue.ts` |
| 交卷汇总客观分;卷面无主观题 → 自动走 finalize 流水线 | `attempt.service.ts#submit` → `GradingService.finalizeAttempt` |
| AI 预批(AiGateway stub,worker 并发 5) | `src/grading/ai/`、`grading.service.ts#processPreGrade` |
| 教师复核:pending(按作业聚合)/answers/:id(原稿签名URL+AI预批+rubric)/review/adopt-ai/finalize | `src/grading/grading.service.ts`、`grading.controller.ts` |
| finalize:final_score→answers.score、attempt 出分(graded)→ 错题入账 → 投递 mastery 重算 | `grading.service.ts#finalizeAssignment / settleAttempt` |
| 错题入账 / wrong-book 列表 / redo / redo-all(paper+assignment,scoreCounted=false) | `src/wrongbook/wrongbook.service.ts`(assignment 经 A4 `AssignmentService.create` 复用) |
| 掌握度重算(BullMQ 任务,口径=seed business 阶段) | `src/mastery/mastery.service.ts`、`mastery.queue.ts` |
| 业务错误码(A3/A4 模式,HTTP 409 + code) | `src/grading/business.exception.ts`:**4501** finalize 时仍有未复核主观题(detail=pendingAnswerIds)· **4502** attempt 状态冲突(交卷后作答/重复交卷)· **4503** 错题不可重做(已 cleared/无 open 错题) |

## AiGateway stub:接口形状与 A7 接线说明

- 接口(`src/grading/ai/ai-gateway.ts`,形状按设计文档 §8.2 预批契约):
  ```ts
  interface AiGateway {
    preGrade(
      input: { ocrText: string; referenceAnswer: string; rubric: RubricStep[] },
      ctx: { orgId: number; feature: 'pre_grading' },
    ): Promise<{ aiScore: number; steps: { step; ok; comment? }[]; errorTags: string[] }>;
  }   // aiScore/steps/errorTags 即文档的 ai_score/steps[]/error_tags[](驼峰镜像)
  ```
- DI token `AI_GATEWAY`,当前在 `GradingModule` 绑定 `StubAiGateway`;**A7 接线 = 只替换该 Provider 绑定**(`{ provide: AI_GATEWAY, useClass: RealAiGateway }`),调用方零改动。ai_calls 计量、额度与限流由 A7 网关内部完成(本卡 stub 不产生计量)。
- stub 规则(确定性,零外部依赖):rubric 第 1 步恒 ok;其余步骤 OCR 文本含 `√{step}` 标记才 ok;aiScore=Σ(ok 步骤分),errorTags=未通过步骤 desc。拍照作答无 OCR 能力,worker 以 `[photo:{ossKey}]` 占位 → 仅得第 1 步分。A7 落地后该占位由真实 OCR/手写识别输出替换。
- 宪法 §4:本卡未 import 任何 LLM SDK;`grading/answers/:id` 的 photoUrl 为短时效(10min)HMAC 签名 URL(base=UPLOAD_PUBLIC_BASE,生产切 OSS 时由 storage 适配器换真实签名,字段形状不变)。

## 掌握度算法口径(与 prisma/seed.ts business 阶段对齐)

- 维度:学生 × 题目 tags(question_tags → kp_nodes,知识点/能力/策略三维通用)。
- 样本:该生**已完成 attempt(submitted/graded)**中 `is_correct` 非空的作答 = 客观题(single/multi/blank;主观题 is_correct 恒 NULL 不入样本);**含 redo/correction**(score_counted 只影响成绩,不影响掌握度)。
- `mastery = round(100 × 正确数 / 样本数)`,`sampleCount = 样本数`;按学生全量重算后 upsert mastery_snapshots(幂等)。
- 触发:finalize 出分(含交卷自动出分)→ 投递 `mastery` 队列任务,worker 在 runAsUser 租户上下文内执行。

## BullMQ 队列说明

- 队列键前缀 `a5:`(共享 Redis 纪律;BullMQ 队列名禁止含冒号 → 用 `prefix: 'a5'` 实现,实际键 `a5:pre_grading:*`、`a5:mastery:*`)。
- pre_grading 并发 5(设计文档 §8.1);removeOnComplete,失败重试 1 次;worker 随应用启停(onModuleDestroy 关闭),e2e afterAll 清理队列键。

## 口径约定(契约未明说处)

- 交卷后再次 POST /student/attempts 会新开 attempt(attempt_no+1)—— wrong_redo「做对 2 次」即同一 assignment 两次 attempt;in_progress 永远直接返回。
- 自动出分仅当卷面**无 solution 题**(如错题重做卷);含主观题的卷一律走教师 finalize(复核未完 → 4501)。
- 主观题对错口径(错题入账用):final_score < 卷面满分 = 错;拿满分 = 对。客观题用 is_correct。再错:wrong_count+1、re-open 并重置 correct_redo_count;redo 类(wrong_redo/correction)答对:correct_redo_count+1,达 2 → cleared。
- redo 卷分值沿用来源卷面分(source_answer → 原 paper_questions.score,缺省 5);redo paper 创建即 published(同 A4 口径)。
- /grading/pending 仅统计 status=submitted 的 attempt(graded=已出分不再待复核);aiAvgScore=该作业待复核且已有 AI 分的均分,无则 null。

## 验收项 ↔ 测试映射(npm test 102 用例全绿 = A1 18 + A2 25 + A3 17 + A4 19 + A5 23,test/a5.e2e-spec.ts)

| 任务卡验收项 | 测试 |
|---|---|
| 学生开始(幂等/断点续答) | `验收:开始作答幂等 —— 再次 POST 返回同一 in_progress attempt(断点续答)` |
| 逐题:single/multi 即时判分 | `single 答对…`、`multi 答错:isCorrect=false,下发 correctAnswer 与解析` |
| blank 归一化(去空格、全角转半角) | `验收:blank 归一化 —— 全角字符 + 空格,去空格全角转半角后判对` |
| solution 存 photoOssKey + 投递 pre_grading | `验收:solution 存 photoOssKey → judged=false 投递预批;断点快照回读已答 4 题` |
| 交卷汇总分 | `交卷:objectiveScore 汇总=10,score 待出分;重复交卷 → 4502` |
| AI stub 预批(BullMQ 真实执行,等待队列完成) | `验收:AI stub 预批 —— BullMQ 真实执行,grading_records 写入 aiScore/steps/errorTags` |
| 教师复核(pending/详情/review/adopt-ai) | `/grading/pending…`、`/grading/answers/:id…`、`review:超满分 → 400…`、`adopt-ai:s2 文本作答含 √ 标记 → AI 满分,采纳后 finalize…` |
| finalize 出分(写 final_score) | `验收:finalize 出分 —— attempt graded,score=10+8,主观题 score 回写`(复核未完 → `finalize 在复核完成前被拒 → 4501`) |
| 错题生成(错→upsert wrong_book) | `验收:错题入账 —— q2(客观错)+ q4(主观未满分),q4 错因取 AI 预批` |
| 重做对 2 次 → cleared | `单题重做…correct_redo_count=1` + `验收:再做对一次 → cleared…` |
| wrong_redo/redo-all 生成 paper+assignment(不计分) | `单题重做:生成 wrong_redo assignment(不计分)…`、`redo-all:仅 q4 仍 open → 生成 1 题重练卷;已 cleared 错题再 redo → 4503` |
| 掌握度数值 = 手算值(测试内按规则独立重算逐节点比对) | `验收:掌握度 —— mastery 任务完成,数值=独立手算(N1/N2 各 50,样本 2)` + redo 后 75/样本4(`computeExpectedMastery` 独立实现对账) |
| 订正成绩不改变原 attempt 分数 | `验收:再做对一次 → cleared;订正成绩不改变原 attempt 分数…`(redo/他人 finalize 后原 attempt 仍 18 分) |
| 跨租户 404(宪法 §7,attempt/grading/wrong-book/assignment 全覆盖,含同租户他人 attempt) | `跨租户互查 → 404(宪法 §7)` |
| 角色门禁 / 形状校验 | `角色门禁…403`、`response 形状与题型不符 → 400;非本卷题目 → 404` |

测试夹具:`test/fixtures/a5.fixtures.ts` 自建两机构(手机号 **1394** 开头,机构B 专用于跨租户),afterAll 先停 worker 再逆依赖清理并删除 `a5:*` 队列键;seed 数据只读;套件可重复执行(连跑两次全绿)。
