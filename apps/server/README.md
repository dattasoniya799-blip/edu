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

---

# A6 交付 · 课堂实时(WebSocket /classroom)

负责目录:`src/classroom/` + `test/a6.e2e-spec.ts`、`test/fixtures/a6.fixtures.ts`;`app.module.ts` 仅追加 ClassroomModule 的 import 与挂载。新增依赖:`@nestjs/websockets`、`@nestjs/platform-socket.io`、`socket.io`、`@socket.io/redis-adapter`(dev:`socket.io-client`)。
**测试先行(任务卡强制)**:commit `76dfb1d` 先提交 15 个协议层测试(全红,14 failed/无 /classroom 命名空间),commit `9c26709` 再提交实现(全绿)。

## 实现概览

| 要求(设计文档第 7 章) | 落点 |
|---|---|
| 命名空间 /classroom,握手 JWT + 本课成员校验(7.2) | `classroom.gateway.ts`(握手中间件验 JWT;成员校验在 class:join——学生=active 选课、教师=本课授课教师,跨租户经租户注入天然 404) |
| 房间 session:{id} / session:{id}:teacher;心跳 ping 25s;redis adapter(MVP 单实例先接上) | `classroom.gateway.ts`(adapter 用 REDIS 客户端 duplicate 的 pub/sub,挂接失败自动降级内存 adapter) |
| 事件协议 7.3 = ws-protocol.ts 逐字 | `classroom.service.ts`(C2S 六事件 + S2C/S2T 全部事件名与负载形状照搬契约类型) |
| Redis 结构 7.4(meta HASH / stu HASH / events STREAM / stuck ZSET) | `redis-keys.ts`(键形状照文档,统一 `a6:` 业务前缀,见下) |
| 事件经 Stream 消费者批量落 session_events;participants 30s 回写 | `classroom.service.ts#consumeSessionEvents / writebackSession`(周期可注入:`CLS_CONSUMER_INTERVAL_MS` 默认 1000、`CLS_WRITEBACK_INTERVAL_MS` 默认 30000;e2e 注入 300/400ms) |
| 心跳驱动 stuck 检测(超 mode.stuckAlertMin 进 ZSET + monitor:alert) | `#heartbeat`(ZADD NX 去重告警,score=开始停留时间;idleSec 回落 → ZREM + state 复位) |
| monitor:roster 5s 节流 | `#markDirty / #emitRoster`(trailing-edge 合帧:窗口内任意次状态变化合并为一帧,内容为发送时刻全班最新) |
| 状态机 scheduled→live→paused⇄live→ended(7.6) | `#join / #control / #transition`(DB updateMany 条件更新保证转移合法且只发生一次;scheduled→live 限 ≥提前 10min) |
| ended 结算:参与者归档 + 课后作业自动发布(调 A4) | `#settle`(最终回写+leaveAt → lesson finished → homework 环节挂的卷经 **A4 AssignmentService.create** 整班发布,幂等跳过已存在;最后 drain 事件流并清本会话 Redis 键) |
| Redis flush 后从 PG 重建(恢复函数) | `#rebuildHotState`(见下「恢复函数」) |
| 随堂作答判分 | **复用 A5 AttemptService**(见下「与 A5 作答通道的取舍」) |

## Redis 键形状(7.4,统一 `a6:` 前缀,可经 `CLS_REDIS_PREFIX` 覆盖)

```
a6:cls:{sid}:meta           HASH   org_id/lesson_id/course_id/teacher_id/lesson_title/status/
                                   started_at/paused_at/paused_total_sec/current_segment/
                                   mode(JSON,契约 camelCase)/segments(JSON)
a6:cls:{sid}:stu:{uid}      HASH   segment, q_index, correct, wrong, state, last_heartbeat,
                                   ai_ask_count(文档字段)+ answered/name/online/idle_sec/
                                   wrong_qids(JSON)/ai_chat_tail(JSON,最近10条)
a6:cls:{sid}:events         STREAM type/student_id/payload/ts(消费者批量落 session_events)
a6:cls:{sid}:events_cursor  STRING 消费游标(最后已落库的 stream id)
a6:cls:{sid}:stuck          ZSET   member=uid score=开始停留时间(秒)
```
共享 Redis 纪律:清理一律按前缀 SCAN+DEL(结算/teardown),禁止 FLUSHALL/FLUSHDB。
mode 归一化:DB JSON 接受 snake/camel 两种写法(schema 注释为 snake),下发一律契约 camelCase;
stuckAlertMin 缺省回退 practice 环节 config.stuck_alert_min。

