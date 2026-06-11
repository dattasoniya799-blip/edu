# @qiming/student · 学生端(B1 脚手架,平板)

Vite + React18 + TS。按 **1180×820 横屏视口**设计(`src/Stage.tsx` 等比缩放适配),触控目标 ≥ 44px(`min-h-touch`)。

## 怎么跑

```bash
npm install
npm run dev          # http://localhost:5175,默认 mock 模式
npm run build
npm run test:mock    # msw/node 冒烟(同一份 handlers)
```

- **学生登录 = 登录码兑换**(`/auth/student/qr-exchange`,扫码的先行形态,B1 口径):mock 演示码 `QM-DEMO`(=林小满),或 `QM-DEMO-1…12`;设备指纹本地持久化,兑换即绑定设备。
- `VITE_USE_MOCK=false` 时代理到 A1 后端(`.env.example`);真实模式需要数据库中有效 ticket(会消耗 ticket 并绑定设备,故 B1 回归仅用管理员只读登录验证后端链路)。

## 页面(按 MVP 裁剪:无学分/连续天数/课表)

- 登录页(三角色 Tab;管理员/教师 Tab 指引到 PC 端)
- 顶部胶囊 Tab:今日(课程 hero + 任务列表,接 mock)/ 我的课程 / 错题本(`<TexText/>` 渲染题干与解析)/ 报告(掌握度条形,进度条按 绿≥80/主色/红<60 取色)

## 覆盖的验收项

- mock 模式输入登录码可进入工作台,4 个主 Tab 全部可点;`npm run build` 通过。
