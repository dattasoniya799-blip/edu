# D4 压测工具(1 教师 + N 学生)

零外部依赖(Node ≥18 自带 `fetch`;WS 场景复用 devDependencies 里的 `socket.io-client`),
经 `tsx` 直接运行,**不进入 `nest build` 产物**(tsconfig `include` 只含 `src/`、`test/`,
`tools/` 不参与构建,`npm run build` 不受影响)。

## 场景(全部走真实业务 API,序列与 e2e 一致)

| 角色 | 流量 |
|---|---|
| 学生 ×N(默认 20) | `POST /auth/student/login` → 循环:`GET /student/assignments` → `POST /student/attempts` → `GET /student/attempts/:id`(题面)→ 4× `PUT …/answers/:qid`(单选即时判分)→ `POST …/submit`(交卷触发 finalize:错题入账 + mastery 队列);每 10 轮重登录一次 |
| 教师 ×1 | `POST /auth/login` → 每 2s:`GET /grading/pending` + `GET /assignments` + `GET /assignments/:id/progress` |
| 课堂 WS(`--ws`) | N 条 socket.io 连 `/classroom`,`class:join` 同一 session(握手鉴权 + join ack 计入指标),在堂保持到结束 |

**不打 AI 端点**(`/ai/qa`、`class:ai_ask`):真实 DeepSeek 计费。

准备阶段(内置、幂等):管理员登录 → 确保 N 个 `LT-XXXX` 压测学生存在、在册、激活,
`reset-password` 取明文;教师建 4 道单选压测卷(practice)→ 发 **consolidation** 作业
(允许重复作答,避免 homework 一次性限制);`--ws` 时发布 ready 讲次拿 sessionId。

## 用法

```bash
cd apps/server
npm run loadtest -- --base-url http://127.0.0.1:3100 --vus 20 --duration 60 --ws
```

参数(均可选):`--vus 20` `--duration 60` `--think-ms 200`(0=全速)
`--teacher-interval-ms 2000` `--relogin-every 10` `--ws` `--setup-only`
`--max-error-rate 0.01` `--max-p95-ms 2000`
`--admin-phone/--admin-password/--teacher-phone/--teacher-password`(默认演示 seed 账号)。

输出:每端点 count / 错误数 / 错误率 / P50 / P95 / P99 / avg / max + 总 RPS。
退出码:`0` 达标;`1` 错误率 > `--max-error-rate` 或任一端点 P95 > `--max-p95-ms`;`2` 环境/准备失败。

## 本地隔离验证(不碰 :3000 / qiming_dev)

```bash
# 1. 独立库(容器名按实际 compose project 调整)
docker exec -i qiming-postgres-1 psql -U qiming -d postgres \
  -c "DROP DATABASE IF EXISTS qiming_load;" -c "CREATE DATABASE qiming_load;"
docker exec -i qiming-postgres-1 psql -U qiming -d qiming_load -v ON_ERROR_STOP=1 \
  < prisma/migrations/0001_init/migration.sql

# 2. 种子(全部显式传 DATABASE_URL)
export LOAD_DB=postgresql://qiming:qiming_dev@127.0.0.1:5432/qiming_load
DATABASE_URL=$LOAD_DB npm run db:seed:base
DATABASE_URL=$LOAD_DB npm run db:import-kp
DATABASE_URL=$LOAD_DB npm run db:seed:business

# 3. 起隔离实例(worktree 无 .env,变量全显式)
npm run build
NODE_ENV=test DATABASE_URL=$LOAD_DB REDIS_URL=redis://127.0.0.1:6379/4 \
  BULLMQ_PREFIX=load JWT_SECRET=loadtest-secret PORT=3100 \
  TS_NODE_BASEURL=./dist/apps/server node -r tsconfig-paths/register dist/apps/server/src/main.js &

# 4. 压测 + 清理
npm run loadtest -- --base-url http://127.0.0.1:3100 --vus 20 --duration 60 --ws
kill %1
docker exec -i qiming-postgres-1 psql -U qiming -d postgres -c "DROP DATABASE qiming_load;"
docker exec -i qiming-redis-1 redis-cli -n 4 flushdb
# 注意:BullMQ 连接只取 REDIS_URL 的 host/port,忽略 /4 库号 → 队列键落在 db0 的 load:* 前缀
docker exec -i qiming-redis-1 sh -c 'redis-cli -n 0 --scan --pattern "load:*" | xargs -r redis-cli -n 0 del'
```

## 在服务器上对生产 / 预发跑(上线前验收)

**跑之前必须:**

1. **备份数据库**(压测会真实写入 attempts/answers/wrong_book/mastery 等):
   `pg_dump -Fc "$DATABASE_URL" > backup-before-loadtest.dump`
2. **避开上课时间**:压测与真实课堂共用连接池/Redis,高峰期施压会影响在线学生。
3. **AI 路由切 mock**:管理后台「AI 配置」把路由切到 mock/stub,确认 `/ai/*` 不会打到真实
   DeepSeek(本工具不主动调 AI,但压测产生的批改流水等旁路逻辑须确认不触发真实计费)。
4. 确认目标是**预发/维护窗口内的生产**,不要指向他人正在演示的实例(工具内置拒绝 `:3000`)。

```bash
cd apps/server
npm run loadtest -- --base-url https://staging.example.com \
  --vus 20 --duration 60 --ws \
  --admin-phone <管理员手机号> --admin-password '<密码>' \
  --teacher-phone <教师手机号> --teacher-password '<密码>'
```

**跑完之后:**

- 压测数据可辨识、可清理:学生学号 `LT-XXXX`、试卷名 `D4 压测卷 *`;生产验收后建议直接
  用备份回滚,或在管理后台删除压测学生/试卷。
- 压测会把 `LT-` 学生密码重置(setup 阶段 reset-password),这些账号仅供压测,不影响真实学生。
- 检查 BullMQ 队列(pre_grading/mastery)是否消化完毕再下结论(交卷触发 mastery 重算是异步的)。
