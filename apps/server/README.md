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
