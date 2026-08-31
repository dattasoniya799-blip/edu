# 启明智学(鲸云AI教育平台)

面向 K12 培训机构的多租户 AI 教学平台:管理端(机构/师生/课程/AI 管理)、教师端(题库/组卷/讲次编排/批改/课堂监控/AI 课件)、学生端(作业/错题本/实时课堂/AI 答疑),AI 能力统一经后端 LLM 网关接入,可按功能在真实供应商与 mock 间切换。

> 品牌名「鲸云AI教育平台」,代码标识符保留 `@qiming/*`、库名 `qiming_*`。

## 仓库结构

| 目录 | 内容 | 端口 |
|---|---|---|
| `apps/server` | NestJS 后端(Prisma + PostgreSQL + Redis + BullMQ + socket.io) | 3000 |
| `apps/admin` / `apps/teacher` / `apps/student` | 三个 Vite React 前端 | 5173 / 5174 / 5175 |
| `apps/lab` | 本地实验区,**永不部署** | 5176 |
| `packages/contracts` | API/WS/设计令牌契约(唯一事实,改动需审批) | — |
| `packages/ui` | 跨端共享组件 + Tailwind 预设 | — |
| `deploy/` | 生产编排(compose / nginx / Dockerfile / 部署手册) | — |

## 快速启动

```bash
npm install                                              # 仓库根,npm workspaces 一次装齐全部端
docker compose -f docker-compose.dev.yml up -d          # Postgres 5432 + Redis 6379
cd apps/server && cp .env.example .env
npm run db:apply-sql && npm run db:seed:base && npm run db:import-kp && npm run db:seed:business
npm run start:dev                                        # 后端 :3000

cd ../teacher
VITE_USE_MOCK=false npm run dev                          # 教师端 :5174,打真后端
```

全量门禁:仓库根 `npm run check:all`(契约/ui/三端/lab/server);后端 e2e:`npm run e2e`(需 dev 库 + seed)。

前端默认走 MSW mock(可完全离线开发);连真后端必须显式 `VITE_USE_MOCK=false`。

## 文档地图

| 想知道什么 | 看哪里 |
|---|---|
| **现在长什么样、改代码前必读** | [`docs/01-架构总览.md`](docs/01-架构总览.md)(目录职责/后端/前端/数据流/**常见改动指南**) |
| 文档目录约定与维护要求 | [`docs/README.md`](docs/README.md) |
| 为什么变成这样(历史交付记录) | [`CHANGELOG.md`](CHANGELOG.md) |
| 协作纪律、契约变更记录 | 仓库外 `../启明智学-开工包/01-项目宪法.md` |
| 当前状态与路线图 | 仓库外 `../项目状态与路线图.md` |
| 部署 | [`deploy/部署手册.md`](deploy/部署手册.md) |
| 各 app 细节 | 各 `apps/*/README.md` |

## 测试与门禁

见 [`docs/01-架构总览.md`](docs/01-架构总览.md) 第九章:后端 e2e(真库真 Redis)、三端 vitest + build(tsc)、`packages/*` 的 check、契约 lint。
