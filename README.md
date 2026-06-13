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
