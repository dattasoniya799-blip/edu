# 鲸云AI教育平台 · W0 交付包(数据库 + 契约,Gate-0 审核对象)

本包为任务卡 W0-1 的交付物,已在 PostgreSQL 16 真实环境完整跑通。

> **契约变更记录**(详见开工包 01-项目宪法.md 末尾):
> - [2026-06-11,已批准] schema.prisma 枚举重排为合法多行格式,零语义变化;
>   `prisma generate` 现可正常使用。A1 起后端通过 Prisma Client(带租户注入)访问数据库。
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

## C3-back(发布后三项后端:知识点内容库 / 发布即建课堂会话 / 作业总览)

实现范围:`apps/server/src/{knowledge(新),kp,lesson,classroom,assignment,resource}` 及 e2e
(`test/c3.e2e-spec.ts`、`test/fixtures/c3.fixtures.ts`);`app.module` 仅加 `KnowledgeModule` 一行。
不改 contracts/schema;契约新增形状(KpContentPack / Resource.kpNodeId / KpNode.content /
GET·PUT `/knowledge/content-packs*` / GET `/assignments`)由 `c3-contract` 提供。

1. **#A 知识点内容库**(`src/knowledge`)
   - `GET /knowledge/content-packs?graphId=` 列该图谱下已维护内容包(join kpNodeName/resourceName/paperName)。
   - `GET /knowledge/content-packs/{kpNodeId}` 单个;**未维护返回空包**(lecture/practice 为 null、summaryConfig `{}`),不 404。
   - `PUT /knowledge/content-packs/{kpNodeId}` 按 orgId+kpNodeId upsert;缺省字段不改、显式 `null` 清空;校验 kpNode/resource/paper 同 org(跨租户经租户注入天然 404)。
   - `GET /kp/nodes` 透出 `content`(DB 既有列);Resource 的 list/create/update 支持 `kpNodeId`(可空)并 join 回填 `kpNodeName`。
2. **#B 发布即建课堂会话**(`src/lesson`)
   - 讲次 `publish`(status→ready)时**自动建一条 `class_session`**(`status='scheduled'`,mode 取自 practice 编排:`ai_guide→guideOnly`、`stuck_alert_min→stuckAlertMin`)。
   - 幂等:该讲已有未结束会话则复用,重复 publish 不重复建。修复"学生 sessionId 恒 null 进不去课堂"——`/student/today.todayLesson.sessionId` 非 null,学生 `class:join` 即进入(scheduled→live,A6 网关)。
3. **#C 作业总览列表**(`src/assignment`)
   - `GET /assignments?courseId=&lessonId=&status=` [teacher] → AssignmentBriefDto[](仅本教师课程的作业;submitted/totalStudents/graded 进度;`status=ongoing/finished` 由"已提交且全部出分"判定)。

跑通(库 `qiming_c3`,Redis 队列前缀 `BULLMQ_PREFIX=c3`、课堂键前缀 `CLS_REDIS_PREFIX=c3:`,禁碰其他库/FLUSHALL):
```bash
cd apps/server && cp .env.example .env   # DATABASE_URL → .../qiming_c3;加 BULLMQ_PREFIX=c3 与 CLS_REDIS_PREFIX=c3:
npm install && npx prisma generate
cat prisma/migrations/0001_init/migration.sql | docker exec -i <pg> psql -U qiming -d qiming_c3
npm run db:seed:base && npm run db:import-kp && npm run db:seed:business
npm test     # e2e 15 套件 / 200 用例;连跑两次全绿
```
验收用例(`test/c3.e2e-spec.ts`,16 项):内容包 upsert→回读 / 未维护空包 / 列表 / Resource 挂 kpNode 存读清空 /
kpNode.content 透出 / 内容包·Resource 引用不存在节点 404 / [teacher] 门禁 + 跨租户 404;publish 建 scheduled 会话 +
today.sessionId 非 null + 幂等 + draft 无会话 + 学生 `class:join` 进入;作业总览 seed 第3讲对账(finished)+
夹具 ongoing/finished + status/lessonId 过滤 + 门禁/他师·跨租户不可见。夹具用 **13910 号段**自建自清。