## 恢复函数(rebuildHotState:Redis 故障/flush → 从 PG 最近快照重建)

- 触发:任何 join/heartbeat 发现 meta 缺失即自动重建(`ensureHotState`),前端无感。
- meta ← class_sessions + lesson(title/segments/mode);current_segment ← 参与者快照最大环节(类级环节未单独落 PG,≤30s 回退可接受,7.4)。
- stu HASH ← session_participants 周期回写的 progress 快照(segment/current_question/ai_ask_count)
  + **answers 按 PG 重算计数与 wrong_qids(作答本体走 A5 落 answers 表,因此已答与判定零丢失)**
  + AI 对话尾部 ← session_events(type=ai_ask)重放最近 5 次问答。
- 验收测试仅 SCAN+DEL `a6:cls:{sid}:*` 模拟故障,重建后 snapshot 已答/判定/当前题/对话尾部齐全。

## 与 A5 作答通道的取舍(class:answer)

- 采用**全量复用**而非「只落事件 + REST 为主」:class:answer 定位 lesson 的 in_class assignment(含该题的卷)
  → `AttemptService.start`(幂等,断点续答)→ `AttemptService.submitAnswer`(判分/解析回传/PG 落库口径与 REST 完全一致,
  契约「等价 REST,二选一通道」自然成立);AnswerResult 由 SubmitAnswerResult 映射 + 模板 narration。
- A5 的 AttemptModule 未 export AttemptService → 本模块以同一类自行 provide(依赖 AssignmentService/GradingService/
  PreGradingQueueService 均由 A4/A5 模块正常导出),**零改动 A1–A5 代码、零重写判分口径**。
- 前提:随堂练习的 in_class assignment 课前已发布(本卡不造发布接口,fixtures 直接落库;课后作业的自动发布走 A4 接口)。

## 口径约定(契约未明说处)

- `me.wrongBookAdded` = 本堂答错(isCorrect=false)的 questionId(将由 A5 结算入错题本;课堂内 attempt 未 finalize,错题本尚无记录)。
- `class:ai_ask` 回复为引导式模板(宪法 §4 业务模块不接 LLM;A7 AiGateway 落地后替换文案来源,事件形状不变)。
- 教师 join 的 snapshot.me 为空骨架(契约 join ack 统一为 ClassSnapshot)。
- 事件处理器用原生 socket.on 注册(非 @SubscribeMessage):A1 全局 APP_GUARD/APP_INTERCEPTOR 同样作用于 WS 处理器,
  会把 ack 包成 {code,message,data} 破坏契约形状且 JwtAuthGuard 读不到 WS 握手;A1 禁改,故网关内自管
  鉴权/租户上下文(runAsUser,机制对齐 ContextMiddleware)/异常通道(emit 'exception')。
- 业务异常一律 emit `exception` {status,message}(对齐 Nest WsException 行为);join 被拒时 ack 不回包。

## 契约变更申请(待人工决策,未自行改契约)

ws-protocol.ts 只定义了 S→C `class:control`,**教师下发控制的 C→S 事件缺失**(设计文档 7.3 注明"教师/系统下发",
但 C2SEvents 无对应条目)。本实现按最小侵入处理:服务端接收教师 socket 发来的同名事件 `class:control`,
负载复用契约 `ClassControl` 类型,服务端校验「仅本课教师」;下行广播严格按 S2CEvents。
建议契约补充:`C2SEvents['class:control']: (p: ClassControl) => void`(仅教师,服务端鉴权)。影响任务:B 端教师课堂页、A6。

## 验收项 ↔ 测试映射(npm test 117 用例全绿 = A1 18 + A2 25 + A3 17 + A4 19 + A5 23 + A6 15,test/a6.e2e-spec.ts)

