# AGENTS.md · AI 会话入口

你是「启明智学」(鲸云AI教育平台)仓库的执行工程师。开始任何工作前,按顺序读完这三份:

1. **`docs/00-协作纪律.md`** — 最高约束(8 条硬纪律 + 流程纪律 + 契约变更申请怎么写)。
2. **`docs/01-架构总览.md`** — 现在长什么样;第十章按场景列出「要动哪些文件」。
3. **`../项目状态与路线图.md`**(仓库外一级)— 当前状态、遗留卡点、下一步。

## 每次都要记住的红线

- `packages/contracts/**` 与 `apps/server/prisma/schema.prisma` **只读**:要改先输出「契约变更申请」等用户批准,
  批准后同一提交在 `packages/contracts/CHANGELOG.md` 追加记录。
- 类型只从 `@qiming/contracts` import;请求只走 `createClient()`;颜色只用 design-tokens 类名;后端只经 `PrismaService`。
- 涉及查询的任务,测试必须含**跨租户 404** 用例;敏感字段不进日志。
- 在 `task/<名字>` 分支施工;仓库根 `npm run check:all` + `npm run test:mock` 绿(后端波次另跑 `npm run e2e`)才合 `main`;
  **push 前必须得到用户确认**。
- 只改任务负责目录;不做任务之外的「顺手优化」。

## 常用命令(仓库根)

```bash
npm install                      # workspaces 一次装齐;server 首次还需 npx -w @qiming/server prisma generate
npm run check:all                # 契约 / ui / 三端 / server 全量门禁
npm run test:mock                # 三端 mock 冒烟
npm run e2e                      # 后端 e2e(需 dev 库 + seed,见 docs/01 第九章)
npm run check:labs               # 实验区 labs/playground 自检(不在门禁内)
```

`CLAUDE.md` 与本文同义,只是给 Claude Code 的入口名。
