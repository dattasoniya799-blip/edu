# @qiming/student · 学生端(B1 脚手架 + B5 常规五页,平板)

Vite + React18 + TS。按 **1180×820 横屏视口**设计(`src/Stage.tsx` 等比缩放适配),触控目标 ≥ 44px(`min-h-touch`)。

## 怎么跑

```bash
npm install          # 另需:packages/ui、packages/contracts 各自 npm install(源码直引)
npm run dev          # http://localhost:5175,默认 mock 模式
npm run build
npm run test         # vitest 43 例(答题器状态机 / 有状态 mock / msw 全链路 / 44px 断言)
npm run test:mock    # msw/node 冒烟(同一份 handlers,含作业全流程)
```

- **学生登录 = 登录码兑换**(`/auth/student/qr-exchange`,扫码的先行形态,B1 口径):mock 演示码 `QM-DEMO`(=林小满),或 `QM-DEMO-1…12`;设备指纹本地持久化,兑换即绑定设备。
- `VITE_USE_MOCK=false` 时代理到 A1 后端(`.env.example`);真实模式需要数据库中有效 ticket(会消耗 ticket 并绑定设备,故 B1 回归仅用管理员只读登录验证后端链路)。

## B5 · 常规五页(今日 / 我的课程 / 答题器 / 错题本 / 报告)

按 MVP 裁剪:**无学分 / streak / 课表(今日)/ 雷达图(报告)**;解答题 **MVP 只做拍照上传**(手写板入口标「即将上线」)。

### 五页清单

| 页 | 路由 | 代码 | 对照原型 |
|---|---|---|---|
| 今日 | `/` | `pages/today/`(TodayPage + TaskRow) | s-home:课程 hero + 任务列表 + 本周学习 mini-stats |
| 我的课程 | `/courses` | `pages/course/`(CoursePage + LessonTimeline) | s-course:课程卡 + 讲次时间线,回看课件 / 订正错题入口 |
| 课后答题器 | `/homework/:assignmentId` | `pages/homework/`(HomeworkPage / useAttempt / machine / QuestionPanel / AnswerCard / ResultView) | s-homework:进度条 + 答题卡 + 单选/填空/拍照 + 即时判分反馈与解析 |
| 错题本 | `/wrong-book` | `pages/wrong/`(WrongBookPage + WrongItemCard) | s-wrong:错因筛选 + 解析折叠 + 重做单题 + 一键重练 |
| 报告 | `/report` | `pages/report/`(ReportPage) | s-report:周数据四卡 + 掌握度条形(绿≥80/主色 60–79/红<60) |

### 断点续答恢复机制

1. 进入答题器:无 `?attempt=` → `POST /student/attempts {assignmentId}`(契约口径:已有 in_progress **幂等返回同一 attempt**);拿到 id 后立刻 `replace` 写进 URL(`/homework/2?attempt=5`)。
2. 中途刷新:URL 带 `?attempt=` → `GET /student/attempts/{id}` 取快照;`machine.deriveItems` 恢复每题「已答/判定/已标记」状态(`restored` 反馈,契约不重发解析文本),`firstUnanswered` 定位到第一道未答题并 toast 提示。
3. mock 有状态:`src/mocks/student-store.ts` 持久化到 **sessionStorage**(浏览器刷新不丢;node 测试纯内存 + `resetStore()`),判分口径对齐 A5(single/multi 即时判分、multi 乱序判对、blank 去空格+全角转半角、判错才下发 correctAnswer+解析、solution 存 photoOssKey 待预批、交卷后纯客观卷自动 graded、重做对 2 次 cleared、再错 re-open 并重置)。
4. 交卷后重新 GET 快照 → 此时题面才携带 `correctAnswer/analysisLatex` → ResultView 逐题看解析。

### 验收映射

| 验收项 | 落点 |
|---|---|
| 开始→中途刷新→续答→交卷→看解析全流程(mock 有状态) | `src/mocks/__tests__/attempt-flow.spec.ts`(msw/node + createClient,同一份 handlers)+ `student-store.spec.ts`;浏览器侧 sessionStorage 持久化 |
| 44px 断言(全部可点目标) | `src/pages/__tests__/touch44.spec.tsx`:jsdom 渲染关键交互组件断言 `min-h-touch` 类 + 源码扫描兜底(五页目录所有 `<Button/<button`) |
| 答题器状态机单测 | `src/pages/homework/__tests__/machine.spec.ts`(进行中/已答/已标记/续答恢复/答题卡取色) |
| 数学内容一律 TexText | 题干/选项/解析/正确答案全走 `<TexText/>`;touch44.spec 断言渲染出 `.katex` |
| 空态与加载骨架 | 五页均有 `<Skeleton/>` + `<EmptyState/>`(无任务/无课程/无讲次/无错题/无掌握度) |
| iPad 1180×820 适配 | B1 Stage 等比缩放;页面内容 max-w 1080,双栏 grid 在视口内无横向滚动 |
| 颜色只来自 design-tokens | 全部类名出自 `qimingPreset`(整表替换,裸色值无法成类) |
| build / vitest | `npm run build` 绿;`npm run test` 43/43 绿;`npm run test:mock` 绿 |

### mock 口径(与 seed 一致)与简化

- 12 学生 / 第 3 讲作业链(作业 16/35 已批改 → 3 道错 → 订正卷 assignment#2:单选+填空+解答)/ **6 条错题**。
- mock 简化(真实后端为教师 finalize 出分时结算):**客观题错题入账/订正消账在交卷时立即生效**;含解答题的卷交卷后停在 submitted(学生端不模拟教师批改)。
- 今日任务列表会出现动态生成的错题重做/重练卷(`wrong_redo`,不计分)。

### 已知偏差(对照原型 v0.4)

- 今日:任务一行一卡(原型把「已批改 88 分 + 待订正」合并为一行);hero 非当天显示具体日期。
- 错题本:无「我的答案/正确答案」行(契约 `WrongBookItem` 无该字段),以错因标签代替;无「练同类题」(无契约端点,v1.1)。
- 报告:无「各讲表现 / 近 4 周走势」(契约 `/student/report` 仅 mastery+weekStats)。
- 答题器:右栏无 AI 助教(B6/AI 任务);课后不限时(无计时器)。
- `packages/ui` Modal 的 ✕ 关闭钮 <44px(既有共享组件未动;两处模态均有 ≥44px 的 footer 按钮与遮罩/ESC 关闭)。

### 契约变更申请 B5-1(待仲裁,详见提交说明)

学生侧无任何可取题面的端点(`/questions/{id}`、`/papers/{id}` 均 [teacher]),申请为 `/student/attempts*` 响应**纯增量**补 `questions` 学生视图(`pages/homework/types.ts` 为形状);`/student/courses/{id}/lessons` 条目补 `resources`(回看入口需要 resource id)。mock 已按申请形状先行;若否决,前端改造点集中在 `useAttempt` 取题逻辑与时间线回看入口(页面已对缺失做降级)。

## B1 页面(保留)

- 登录页(三角色 Tab;管理员/教师 Tab 指引到 PC 端)
- 顶部胶囊 Tab 外壳 `pages/Shell.tsx`(激活 = primary 实底白字)

## 覆盖的验收项(B1)

- mock 模式输入登录码可进入工作台,4 个主 Tab 全部可点;`npm run build` 通过。
