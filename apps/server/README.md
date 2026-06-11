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
