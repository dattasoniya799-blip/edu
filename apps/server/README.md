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
