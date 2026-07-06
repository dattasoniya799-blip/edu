# 鲸云AI教育平台 · W0 交付包(数据库 + 契约,Gate-0 审核对象)

本包为任务卡 W0-1 的交付物,已在 PostgreSQL 16 真实环境完整跑通。

> **契约变更记录**(详见开工包 01-项目宪法.md 末尾):
> - [2026-06-11,已批准] schema.prisma 枚举重排为合法多行格式,零语义变化;
>   `prisma generate` 现可正常使用。A1 起后端通过 Prisma Client(带租户注入)访问数据库。
> - [2026-06-14,已批准·B6课堂] ClassSnapshot 增可选 `questions?`/`courseware?`(真实模式下发题面/
>   课件);dto.ts 新增 CoursewarePageView/MiniQuizView。可选、向后兼容、无 schema 迁移。
> - [2026-06-14,已批准·B6课堂] LessonDto 增**必填** `sessionId: number | null`(当前讲次最新未结束
>   ClassSession id,供教师监控连 WS;无在开会话则 null)。取数复用 `latestOpenSessions`(列表批量 in
>   查、detail 单查),与学生端 LessonTimelineItem.sessionId 先例同口径,无 schema 迁移。
> - [2026-06-15,已批准·AI管理] admin 新增 AI 接口管理端点(GET/PUT /admin/ai/config、GET/PUT
>   /admin/ai/routes、POST /admin/ai/test)+ 4 个 DTO;运行态配置(Redis a7:ai:provider/a7:ai:routes),
>   key 脱敏读、可空写。
> - [2026-07-05,已批准·教师点评] 学生 attempt 视图 AnswerDto 增可选 `teacherComment?: string`
>   (教师复核点评,finalize 后随解析下发;未 finalize/空点评省略字段)。可选、向后兼容、无 schema 迁移。
> - [2026-07-06,已批准·题库学科筛选] `GET /questions` 增可选 query `subject?: string`(按学科精确匹配;
>   空串/缺省=不过滤)。教师端题库页与组卷选题器加学科筛选。可选、向后兼容、无 schema 迁移。
>
> **A1 已交付**:后端骨架/认证/多租户/RBAC 见 `apps/server/README.md`(e2e 18/18)。

## 内容
```
apps/server/prisma/schema.prisma                  数据库唯一事实(29 张表,含三维知识图谱)
apps/server/prisma/migrations/0001_init/*.sql     等价 SQL 迁移(已实测)
apps/server/prisma/seed.ts                        两阶段演示数据
apps/server/tools/import-kp.ts                    知识图谱导入+校验+对账报告
data/knowledge-graphs/*.json                      你提供的三维图谱(教材/能力/策略)
data/knowledge-graphs/IMPORT_REPORT.md            导入对账报告
docker-compose.dev.yml                            本地 Postgres + Redis
```

## 跑通步骤(你的电脑,需 Node 20+ / Docker)
```bash
docker compose -f docker-compose.dev.yml up -d
cd apps/server && npm install && cp .env.example .env
npm run db:apply-sql        # 或: npx prisma migrate dev(联网环境推荐,会按 schema.prisma 重新生成迁移)
npm run db:seed:base        # 机构/管理员(13800000001/Admin@123)/教师/12 学生
npm run db:import-kp        # 导入三个图谱,输出对账报告
npm run db:seed:business    # 课程/讲次/30 题/作答/批改/错题/掌握度
```

## 设计要点(Gate-0 审核提示)
- 知识点按你的真实数据升级为**三维图谱**:kp_graphs / kp_nodes / kp_edges;
  题目标注表 question_tags 同时覆盖 知识点+能力+策略(由 node 所属图谱区分)。
- 所有业务表带 org_id(多租户行级隔离);唯一键均含 org 维度。
- 订正/重做不计分:assignments.score_counted=false;错题重做对 2 次 cleared。
- 标 [v1.1] 注释的字段为 MVP 延后但预留。
- 密码哈希 seed 用 scrypt(开发态),A1 任务切换 argon2。

## 验证数据(本环境实测)
图谱 771 节点/762 边逐项对账一致;30 题×3 维=90 条标注;12 名学生完成
第 3 讲作业产生 60 条作答、12 份 AI 预批、6 条错题、144 条掌握度快照;
先修链(函数概念→一次函数→图象与性质→应用)可查询。

