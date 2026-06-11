# @qiming/admin · 管理员端(B2:全部页面)

Vite + React18 + TS。类型/客户端来自 `@qiming/contracts`(alias 指向源码),UI 来自 `@qiming/ui`。

## 怎么跑

```bash
npm install
npm run dev          # http://localhost:5173,默认 mock 模式(msw)
npm run build        # tsc --noEmit + vite build
npm test             # vitest:表单校验 / 数据格式化 / 分页窗口等纯逻辑单测
npm run test:mock    # msw/node 冒烟:登录→/me→列表接口(与浏览器同一份 handlers)
```

- **mock 开关**:`VITE_USE_MOCK`(见 `.env.example`)。非 `false` 即启用 msw;`VITE_USE_MOCK=false npm run dev` 时 `/api` 代理到 `VITE_API_TARGET`(默认 `http://localhost:3000` 的 A1 后端)。**切真实 API 零代码改动**(接口一律走 contracts `createClient`)。
- mock 登录:管理员 `13800000001 / Admin@123`(真实模式同 seed 账号)。
- msw handlers 按 `packages/contracts/openapi.yaml` 全量实现且**有状态**(添加教师/学生/课程、解绑设备、改设置后刷新可见);数据集中在 `src/mocks/data.ts`(W0 seed 口径),禁止散落组件。

## 页面清单(B2 范围,对照原型 view-admin)

| 路由 | 页面 | 内容 |
| --- | --- | --- |
| `/` | 数据总览 | 问候 + 今日课次 · 四统计卡(教师/学生/到课率/AI 开销+额度占比)· 最近动态(语义色图标) |
| `/teachers` | 教师管理 | 关键词/状态筛选 · 列表(学段学科胶囊、题库贡献、状态)· 添加/编辑弹窗 · 重置密码弹窗 · 停用确认 · 分页 |
| `/students` | 学生管理 | 关键词/课程/绑定状态筛选 · 列表(在读课程胶囊、设备、近 7 日时长)· 添加弹窗(创建后即弹登录码)· 学生档案弹窗(mini-stats + 课程 + 设备解绑)· **登录码二维码弹窗(qrcode 库,内容 = ticket token)** · 分页 |
| `/courses` | 课程与班级 | 课程卡片(班型徽标/进度/下次上课/到课·作业率)· 新建课程弹窗(班型三选,讲次数;排课规则按裁剪表延后)· 名单弹窗(→ 学生档案)· 一对一直达学生档案 |
| `/ai-usage` | AI 用量与开销 | 摘要四卡(Token/费用+额度条/课均成本/告警)· 近 14 日柱状图 · 按功能拆分 · 额度与告警设置弹窗;**按课程拆分按裁剪表砍掉** |
| `/settings` | 平台设置 | AI 能力卡(引导模式 Switch,可改;其余固定默认值)· 账号与安全卡(使用时段弹窗,HH:MM 校验) |

## 结构

- `src/auth/`:AuthProvider(token 内存+localStorage,401 统一跳登录)+ token 存取
- `src/api.ts`:contracts `createClient()` 唯一出口(禁止手写 fetch)
- `src/pages/`:六个页面 + 登录页 + Shell(浅色侧栏 + 58px topbar)
- `src/components/`:业务弹窗(教师/学生/课程表单、档案、登录码、名单、额度)+ 基础控件(Toolbar/Field/Pager/BarChart/ConfirmModal)
- `src/lib/`:纯逻辑(`format`/`validate`/`paging`/`labels`),vitest 覆盖
- 颜色只来自 design-tokens 派生的 Tailwind 类(tailwind preset 整表替换,裸色值无法通过类名出现)

## 验收项映射

| 验收项 | 实现 |
| --- | --- |
| 对照原型逐页走查(布局/配色/状态胶囊) | 六页均按 view-admin 实现;胶囊 = `Tag`(soft 底 + 语义色字),班型 b1v/b11/b13 = primary/orange/violet |
| 登录码弹窗可扫二维码,内容 = ticket token | `LoginTicketModal` + `@qiming/ui` `QrCode`(qrcode 库,SVG);mock token 与学生端 `qr-exchange` 口径一致(QM-DEMO-N) |
| 切真实 API 零代码改动 | 全部经 `api`(createClient);`VITE_USE_MOCK=false` 仅切代理 |
| 每页有空态与加载骨架 | 列表页 = Table 骨架 + 空态文案;总览/课程/AI/设置 = `Skeleton` 块 + `EmptyState`(含失败重试) |
| build / 测试 | `npm run build` 绿;`npm test` 23 用例绿;`npm run test:mock` 冒烟绿 |