| 验收项 | 测试 |
|---|---|
| join 返回完整 ClassSnapshot(契约逐字段)+ scheduled→live | `验收:class:join 返回完整 ClassSnapshot(契约逐字段)+ scheduled→live + class:state` |
| 7.5 原文:重连 join → snapshot 含已答题与判定/当前题/AI 对话尾部 | `验收(7.5 原文):断线重连 join → snapshot 含已答题与判定/当前题/AI 对话尾部` |
| 心跳驱动 stuck:超 mode.stuckAlertMin 进 ZSET + 教师房间 monitor:alert | `验收:心跳驱动 stuck 检测 —— 超 stuckAlertMin 进 ZSET + monitor:alert,恢复后移出` |
| 20 模拟客户端并发心跳下 roster 节流(5s 窗口 ≤1 次,内容为全班最新) | `验收:20 客户端并发心跳 → monitor:roster 5s 节流(窗口内 ≤1 次)且内容为全班最新`(20 连接 ×500ms 心跳 12s,断言相邻广播间隔 ≥5s、帧数 2–4、末帧 20 人全在线且心跳数据已生效) |
| class:control 广播 + 状态机 | `状态机:pause⇄resume 广播 class:control;非法切换/学生越权被拒;force_segment` |
| Redis 清空(仅本套件键)重建后 snapshot 不丢已答 | `验收:participants 周期回写 → Redis flush(仅本套件键)→ 从 PG 重建,snapshot 不丢已答` |
| ended 结算:参与者归档 + 课后作业自动发布(A4 接口) | `验收:ended 结算 —— 参与者归档 + 课后作业自动发布(A4 接口)+ 幂等 + 再 join 拒绝` |
| 事件经 Stream 消费者批量落 session_events | `事件经 Stream 消费者批量落 session_events(join/segment/answer/ai_ask/hand_up/stuck)` |
| class:answer 复用 A5(对/错/解析回传/PG 落库) | `验收:class:answer 复用 A5 判分 —— 对/错判定、解析回传、PG 落库、narration` |
| 握手鉴权 / 本课成员校验 / 跨租户 404(宪法 §7) | `握手:无效 JWT → connect_error 拒绝连接`、`join 门禁:未选课学生 / 他租户教师 → 拒绝(本课成员校验,宪法 §7)` |
| 其余协议事件 | `教师 join → monitor:roster`、`class:segment`、`class:ai_ask → class:ai_chunk 流式`、`class:hand_up → monitor:alert(hand_up)` |

测试夹具:`test/fixtures/a6.fixtures.ts` 自建两机构(手机号 **1395** 开头;20 名选课学生 + 1 名未选课 + 机构B 教师),
afterAll 断开全部 socket、按前缀清 `a6:cls:*`、逆依赖清库;seed 数据只读;套件可重复执行(全套件连跑 12 次全绿)。
e2e 用 `app.listen(0)` 临时端口,socket.io-client 仅 websocket 传输。

---

# A8 交付 · 学情聚合(/analytics/*)与 AI 账单边界结论

负责目录:`src/analytics/` + `test/a8.e2e-spec.ts`、`test/fixtures/a8.fixtures.ts`;`app.module.ts` 仅追加 AnalyticsModule 的 import 与挂载。无新增依赖、无 Redis 键(本任务最终不含异步任务,见下)。

## 实现概览