## W0-2 契约包(packages/contracts)
```
openapi.yaml                 API 唯一事实:64 路径 / 79 操作,已通过 swagger-parser 校验
src/dto.ts                   实体 DTO 与枚举(与 schema.prisma 一一对应)
src/ws-protocol.ts           课堂 WS 协议(C2S/S2C/监控事件 + 断线恢复 ClassSnapshot)
src/design-tokens.ts         设计令牌(原型 v0.4 抽取,前端唯一视觉事实)
src/client.ts                类型化 fetch 客户端(路径/参数/响应全推断,0 处 any)
src/generated/api-types.ts   由 openapi.yaml 生成(npm run gen:sdk 重新生成)
src/__smoke__.ts             编译期冒烟:正向推断 + 负向 @ts-expect-error 用例
```
契约纪律:任何会话不得修改本包;发现问题提"契约变更申请",人工决策后统一更新并重新生成 SDK。

## C2-back-bugs(C1 联调发现的管理员域 3 个后端 bug 修复)

修复范围:`apps/server/src/admin`、`apps/server/src/auth` 及对应 e2e(不改 contracts/schema)。

1. **教师密码去短信改明文**
   - `POST /admin/teachers/{id}/reset-password` 不再"短信",改为生成 8 位易读明文临时密码 →
     argon2 写 `passwordHash` → 返回 `{ password }`,写 `audit_logs`(口径与学生 reset-password 一致),
     并作废该教师全部刷新令牌。
   - 创建教师:自动生成初始密码(写 `passwordHash`,`status=active`),不再发短信;管理员凭
     reset-password 取回明文告知教师。
2. **入班"可选学生"显示全部已在课程** —— 后端结论:**后端正确,问题在前端**。
   - 后端无"候选学生"专用接口;候选 = 全体学生 − 该课程在册 active 学生,应由前端做补集。
   - 后端各接口真实口径:`GET /admin/students?courseId=X` 仅返回该课"在册 active"学生(= 应被**排除**的集合);
     `GET /admin/courses/{id}/roster` 同口径只返回在册 active 学生(退班 quit 不计入)。
   - 本次顺带修正 roster 过滤为 `status:'active'`(原返回含 quit),并补 e2e 固化"候选/名单"口径。
3. **停用教师/学生后消失(根因:停用误写 deletedAt)**
   - 教师停用(`DELETE /admin/teachers/{id}`)改为**只置 `status='disabled'`,不写 `deletedAt`**;
     列表按 `deletedAt:null` 过滤,停用者仍可见,`?status=disabled|active` 可过滤。
   - 新增 `POST /admin/teachers/{id}/enable` 与 `POST /admin/students/{id}/enable`(置 `status='active'`,写 `audit_logs`)。
   - `GET /admin/students` 新增 `?status` 过滤;学生无 DELETE 端点,停用经业务置位,同样不写 `deletedAt`。

跑通(库 `qiming_c2a`,Redis 队列前缀 `BULLMQ_PREFIX=c2a`;课堂键前缀保持默认 `a6:`,a6 e2e 硬编码):
```bash
cd apps/server && cp .env.example .env   # DATABASE_URL → .../qiming_c2a;加 BULLMQ_PREFIX=c2a
npm install && npx prisma generate
# 灌迁移:cat prisma/migrations/0001_init/migration.sql | docker exec -i <pg> psql -U qiming -d qiming_c2a
npm run db:seed:base && npm run db:import-kp && npm run db:seed:business
npm test     # e2e 14 套件 / 179 用例;连跑两次全绿
```
> e2e 说明:`test/jest-e2e.config.cjs` 启用 ts-jest `isolatedModules`(transpile-only),以与跨任务
> "契约先行、实现后补"的临时类型错位解耦(base `c2-contract` 已加 unitSeq/openingConfig/analysis*Latex,
> 其实现属 c2-back-redesign 域)。生产代码类型仍由各域 `nest build`/`tsc --noEmit` 守门。

验收用例(`test/admin.e2e-spec.ts`、`test/auth.e2e-spec.ts`):教师 reset-password 返回明文且可登录、
停用不写 deletedAt + 列表仍可见 + `?status` 过滤 + enable 复活、入班候选/名单口径(`/students?courseId`
与 roster 同为"在册 active"= 排除集)、学生 enable + 跨租户 404。

## C3-front-other(管理员入班 bug + 学生端两项前端修复)

范围:`apps/admin/src`、`apps/student/src`(不改 contracts/server/teacher/schema)。两端 `npm run build`、
`vitest`(admin 40、student 115)、`test:mock` 冒烟均绿。

