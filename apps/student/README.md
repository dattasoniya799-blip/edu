# @qiming/student · 学生端(B1 脚手架 + B5 常规五页 + B6 课堂模式,平板)

Vite + React18 + TS。按 **1180×820 横屏视口**设计(`src/Stage.tsx` 等比缩放适配),触控目标 ≥ 44px(`min-h-touch`)。

## 怎么跑

```bash
npm install          # 另需:packages/ui、packages/contracts 各自 npm install(源码直引)
npm run dev          # http://localhost:5175,默认 mock 模式(REST=msw;课堂 WS 假服务自动挂到 dev server)
npm run build
npm run test         # vitest 81 例(B5 43 + B6 38:课堂状态机/重连状态机/WS 集成/流式渲染/44px)
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

## B6 · 课堂模式(四环节 + WS)

**进入方式(mock)**:登录码 `QM-DEMO` 登录 → 今日页 hero「进入课堂」(或 我的课程 → 第 4 讲「进入课堂」)→ `/classroom/401`。
整屏接管:课堂路由不挂 Shell(隐藏常规导航),深色 class-head(退出 + 可点步进器 + 已上课计时)+ 底部 AI 旁白条(classFoot);下课/退出返回常规导航。

### 四环节清单(对照原型 v0.4)

| 环节 | 代码 | 对照原型 | 内容 |
|---|---|---|---|
| ① 开场回顾 | `pages/classroom/WarmupSegment.tsx` | s-class-warm | 错题卡列表(REST `/student/wrong-book?status=open` 前 3,warmup config `source=auto_wrong`),标记已回顾 → 进入新课 |
| ② 课件讲解 | `LectureSegment.tsx` | s-class-lecture | 分页查看(上一页/下一页/页码)+ 末页**打点小测软提示**(答错给提示可重试,不拦「完成讲解」,仅 toast 软提醒) |
| ③ 随堂练 | `PracticeSegment.tsx` | s-class | **复用 B5 答题组件**(QuestionPanel/AnswerCard,行为未动)+ AI 助教侧栏 `TutorPanel.tsx`(chips + 输入,`class:ai_ask` → `class:ai_chunk` SSE 式流式逐字渲染);作答走 WS `class:answer`(等价 REST 的二选一通道) |
| ③b 大题 | `PracticeSegment.tsx`(solution 题)| s-bigq | 压轴解答题拍照上传(复用 B5 拍照占位;手写板 MVP 裁剪)→ 提交 → **AI 预批结果卡**(`AnswerResult.narration` 按行渲染,✓ 绿 / ✕ 红)→ 进入小结 |
| ④ 小结下课 | `SummarySegment.tsx` | s-class-end | end-hero(本堂表现 = 客观题正确率)+ 本堂知识掌握 + AI 小结 + 课后任务(REST `/student/assignments?status=pending`)→ 下课返回首页 |

教师 `class:control`:pause → 整屏遮罩「老师暂停了课堂」;resume → 恢复;end → 落到小结(已下课态);force_segment → 跟随切环节。

### WS 客户端封装(`pages/classroom/ws/`,事件名/负载逐字 ws-protocol.ts)

- `client.ts` `ClassroomWsClient`:命名空间 `/classroom`,握手 `auth.token`;connect → `class:join` ack 取 ClassSnapshot 渲染;`class:answer` Promise 化(ack 超时可注入);`class:ai_ask`/`class:hand_up`/`class:segment` 直发;S2C(`class:state`/`narration`/`ai_chunk`/`control`)+ A6 的 `exception` 通道回调分发。
- **心跳**:`class:heartbeat` 每 10s(`heartbeatMs` 可注入,测试用 100–200ms),负载 `currentQuestion`(`markActivity(qid)` 维护)+ `idleSec`(最近活跃时间差,服务端据此驱动 stuck)。
- **断线指数退避重连**:关闭 socket.io 内建重连,自管纯函数状态机 `ws/reconnect.ts`(idle→connecting→joining→live;lost→waiting(1s/2s/4s/8s/15s 封顶,可注入)→retry;close 终态),vitest 单测覆盖;join ack 超时(A6:被拒不回包)同样按断线进退避。
- `useClassroom.ts`:client ↔ `machine.ts` reducer 装配;`machine.ts` 为纯函数(快照恢复/作答/AI 流式拼接/control/环节钳位),单测覆盖。

### 断线恢复机制(7.5 口径)

1. 断线(transport close / 握手失败 / join 超时)→ 停心跳 → 指数退避计划重连,头部显示「重连中(第 N 次)」。
2. 重连成功自动重新 `class:join` → ack 快照;`machine.applySnapshot` **合并**:本地已有完整作答(选项回显 + 判分反馈)整项保留,本地缺失的按快照判定恢复(restored 反馈,负载契约不回传);当前题 = 快照 `me.currentQuestion`(心跳上报);AI 对话尾巴只在本地更短时回填 → **回到原题且已答不丢,无感恢复**。
3. 刷新重进(无本地状态)同理:全部按快照 restored 恢复(与 B5 续答同口径)。

### mock WS 假服务(`src/mocks/classroom-server.ts` + `class-data.ts`,行为对齐 A6)

- `npm run dev` 时经 vite 插件挂到 dev server 同源 `/socket.io`(`vite.config.ts`);测试挂临时 http server。
- join 返回快照(+ 增量题面/课件,见 B6-1)并推 `class:state` 与环节 narration;heartbeat 驱动 stuck(阈值可注入);`class:answer` 复用 student-store 的 A5 判分口径 + 模板 narration(解答题 judged=false,narration=预批要点);`class:ai_ask` 流式分片(间隔/片长可注入);`control()` 句柄广播(学生 socket 发 `class:control` → 403 exception);学生状态按 token 驻留内存(= A6 Redis 热状态),断线重连/刷新不丢。
- 鉴权:无效 token → `connect_error`;错误 sessionId → `exception` 且 **ack 不回包**(A6 口径)。

### 验收映射(B6)

| 验收项 | 落点 |
|---|---|
| mock WS 下走完四环节(socket.io-client 直驱 + 组件级) | `src/mocks/__tests__/classroom-ws.spec.ts`(join 快照契约逐字段 / 四环节走完:5 题判分+错题入账+大题预批+下课广播)+ `pages/classroom/__tests__/touch44.classroom.spec.tsx`(四环节组件真渲染) |
| **断网 10s 重连回到原题且已答不丢** | classroom-ws.spec「模拟断网 10s → 指数退避自动重连 → 回到原题且已答不丢」:真实关监听+毁连接 10s,断言重连后 `quiz.current` 回到原题、判定/负载/计数齐全、通道继续可用;reducer 侧另有 machine.spec「断线重连:快照无感恢复」 |
| AI 答疑流式逐字渲染 | classroom-ws.spec(chunk 多分片/requestId 稳定/拼接无损/末片 done)+ `tutor-stream.spec.tsx`(chunk 序列驱动 TutorPanel 真渲染,断言文案渐进增长)+ machine.spec(渐进拼接) |
| 心跳 10s(可注入)驱动 stuck | classroom-ws.spec(注入 150ms 心跳断言上报;idleSec 超阈值 → stuck,回落复位) |
| WS 重连状态机 / 快照恢复 reducer 单测 | `__tests__/reconnect.spec.ts`(退避序列 1s/2s/4s/8s/15s 封顶、joined 清零、close 终态)+ `__tests__/machine.spec.ts` |
| 44px 断言(沿用 B5 touch44 模式) | `touch44.classroom.spec.tsx`:渲染断言 + classroom 目录源码扫描兜底;颜色全部出自 design-tokens 预设类(深色头部=token ink,辅助色为 card/绿/橙加透明度派生) |
| build / vitest | `npm run build` 绿;`npm run test` 81/81 绿;`npm run test:mock` 绿 |

### 已知偏差(对照原型 v0.4)

- 课件页为文本+公式排版(原型为内嵌 SVG 动画);打点小测按任务卡做成**软提示**(原型文案「答对才能继续」,任务卡口径优先)。
- 回顾环节错题卡来自**个人**错题本(契约无「上讲全班高频错题」端点);卡片口答按钮简化为「标记已回顾」。
- 大题为拍照上传(手写板 MVP 裁剪,同 B5);AI 预批结果卡的结构化步骤无契约载体,以 `AnswerResult.narration` 多行文案渲染(✓/✕ 着色)。
- 小结页「本堂知识掌握」为本地口径(客观题正确率 + 大题提交态),无逐知识点掌握条(快照无该数据);学分/streak 按裁剪不做。
- 头部计时为「已上课时长」(elapsedSec + 本地走表),无「本环节剩余 mm:ss」倒计时(快照仅有环节 durationMin,无环节起点时间)。

### 契约变更申请 B6-1(待仲裁;mock 先行 + 字段缺失降级,模式同 B5-1)

ws-protocol 的 `ClassSnapshot` 不含任何可渲染内容:`me.answers` 仅 questionId/isCorrect/score,学生侧无随堂练题面与课件分页的取数通道。申请为 `class:join` ack **纯增量**补两个可选字段(形状见 `pages/classroom/types.ts`):
`questions: AttemptQuestionView[]`(沿用 B5-1 学生题面视图)与 `courseware: CoursewarePageView[]`(课件分页 + 打点小测)。
缺失时前端降级(随堂练/课件区占位提示,不白屏);若否决,改造点集中在 join 后追加 REST 取数(机制已隔离在 `applySnapshot` 入参)。
另:重连快照恢复的已答题**只回判定不回作答负载**(契约如此),前端以 restored 占位展示——若希望恢复选项回显,需 `me.answers` 增补 `response`(非阻塞,仅体验项)。

### C2 真实 WS 联调接线(A6 后端就绪后)

1. `.env` 设 `VITE_USE_MOCK=false`(`VITE_API_TARGET` 指向 A6 所在后端):msw 关闭,REST 经 vite 代理 `/api` → 后端;`/socket.io` 代理(含 ws 升级)已在 `vite.config.ts` 配好,课堂 WS 假服务自动不挂载。
2. `ClassroomWsClient` 握手 `auth.token` 直接用登录 token(`auth/token.ts`),与 A6 JWT 校验对齐;事件与快照形状零改动。
3. 入口 sessionId 来自 `/student/today` 的 `todayLesson.sessionId`(scheduled→live 由教师开课,提前 10 分钟可 join);mock 增量 `questions/courseware` 缺失时课件/随堂练区会降级占位 —— 等 B6-1 仲裁结果决定服务端下发或 REST 取数。
4. 验证顺序建议:join 快照渲染 → 心跳(服务端 monitor 侧可见)→ 作答判分 → ai_chunk 流式 → 教师 pause/resume/end 广播 → 断 Wi-Fi 10s 重连。

## B1 页面(保留)

- 登录页(三角色 Tab;管理员/教师 Tab 指引到 PC 端)
- 顶部胶囊 Tab 外壳 `pages/Shell.tsx`(激活 = primary 实底白字)

## 覆盖的验收项(B1)

- mock 模式输入登录码可进入工作台,4 个主 Tab 全部可点;`npm run build` 通过。
