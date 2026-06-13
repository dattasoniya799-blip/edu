# @qiming/admin · 管理员端(B2:全部页面)

Vite + React18 + TS。类型/客户端来自 `@qiming/contracts`(alias 指向源码),UI 来自 `@qiming/ui`。

## 怎么跑

```bash
npm install
npm run dev          # http://localhost:5173,默认 mock 模式(msw)
npm run build        # tsc --noEmit + vite build
npm test             # vitest:纯逻辑单测 + IMPL2 admin-flow.spec(重置密码明文 / 入班增删)
npm run test:mock    # msw/node 冒烟:登录→/me→列表接口(与浏览器同一份 handlers)
```

- **mock 开关**:`VITE_USE_MOCK`(见 `.env.example`)。非 `false` 即启用 msw;`VITE_USE_MOCK=false npm run dev` 时 `/api` 代理到 `VITE_API_TARGET`(默认 `http://localhost:3000` 的后端)。**切真实 API 零代码改动**(接口一律走 contracts `createClient`)。
- mock 登录:管理员 `13800000001 / Admin@123`(真实模式同 seed 账号)。
- msw handlers 按 `packages/contracts/openapi.yaml` 全量实现且**有状态**(添加教师/学生/课程、入班/移出、解绑设备、改设置后刷新可见);数据集中在 `src/mocks/data.ts`(W0 seed 口径),禁止散落组件。

### IMPL2 改动(本批)
- **学生改密码登录**:学生管理列表「重发/发送登录码」→ **「重置密码」**;`ResetPasswordModal` 调 `POST /admin/students/{id}/reset-password`,弹窗显示返回的明文临时密码(可复制,提示当面告知学生)。删除 `LoginTicketModal`(不再用 QrCode 发登录码;`QrCode` 组件仍保留在 `@qiming/ui`)。档案设备项无绑定显示「未绑定 / 不适用」。
- **入班**:`RosterModal` 增「+ 添加学生」(多选未在课学生 → `POST /admin/courses/{id}/students {studentIds}`)与每行「移出」(`DELETE /admin/courses/{id}/students/{studentId}`),增删即时刷新名单与课程卡。mock `courseMembers` 有状态。

### C2 改动(本批,管理员域 3 项 bug)
- **#1 教师密码改明文重置(去短信)**:`ResetPasswordModal` 通用化(`target = {id,name,no,role}`,`role` 切学生/教师文案与接口)。教师管理「重置密码」与「新建教师后」均弹明文临时密码(可复制 + 当面告知教师),调 `POST /admin/teachers/{id}/reset-password → {password}`。`TeacherFormModal` 去掉「短信发送初始密码」文案/流程。
- **#2 入班候选名单**:候选学生过滤抽成纯函数 `lib/roster.ts#candidateStudents`(候选 = 全部学生 − 课程 **active** 名单;新课 0 人时全可选;已退课学生可重新入班),`RosterModal` 改用之;`lib/__tests__/roster.spec.ts` 覆盖。
- **#3 停用可见 + 恢复启用**:教师/学生列表加「状态」筛选(走 `?status`,含「已停用」=`disabled`);停用项显示「恢复启用」→ 调 `POST /admin/teachers|students/{id}/enable` 后刷新;状态胶囊 active/disabled 正确。mock 补 `enable`、教师 `reset-password` 返 `{password}`、学生 `?status` 过滤,并 seed 1 名停用学生。
- **mock 对齐契约新字段**:`data.ts` 的 Question 补 `analysisBriefLatex/analysisDetailLatex`、Lesson 补 `openingConfig`、Segment 补 `unitSeq`(否则 `tsc` 不过)。

## 页面清单(B2 范围,对照原型 view-admin)