1. **管理员入班「添加学生」加不进**(真因:候选请求 `size=100` 超后端单页上限 50 → 真实后端 400 被吞成空候选 +
   误导文案「机构内学生都已在本课程」)。修复 `apps/admin/src/components/RosterModal.tsx` 的 `AddStudentsModal`:
   - 候选请求 `size` 改为合法值 50;
   - 改服务端**关键字搜索 + 分页**(`GET /admin/students` 带 `page/size/keyword`),使 >50 学生也能搜到/翻页选到;
   - 加载失败显示**真实错误态 + 重新加载**按钮,不再伪装成「没有可加的人」;仅候选确实为空(单页已含全部学生且都在课)
     才显示「都已在课程」,多页时显示「本页都已在课程,翻页查看」。
   - 候选过滤仍走纯函数 `lib/roster.candidateStudents`(本页学生 − 该课 active 名单)。
   - 测试:`apps/admin/src/mocks/__tests__/roster-add.spec.ts`(以「严格后端」复现 size>50→400、size=50 正常、
     关键字命中、分页候选过滤)。
2. **学生正确率 ×100 显示**(后端 `weekStats.correctRate` 为 0–1 比值,原渲染 `${correctRate}%` → 0.75 误显 0.75%)。
   新增纯函数 `apps/student/src/lib/format.ts#formatCorrectRate`(`Math.round(ratio*100)%`,与 mastery 0–100 口径区分),
   `TodayPage`/`ReportPage` 改用之;mock `studentWeekStats.correctRate` 同步为 0–1 比值(0.78)。
   测试:`apps/student/src/lib/__tests__/format.spec.ts` + student-store.spec「C3 #2」断言 `reportView` → "78%"。
3. **进课堂文案/入口**(后端本波「发布即建会话」:已发布讲次带 `sessionId`)。
   - `TodayPage`:hero 文案与按钮按 `todayLesson.sessionId` 区分——有会话→「课堂已开放/进入课堂」,无→「尚未发布/讲次未发布」,
     去掉原「稍后再试」的误导承诺。
   - `CoursePage` `onEnterClass`:改为用**该讲自己的 `sessionId`**(经 `TimelineItem.sessionId` 传入),
     不再借用全局 `/student/today` 的会话(修原 L1 缺陷);未发布讲次给「尚未发布」准确文案。
   - mock `student-store.lessonTimeline` 让已发布(ready/in_progress)讲次带 `sessionId`(= 课堂会话 401),未发布/已结课为 null。
   测试:student-store.spec「C3 #3」断言 ready 带会话、draft/finished 为 null、todayLesson 带会话。

> 顺带(非本三项,解除构建阻塞):base 分支 `c3-contract` 给 `Resource` 增 `kpNodeId/kpNodeName`、给 `KpNode` 增 `content`
> 为必填,但两端 `src/mocks/data.ts` 未补字段导致 `tsc` 红。已在 mock 数据补齐(纯展示字段,Resource 关联其知识点、
> KpNode `content:null`),使两端 build 恢复绿。

## FIX4-front(代码审查发现的 5 个前端真实问题修复)

范围:`apps/admin/src`、`apps/teacher/src`、`apps/student/src`、`packages/ui`(不改 contracts/server/schema)。
base 分支 `task/fix4-contract` 已为 `/student/courses/{id}/lessons` 项补 `sessionId`。三端 `npm run build`、
`vitest`(ui 70 / admin 43 / teacher 123 / student 115)、`test:mock` 冒烟均绿。

1. **课程时间线进课堂用真实 sessionId(P1-2)**。`LessonTimeline`/`CoursePage` 进课堂改以该讲返回的 `sessionId`
   为准:`sessionId != null` 才可进并跳 `/classroom/{sessionId}`;已发布但会话未就绪(sessionId=null)→ 不给进、
   显示「课堂未开放,请稍候」,未发布显示「老师发布后即可进入课堂」。不再借用全局 `today` 的会话/本地占位。
   mock `lessonTimeline` 已让已发布讲带 `sessionId`、草稿/已结课为 null。
2. **题目插图真实可见(P1-4 前端侧)**。新增单点函数 `packages/ui/src/oss.ts#resolveOssUrl(ossKey)`:已是可加载
   URL(http/data/blob)原样返回;mock 模式返回占位 SVG `data:` URL(使插图可见而非占位框);真实模式拼后端按 ossKey
   取签名/直链的端点。学生作业/结果(`QuestionPanel`/`ResultView`)与教师录题(`EditorPage` 已保存图)的 figure 渲染
   统一经 `<QuestionFigures resolveSrc={resolveOssUrl}>` / `resolveOssUrl`。**待对接**:真实端点形状(路径/参数,或是否需异步取
   临时 URL)由协调者整合时给出 —— 只需改 `oss.ts` 一处(详见文件头注释)。
3. **录题插图预览 objectURL 释放(P2-11)**。`EditorPage` 用 `previewUrls` ref 跟踪 `URL.createObjectURL` 产物,
   删除该图、组件卸载时 `URL.revokeObjectURL` 释放,防内存泄漏。