| 要求(任务卡 A8) | 落点 |
|---|---|
| 课程掌握热力(active 选课学生聚合 mastery_snapshots,**只取 curriculum 维度**) | `analytics.service.ts#courseMastery`(节点过滤 `node.graph.graphType=curriculum_knowledge`;avgMastery=round(均值),studentCount=该节点有快照的学生数,按 nodeId 升序) |
| 重点关注(任一 curriculum 节点 mastery<60 或 7 日未活跃,reason 文案化) | `analytics.service.ts#courseAttention` |
| 单生 30 天报告(mastery 全维度 + wrongOpenCount + attempts30d) | `analytics.service.ts#studentReport`(mastery 口径与 A2 学生档案一致:全部快照 + graphType,nodeId 升序) |
| POST /analytics/courses/:id/ai-report(异步任务) | **openapi 无此端点 → 按任务卡“不在则不做”不实现**(/analytics/* 契约仅 3 个 GET);若后续契约补充,挂回本模块并接 A7 LLM 开关即可 |
| ai-usage summary/daily/breakdown | **不动 A2**,边界结论见下 |

## ai-usage 边界结论(发包方裁定:先对照,满足则不动)

逐条对照 `src/admin/insights.service.ts` 与 openapi /admin/ai-usage/* + 任务卡:

- summary:按 ai_calls 本月(UTC)聚合 totalTokens=Σ(tokensIn+tokensOut)、totalCost,monthlyLimit 取 ai_quotas 当期,usedPercent、avgCostPerLesson(去重 lessonId)→ **与 AiUsageSummary 契约逐字段一致**;
- daily:days 参数(默认 14、≤31,DTO 校验)零填充逐日曲线 → 与契约一致;
- breakdown:按 feature 分组、label 文案化、percent 按 cost 占比 → 与 AiUsageBreakdown 契约一致;
- 门禁 [admin]、与 seed 8 条 ai_calls 对账的 e2e 已在 admin.e2e-spec 通过(13480 tokens / ¥0.18)。

**结论:A2 实现完整且对账通过,无缺口 → 未改 `src/admin/` 任何代码,analytics 模块亦不重复实现(避免双口径)。** 任务卡“与 A2 的占位实现对接替换”一句已过时,无需契约变更。

## 重点关注规则口径(契约未明说处,文案确定性可测)

- 候选 = 该课程 status=active 的选课学生(quit / 未选课不入);
- 规则一:任一 **curriculum** 节点 mastery<60(能力/策略维度不触发);
- 规则二:近 7 日未活跃。**活跃 = 近 7 日(UTC 日对齐窗口)内有任一 attempt 开始或交卷**;
- reason 文案:单节点 → `「节点名」掌握度 {m},低于 60`;多节点 → `「最低分节点名」等 {n} 个知识点掌握度低于 60(最低 {m})`;未活跃 → `近 7 日未活跃`;两类原因以 `;` 叠加;列表按 studentId 升序;
- `attempts30d` = 近 30 天(UTC 日对齐)内开始的 attempts 总数(不限状态);
- 空数据(无学生 / 无快照 / 无关注对象)一律返回 `[]`;课程/学生不存在、跨租户、以非 student id 查报告 → 404。

## 验收项 ↔ 测试映射(npm test 125 用例全绿 = A1 18 + A2 25 + A3 17 + A4 19 + A5 23 + A6 15 + A8 8,test/a8.e2e-spec.ts)

| 验收项 | 测试 |
|---|---|
| 聚合数字 = seed+测试数据手算(测试内独立重算对账,模式同 A5 computeExpectedMastery) | `验收:课程热力 = 手算账本(N1 avg70/3人,N2 avg45/1人)…`(夹具手算 + raw 独立重算双对账)、`验收:seed 课程「初二数学提高班」热力/关注/学生报告 → 与测试内独立重算逐项一致` |
| 只取 curriculum 维度 | 热力用例断言 ability 节点(M1)不出现;关注用例断言 M1=30 不触发规则 |
| 重点关注规则 + reason 文案化 | `验收:重点关注 —— s1(curriculum 节点<60)、s2(<60 且 7 日未活跃,双原因叠加),s5 不入列…` |
| 单生 30 天报告 | `验收:单生 30 天报告 —— mastery 全维度 3 条 + wrongOpenCount=2 + attempts30d=1(40 天前的不计)` |
| 空数据课程返回空数组而非报错 | `验收:空数据课程 → mastery/attention 均返回空数组而非报错` |
| 跨租户 404(宪法 §7) | `跨租户互查 → 404…双向全覆盖` |
| 角色门禁(openapi 标注:热力/关注 [teacher],报告 [teacher/admin]) | `角色门禁:student 全部 403;admin 调课程热力/关注 → 403;无 token → 401` + 报告用例内 admin 200 断言 |
| 响应结构与 openapi 逐字段一致 | 全部用例 exactKeys(热力/关注/报告/MasteryItem) |

测试夹具:`test/fixtures/a8.fixtures.ts` 自建两机构(手机号 **1397** 开头),直插快照/作答/错题构成手算账本,afterAll 逆依赖全量清理;seed 数据只读对账;套件可重复执行(全套件连跑两次全绿)。

## 已知环境风险(非本任务代码问题,报备)

多工作区并行开发时共享 Redis 会导致 **A5 BullMQ 队列跨库串扰**:各 worktree 的 worker 监听同名队列 `a5:pre_grading`/`a5:mastery`(host:port 相同即同队列),任务会被他库 worker 抢走执行,表现为 a5 套件 waitFor 超时。本地验证时给本工作区配独立 Redis(`.env` 的 REDIS_URL 指向专属实例)即可规避;集成(串行)环境不受影响。若需根治,建议仲裁后在 A5 的 `queue.util.ts` 支持按环境变量覆盖 BullMQ prefix(本任务未越界改动)。

---

# A7 交付:AI 网关(供应商抽象 + 计量 + 四能力)

## 范围与落点(负责目录 src/ai/)

| 要求 | 落点 |
|---|---|
| LlmGateway 接口(§8.1 原文形状:chat → AsyncIterable<Chunk>) | `src/ai/llm/types.ts`、`src/ai/llm/llm-gateway.service.ts` |
| 路由表 feature→{provider,model,fallback} + 单价表 | `src/ai/config/ai-routes.default.json` + `src/ai/llm/route-table.service.ts` |
| mock provider(确定性,验收用) | `src/ai/llm/providers/mock.provider.ts` |
| 真实 provider 适配器(OpenAI 兼容,原生 fetch,不写死厂商) | `src/ai/llm/providers/openai-compatible.provider.ts` |
| 计量:ai_calls 全归因 + Redis INCR 当月成本 + over_policy + alert 审计 | `llm-gateway.service.ts`(meter/enforceQuota/alertOnce) |
| /ai/qa SSE + 引导模式(配置提示词 + 输出审查)+ 限流 6 次/分 | `src/ai/features/qa.service.ts`、`src/ai/ai.controller.ts` |
| 预批:消费 A5 BullMQ + OCR 接口(local stub)+ JSON Schema 严格校验 | `src/ai/features/pre-grading.gateway.ts`、`src/ai/ocr/ocr.service.ts`、`src/ai/features/json-schema.ts` |
| 伴学旁白 / 学情诊断:模板 MVP + LLM 开关 | `src/ai/features/companion.service.ts`、`diagnosis.service.ts` |
| /ai/health(admin):当前路由 + 供应商可用性 | `ai.controller.ts#health` |

跨目录改动(任务卡明示允许的接线,各一处):`app.module.ts` 挂 `AiModule`;`grading.module.ts` 的
`AI_GATEWAY` 绑定 `{ useExisting: LlmPreGradeGateway }`;`.env.example` 追加 LLM_* 变量;
`test/jest-e2e.config.cjs` 的 globalTeardown 换成 `a7.redis-teardown.cjs`(内部先调 A5 的清理,再清 `a7:ai:*`)。

## 路由表选型与热更新机制

- **选型:config 文件默认值 + Redis 覆盖键(任务卡允许 config;无专表不动 schema)。**
  默认表在 `src/ai/config/ai-routes.default.json`(routes + pricing 单价表,元/1k token)。
- **热更新:`SET a7:ai:routes '<部分覆盖 JSON>'` 即时生效、`DEL` 即回滚**——
  RouteTableService 每次 resolve 时读 Redis 并与默认表逐 feature/model 合并,无进程内缓存,
  切路由/换模型/调价**不重启生效**(e2e 已验)。覆盖 JSON 形状同默认表,可只给改动项,如
  `{"routes":{"qa":{"provider":"openai_compatible","model":"env"}}}`。非法 JSON 安全回落默认表。
- 费用 = tokensIn/1000×inPer1k + tokensOut/1000×outPer1k(round4),单价缺省落 `pricing.default`。
- mock 的 token 口径:tokensIn=全部消息字符数、tokensOut=回复字符数 → 计费完全可手算。

## 计量与成本护栏(§8.1/§8.3)

- 每次调用写 `ai_calls`:feature/user/session/course/lesson/provider/model/tokens/cost/latency/status。
  归因按能力可得信息填:QA 带 userId(给 attemptId 时富化 lessonId/courseId);预批经 A5 的
  `PreGradeContext`(A5 契约,禁改)仅有 orgId;伴学由 classroom 接线时传 sessionId。org_id 由
  PrismaService 租户注入自动填充。计量失败只记日志不影响业务回复。
- Redis `INCRBYFLOAT a7:ai:cost:{orgId}:{yyyy-MM}` 为额度执行的实时数据源;请求前预检:
  达 `ai_quotas.monthly_limit` 后按 `over_policy` 关能力(`disable_qa` 默认:**关答疑、保课堂伴学/预批**;
  另支持 disable_all/none),被关能力返回业务码 **4504**(HTTP 409)。未配额度 = 不限。
- 达 `alert_threshold`(%)写一条 `audit_logs`(action=`ai.quota.alert`,顶替系统通知),
  Redis SETNX 保证每 org 每月仅一条。
- 上下文裁剪:QA 只带当前题 + 最近 6 条对话(Redis `a7:ai:qa:tail:*`);旁白默认模板零成本。
- (§8.3 的 (question_id,hint_level) 提示语缓存不在任务卡验收内,未实现,见遗留。)

## /ai/qa:SSE 与引导模式

- 限流:每生 **6 次/分**(Redis 固定窗口),第 7 次 → 业务码 **4501**(HTTP 429,任务卡验收)。
  说明:A5 在 /grading/* 用过 4501(finalize 未复核);两者不同接口域、运行时不冲突,
  契约未定义错误码注册表,按任务卡原文执行并在此备注。
- 引导模式 = org.settings.ai.qaGuideOnly(默认开):系统提示词 `src/ai/config/qa-guided-prompt.md`
  + 输出审查 `qa-review.json`(正则模式集 + 重写话术)——检出最终答案模式整段拦截重写,
  **策略全在配置文件,不写死代码**。审查需全文 → 服务端攒齐上游输出统一审查后再按 SSE 分块下发
  (对客户端仍是流式;计量按上游真实输出 token,不因重写少记)。
- SSE 形状按 openapi:`event: delta` `data: {"text"}` …… `event: done` `data: {"requestId"}`;
  controller 自管响应(@Res),错误体与全局过滤器同形({code,message,detail?},业务码保留)。

## 与 A5 队列的对接方式(最小侵入)

**保留 A5 的队列与 worker 全链路不动**(队列 `a5:pre_grading`、prefix a5、并发 5、
worker 在租户上下文调 `GradingService.processPreGrade`),只把 `GradingModule` 中
`AI_GATEWAY` 的 Provider 绑定从 `StubAiGateway` 换成 AiModule(@Global)导出的
`LlmPreGradeGateway`——这正是 A5 README 预留的唯一接线点,消费端/调用方零改动。
`[photo:{ossKey}]` 占位由 OCR 接口(`OCR_SERVICE`,当前 LocalOcrStub)解析;LLM 输出按
JSON Schema(`{ai_score, steps[], error_tags[]}`,§8.2)严格校验后映射回 A5 契约。
mock 预批规则与原 stub 完全一致(第 1 步恒 ok、其余看 `√{step}` 标记),A5 既有 23 个用例分值不变。

## 真实 provider 接 key 步骤(C3 时只填 env)

1. `.env` 填三项:`LLM_API_KEY` / `LLM_BASE_URL`(OpenAI 兼容地址)/ `LLM_MODEL`(默认模型名);
2. 切路由(不重启):`redis-cli SET a7:ai:routes '{"routes":{"qa":{"provider":"openai_compatible","model":"env","fallback":{"provider":"mock","model":"mock-chat-v1"}}}}'`
   (`model:"env"` 表示取 LLM_MODEL;也可写显式模型名;建议配 mock fallback 兜底);
3. `pricing` 按供应商报价补进覆盖键或默认表;`GET /ai/health` 确认 healthy=true。
   适配器用原生 fetch(SSE 解析 + stream_options.include_usage 取 usage,缺失按字符估算),
   全仓库无任何 LLM 供应商 SDK 依赖。当前无真实 key,e2e 只验请求构造,不发真实网络。

## 验收项 ↔ 测试映射(npm test 131 用例全绿 = 既有 117 + A7 14,test/a7.e2e-spec.ts,连跑两次绿)

| 任务卡验收项 | 测试 |
|---|---|
| mock 下计量字段完整且费用=单价×token 可手算 | `验收:mock 下 ai_calls 计量字段完整,费用 = 单价 × token 可手算,Redis 当月成本同步累加` |
| 限流第 7 次返回 4501 | `验收:限流 6 次/分/学生 —— 第 7 次返回业务码 4501(HTTP 429)` |
| 预批输出 JSON schema 校验通过 | `验收:预批走 A5 BullMQ 链路 → LlmPreGradeGateway(mock)→ grading_records 结构严格符合 Schema`(含校验器负例自证)+ `预批 photo 占位 → OCR 接口(local stub …)` |
| 切路由表不重启生效 | `验收:切路由表不重启生效 —— Redis 覆盖键写入后 /ai/health 与计量即时反映,删除即回滚` |
| 业务模块 grep 不到供应商 SDK import | 静态检查:`grep -rE "openai|anthropic|langchain|…" src/{admin,question,attempt,grading,classroom,…}` 为空;package.json 无 LLM SDK 依赖(适配器原生 fetch) |
| 超额按 over_policy;达 alert_threshold 写 audit_logs | `验收:达 alert_threshold 写一条 audit_logs(仅一次);超额 over_policy=disable_qa 关答疑、保预批` |
| 引导模式(配置提示词 + 输出审查拦截重写) | `引导模式:检出"最终答案"模式 → 拦截并重写为配置文件中的引导话术` + `QA 对话尾部(最近 6 条)…` |
| fallback 路由 | `fallback:主路由供应商故障 → 自动切 fallback,计量记实际命中的 provider/model` |
| 真实 provider 适配器(env 读 key,不写死厂商) | `openai_compatible:env 读 LLM_API_KEY/LLM_BASE_URL/LLM_MODEL,OpenAI 兼容请求构造正确`(无网络) |
| diagnosis/伴学旁白模板 + LLM 开关 | `伴学旁白:模板实现(≤80 字)…计量 feature=class_companion`、`学情诊断:模板摘要含薄弱点与建议…` |
| 门禁/跨租户(宪法 §7) | `上下文与门禁:…跨租户 questionId → 404;teacher → 403;超长 message → 400`、`/ai/health:…student → 403` |

测试夹具:`test/fixtures/a7.fixtures.ts` 自建两机构(手机号 **1396** 开头),afterAll 逆依赖清库
(含 ai_calls/ai_quotas/audit_logs)并按前缀清 `a7:ai:*`;beforeAll 防御性清残留;seed 数据只读。

## 口径约定与边界声明

- AI 配置目录解析:`AI_CONFIG_DIR` env → `<cwd>/src/ai/config` → `__dirname/config`
  (nest build 不拷贝资产文件,生产从 `<cwd>/src/ai/config` 读,源码随仓库分发;提示词类配置进程内缓存,
  改动需重启或换 AI_CONFIG_DIR;**路由表不受此限**,热更新走 Redis)。
- JSON Schema 校验器为内置极简子集实现(`features/json-schema.ts`):package.json 不在 A7 可改范围,
  不引第三方校验库;子集(type/required/properties/additionalProperties/items/minimum)覆盖预批契约足够。
- classroom 的 `class:ai_ask` 仍走 A6 现有模板链路(本卡不改 classroom);
  `CompanionService/DiagnosisService/QaService` 已导出,后续接线只换调用方。
- 遗留:(question_id,hint_level) 提示语缓存(§8.3,非本卡验收);ai_quotas.used_cost 列不回写
  (额度实时执行以 Redis 为准、报表以 ai_calls 聚合为准,避免双账本);限流为固定窗口非滑动窗口。

---

# FIX1 交付 · 学生端只读 5 端点(契约缝隙补漏)

负责目录:`src/student/` + `test/fix1-student.e2e-spec.ts`、`test/fixtures/fix1.fixtures.ts`;
`app.module.ts` 仅追加 StudentMiscModule 的 import 与挂载。响应逐字段以 openapi 为唯一规格。

## 5 端点 ↔ 落点 ↔ 验收映射(npm test 150 用例全绿 = 既有 139 + FIX1 11,连跑两次)

| openapi 端点 [student] | 落点 | 验收测试(test/fix1-student.e2e-spec.ts) |
|---|---|---|
| GET /student/today | `student-misc.service.ts#today` | `验收:today = 夹具手算 ……tasks 三态 progress` + `today:多课程取今日最早讲次……` |
| GET /student/courses | `#myCourses`(口径=A2/A4 课程聚合,逐字段一致) | `验收:courses = 夹具手算……` |
| GET /student/courses/{id}/lessons | `#lessonTimeline` | `验收:讲次时间线 = 夹具手算……` + `讲次时间线门禁……404` |
| GET /student/report | `#report`(mastery 复用 A8 AnalyticsService) | `验收:report = 夹具手算……周窗口` |
| GET /student/resources/{id}/view | `#resourceViewUrl` + `resource-view.service.ts` | `验收:resources/view —— 签名 URL(一次性 token)……` + 门禁用例 |
| (seed 对账,全部读端点) | — | `验收:seed 学生四个读端点 → 与测试内独立重算逐字段一致` |
| (宪法 §7 / 角色门禁) | — | `跨租户互查 → 404……` + `角色门禁:teacher/admin → 403;无 token → 401` |

## 复用与口径(契约未明说处;来源在代码注释逐处标注)

- 作业可见性(target 解析)唯一口径 = A4 `AssignmentService.listForStudent`(已 export,直接复用);
  mastery / wrongOpenCount 复用 A8 `AnalyticsService.studentReport`(已 export)。
  CourseModule/LessonService 未 export(纪律:不改他人模块)→ 课程聚合与 Lesson 映射在本模块内
  按 README A2/A4 同口径实现。
- `today.todayLesson`:本 UTC 日窗口内 scheduledStart 最早且起止齐全的讲次(无 → null);
  `canEnterAt = startAt - 10min`(对齐 A6"scheduled→live 限 ≥提前 10min");`sessionId` = 该讲次
  最新未结束(≠ended)session,无 → null。`tasks` = 全部对我可见作业(与 B5 mock 口径一致),
  progress 取最新 attempt:无 → `not_started`,有 → 已答题数 + attempt.status。
- `lessons[].myHomework`:该讲次最新一条可见 homework;score = 我最新 attempt 总分(出分前 null);
  wrongCount 按 A5 错题口径(客观 isCorrect=false;主观已出分且 score<卷面满分);无 attempt → 0。
- `report.weekStats`:近 7 日 UTC 日对齐窗口(同 A2 weekStudySec)—— answeredCount=窗口内 answers 数,
  correctRate=客观题正确占比(0-1,round2,无样本 null),studySec=attempts.duration_sec 求和。
- `/student/courses/{id}/lessons` 与 `/student/resources/{id}/view`:课程未选(含 quit)/课件未被
  "我 active 选课课程"的讲次环节引用 → 404(同租户越权与跨租户同形,宪法 §7)。

## resources/view 的签名 URL 机制(与 A3 storage 适配器对称)

- A3 local 驱动没有 GET 下载端点(A5 报告提过此缺口),且 UploadModule 未 export STORAGE_ADAPTER
  → 下载侧在本模块 `resource-view.service.ts` 按 A3 同口径补齐,形状与 sts 上传端点完全对称:
  - 签发:`GET /student/resources/{id}/view` → 一次性 token(Redis `view:token:{token}`,TTL 600s,
    同 A5 手写原稿 10 分钟口径)→ `{url, expiresAt}`,url = `{UPLOAD_PUBLIC_BASE}/api/v1/student/resources/local/{token}`;
  - 消费:`GET /student/resources/local/:token`(`@Public`,token 即凭证,GETDEL 原子一次性,
    复用 → 403;文件读取限定 UPLOAD_ROOT 之内防穿越,缺失 → 404)。该端点等价于 OSS 的外部
    回看地址,不属于 openapi 契约(同 A3 的 `PUT /uploads/local/:token` 定位)。
- 环境变量全部复用 A3:`STORAGE_DRIVER=local` / `UPLOAD_ROOT` / `UPLOAD_PUBLIC_BASE`(默认值一致,
  未新增 env);`STORAGE_DRIVER=oss` 时签发即报错占位(同 A3 OssStorageAdapter 策略),
  接入真实 OSS 时仅替换 `presignGet` 实现,响应字段形状不变。

## 边界声明与报备

- 未触碰 packages/contracts、prisma、src 其余模块;`.env.example` 无新增(并行隔离用的
  `BULLMQ_PREFIX` A7 已支持,本地 `.env` 配 `fix1` 即可)。
- **跨任务边界改动报备(非契约文件)**:`test/fixtures/a8.fixtures.ts` 的用户创建由 `Promise.all`
  改为顺序 await —— 并发插入导致 id 分配顺序不确定,s2.id < s1.id 时 A8"重点关注"断言
  (列表契约按 studentId 升序)随机翻车(全量跑已复现);手算账本语义零变化。
- B5 的 msw mock 给 `/student/courses/{id}/lessons` 的条目加了 `resources` 字段(契约变更申请
  B5-1,仲裁中)。本实现严格按当前契约(条目仅 `lesson`+`myHomework`);若 B5-1 获批,
  在 `lessonTimeline` 返回值补该字段即可,联调时注意此差异。
- 测试夹具:1398 号段自建两机构,afterAll 逆依赖全量清理;seed 数据只读对账;套件可重复执行。