| 路由 | 页面 | 内容 |
| --- | --- | --- |
| `/` | 数据总览 | 问候 + 今日课次 · 四统计卡(教师/学生/到课率/AI 开销+额度占比)· 最近动态(语义色图标) |
| `/teachers` | 教师管理 | 关键词/状态筛选 · 列表(学段学科胶囊、题库贡献、状态)· 添加/编辑弹窗 · **重置密码弹窗(明文临时密码,可复制)** · 停用确认 · **已停用项「恢复启用」** · 分页 |
| `/students` | 学生管理 | 关键词/**状态**/课程/绑定状态筛选 · 列表(在读课程胶囊、设备、近 7 日时长)· 添加弹窗(创建后设置初始密码)· 学生档案弹窗(mini-stats + 课程 + 设备解绑)· **重置密码弹窗(明文临时密码,可复制)** · **已停用项「恢复启用」** · 分页 |
| `/courses` | 课程与班级 | 课程卡片(班型徽标/进度/下次上课/到课·作业率)· 新建课程弹窗(班型三选,讲次数;排课规则按裁剪表延后)· 名单弹窗(添加学生 / 移出 → 学生档案)· 一对一直达学生档案 |
| `/ai-usage` | AI 用量与开销 | 摘要四卡(Token/费用+额度条/课均成本/告警)· 近 14 日柱状图 · 按功能拆分 · 额度与告警设置弹窗;**按课程拆分按裁剪表砍掉** |
| `/settings` | 平台设置 | AI 能力卡(引导模式 Switch,可改;其余固定默认值)· 账号与安全卡(使用时段弹窗,HH:MM 校验) |

## 结构

- `src/auth/`:AuthProvider(token 内存+localStorage,401 统一跳登录)+ token 存取
- `src/api.ts`:contracts `createClient()` 唯一出口(禁止手写 fetch)
- `src/pages/`:六个页面 + 登录页 + Shell(浅色侧栏 + 58px topbar)
- `src/components/`:业务弹窗(教师/学生/课程表单、档案、重置密码、名单+入班、额度)+ 基础控件(Toolbar/Field/Pager/BarChart/ConfirmModal)
- `src/lib/`:纯逻辑(`format`/`validate`/`paging`/`labels`),vitest 覆盖
- 颜色只来自 design-tokens 派生的 Tailwind 类(tailwind preset 整表替换,裸色值无法通过类名出现)

## 验收项映射

| 验收项 | 实现 |
| --- | --- |
| 对照原型逐页走查(布局/配色/状态胶囊) | 六页均按 view-admin 实现;胶囊 = `Tag`(soft 底 + 语义色字),班型 b1v/b11/b13 = primary/orange/violet |
| 重置学生密码看到明文(IMPL2) | `ResetPasswordModal` 调 `POST /admin/students/{id}/reset-password`,显示返回 `data.password` 明文(可复制 + 当面告知);`admin-flow.spec` 覆盖 |
| 课程入班/移出(IMPL2) | `RosterModal` 添加学生(`POST .../students`)/ 移出(`DELETE .../students/{studentId}`),即时刷新;`admin-flow.spec` 覆盖增删幂等 |
| 教师密码明文重置、去短信(C2 #1) | 教师「重置密码」/新建后弹 `ResetPasswordModal`(`role:teacher`)→ `POST /admin/teachers/{id}/reset-password` 明文;`admin-flow.spec` 覆盖 |
| 入班候选只列未在课学生(C2 #2) | 纯函数 `candidateStudents`(全部 − active 名单);`roster.spec` 覆盖新课全选 / 退课可再入 / 全员在课为空 |
| 停用后可见 + 恢复启用(C2 #3) | 列表「状态」筛选走 `?status`;停用项「恢复启用」→ `.../enable`;`admin-flow.spec` 覆盖学生/教师停用→可见→启用 |
| 切真实 API 零代码改动 | 全部经 `api`(createClient);`VITE_USE_MOCK=false` 仅切代理 |
| 每页有空态与加载骨架 | 列表页 = Table 骨架 + 空态文案;总览/课程/AI/设置 = `Skeleton` 块 + `EmptyState`(含失败重试) |
| build / 测试 | `npm run build` 绿;`npm test` 绿;`npm run test:mock` 冒烟绿 |