4. **新建教师/学生初始密码顺畅(P2-12)**。创建成功后给 `ResetPasswordModal` 传 `auto:true`,弹窗打开即自动调一次
   `POST /admin/{teachers|students}/{id}/reset-password` 取明文初始密码直接展示(复制 +「当面告知」),省去管理员手动再点
   「重置密码」;自动取码失败则提示「可点确认重试或稍后在列表手动重置」。
5. **MOCK 角标(P2-9,防混淆)**。新增通用组件 `packages/ui/src/MockBadge.tsx`,三端 `App` 挂载;mock 模式
   (`VITE_USE_MOCK !== 'false'`)在右下角显示不挡操作(`pointer-events-none`)的「MOCK 数据」角标(design-tokens 橙色),
   真实模式不渲染。

> `resolveOssUrl` 真实分支当前按「后端提供按 ossKey 直接返回(签名)图片、可直接放 `<img src>` 的 GET 端点」假设拼
> `/api/v1/files/sign?ossKey=…`;若实际为异步取临时 URL 或路径/参数不同,改 `oss.ts` 一处即可,所有渲染处自动生效。

## REV-front(代码审核确认的前端真问题修复)

范围:`apps/admin/src`、`apps/teacher/src`、`apps/student/src`、`packages/ui`(不改 contracts/server/schema)。
三端 `npm run build`、`vitest`(ui 77 / admin 43 / teacher 123 / student 115)、`test:mock` 冒烟均绿。

1. **真实模式题目插图全裂 → 异步两跳取签名直链(P1,核心)**。FIX4 的 `resolveOssUrl` 同步拼了不存在的
   `/api/v1/files/sign?ossKey=`。真实端点是 `GET /api/v1/uploads/view-url?ossKey=`(需 Bearer,返回 JSON `{url}`,
   url 指向 `@Public /storage` 签名直链),是**异步两跳**,故同步拼接必然裂图。改法:
   - `packages/ui/src/oss.ts` 新增 `resolveOssUrlAsync(ossKey, fetchViewUrl)`:已是直链 / mock 占位 → 立即 resolve;
     真实模式经注入的 `fetchViewUrl` 换签名直链并**按 ossKey 缓存**(in-flight 复用),失败 resolve(null) 不抛、不长期缓存(可重试)。
     `resolveOssUrl`(同步)保留,仅处理「已是直链 / mock 占位」,真实非直链返回 null 交异步路径。
   - `fetchViewUrl` 由各端在 `api.ts` 提供(`apps/{student,teacher}/src/api.ts#resolveFigureSrc`):仍走该端 `createClient`
     实例(带 token + 统一 401),仅因该端点不属 openapi 契约而在路径处做类型放宽 —— **不是手写 fetch**。
   - `packages/ui` 新增 `<OssImage>`(异步解析 + loading 脉冲占位 → 出图 / 失败降级占位框;同步解析仍即时出图,SSR 友好);
     `<QuestionFigures>` 改用 `OssImage`,`resolveSrc` 类型放宽为可同步可异步(`FigureSrcResolver`)。
   - 调用点统一走异步解析器:学生 `QuestionPanel`/`ResultView`(`resolveSrc={resolveFigureSrc}`)、教师 `EditorPage`
     存图回显(三处直接 `<img>` 改 `<OssImage resolveSrc={resolveFigureSrc}>`,刚上传的本地 `blob:` 预览经 `isLoadable`
     短路即时显示)。mock 下仍返回占位 SVG `data:` URL,无任何网络请求。补 vitest:`oss.spec`(异步缓存/失败重试)、`OssImage.spec`。
   - **QuestionFigures 异步化兼容**:对外 props 形状不变,`resolveSrc` 由 `(k)=>string|null` 拓宽为也接受
     `Promise<string|null>`(旧同步解析器仍可用,`renderToStaticMarkup` 占位/出图断言不破),无需改动调用方签名。

2. **列表加载失败被吞成空态/误导文案 → 区分错误态(可重试)与空态(P2)**。给以下页的加载补 `.catch`,失败显示
   「加载失败 + 重新加载」按钮(区别于真正的空态):teacher `Dashboard`、`CourseLessonsPage`、`AssignmentsPage`、
   `GradingHomePage`、`ResourcesPage`;student `WrongBookPage`(失败不再停在骨架)。`ResourcesPage` 删除失败改为按后端
   返回的 `message` 显示(如被引用约束),不再硬编码「被引用需先解除」。

3. **admin 停用教师无错误处理(P2)**。`apps/admin/src/pages/Teachers.tsx#disableTeacher` 加 `try/catch` + 失败提示
   (与 `enableTeacher` 一致),失败不再静默。

> 不在本次范围(留待专项):在线课堂真实模式无讲义/随堂题、教师监控真实源空 —— 属契约/WS 缺口,本次未动。
