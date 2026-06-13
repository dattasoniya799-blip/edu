# @qiming/student · 学生端(B1 脚手架 + B5 常规五页 + B6 课堂模式 + FIX3 走查修复,平板)

Vite + React18 + TS。按 **1180×820 横屏视口**设计(`src/Stage.tsx` 等比缩放适配),触控目标 ≥ 44px(`min-h-touch`)。

## 怎么跑

```bash
npm install          # 另需:packages/ui、packages/contracts 各自 npm install(源码直引)
npm run dev          # http://localhost:5175,默认 mock 模式(REST=msw;课堂 WS 假服务自动挂到 dev server)
npm run build
npm run test         # vitest(含 IMPL2 新增 student-login.spec:学号密码登录/错密 4010)
                     # 公式键盘组件测试在 packages/ui(FormulaKeypad.spec)
npm run test:mock    # msw/node 冒烟(同一份 handlers,含学号密码登录 + 作业全流程)
```

- **学生登录 = 学号 + 密码**(`/auth/student/login`,IMPL2 改:取代旧扫码/登录码):mock 学号 `S-0001…S-0012` + 统一演示密码 `Student@123`;`AuthProvider.loginWithPassword` 拿到 JWT 后照常存 token。已移除设备指纹 / 登录码相关 UI 与 mock。
- `VITE_USE_MOCK=false` 时代理到后端(`.env.example`);真实模式需后端实现 `/auth/student/login`(见根 README 后端对接假设)。

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

### 契约变更申请 B5-1(已落地 → 见下「C1GAP-front」)

学生侧原无可取题面的端点。该申请已于 2026-06-13 批准并落地为契约字段 `AttemptDto.questions: AttemptQuestionView[]`,答题器不再依赖私有降级形状,详见文末「C1GAP-front」。(`/student/courses/{id}/lessons` 的 `resources` 回看入口为另一申请,与本轮无关。)

## FIX3 · 学生端走查修复(平板横屏 1180×820)

### 问题4:填空题平板无法输入数学公式 → 公式按键面板(MVP)

平板软键盘打不出分数/根号/上下标,学生无法作答填空题。新增**屏幕公式按键面板**(K12 数学最通用、最低风险方案):

| 组件 | 位置 | 职责 |
|---|---|---|
| `FormulaKeypad` | `packages/ui/src/FormulaKeypad.tsx` | 纯展示的符号/模板键盘(模板:分数/根号/n 次根/上下标/绝对值/括号;运算:+−×÷=≠≤≥±≈;符号:π°%∞∠△;希腊:α β γ θ λ μ),点按经 `onInsert` 回传 LaTeX 片段;`insertSnippet` 纯函数处理光标落点(`‸` 标记)与选区包裹(选「12」按 √ → `\sqrt{12}`) |
| `MathInput` | `packages/ui/src/MathInput.tsx` | 受控输入框(键盘仍可直打简单答案 `y=2x+1`)+「公式」开关唤起面板 + `<TexText/>` 实时预览 |

填空题接入:`pages/homework/QuestionPanel.tsx` 的 `BlankInputs` 每空一个 `MathInput`,产出写入 `response.texts[i]`(契约 `texts[]` 字符串数组,口径不变)。所有键 ≥44px(`min-h-touch`+`min-w-[44px]`),`packages/ui/src/__tests__/FormulaKeypad.spec.tsx` 断言(36 例)。

**备选方案(交用户决策,本次只实现 ①)**:① 公式按键面板(已实现 MVP,零外部依赖、平板触控友好);② 手写识别(需 Mathpix/OCR 类服务,成本与延迟高,设计文档列为可选 v1.x);③ 拍照上传(同解答题,但填空题拍照难自动判分)。选 ① 因其无外部依赖、即时可判、与现有 `TexText`/`texts[]` 契约天然契合。

> ⚠️ **判分口径风险(待人工决策)**:公式面板产出 **LaTeX 串**(如 `\frac{1}{2}`),而后端 blank 判分(`apps/server` `normalizeBlank` + `judge`)是**纯文本归一化逐字相等**(去空格+全角转半角)。若标准答案存的是纯文本 `1/2` 或不同 LaTeX 写法(`\dfrac` vs `\frac`、`\sqrt{}` vs `√`),会判错。**前端只按现有 `texts[]` 契约产出,不擅自改判分**;是否让 blank 支持 LaTeX 等价判定属契约/A5 口径变更,见下「契约/口径变更申请 FIX3-2」。

### 问题5:错题本按学科分组/筛选

契约 `WrongBookItem` **无 `subject` 字段**。按「前端先按现有数据做、结构预留」实现:

- 纯逻辑 `pages/wrong/subjects.ts`:`WrongBookItemView`(契约外可选 `subject`)+ `deriveSubjects`/`isMultiSubject`/`filterBySubject`。
- `WrongBookPage`:学科与错因**两级筛选**(切学科重置错因);学科 ≥2 才显示学科筛选,**单科优雅退化为不显示**(对照原型单科口径);`WrongItemCard` 多学科时显示学科标(`subjectLabel`,单科不传 → 不显示)。
- mock 先行(同 B5-1 模式):`mocks/data.ts`/`student-store.ts` 给错题项附带 `subject`(取自题目 `subject`),契约落地即对齐。当前 seed 为数学单科 → 运行时学科筛选隐藏(正确 MVP 行为)。
- 测试:`pages/wrong/__tests__/subjects.spec.tsx`(派生/退化/筛选/学科标,7 例)。

### 契约/口径变更申请

- **FIX3-1(错题项带学科)**:`WrongBookItem` 增 `subject: string`(纯增量,源自题目学科),供错题本按学科分组/筛选。mock 已按此形状先行;若否决,前端单科退化为不显示学科筛选(现状已如此),功能无损。
- **FIX3-2(blank LaTeX 判分口径)**:公式输入产出 LaTeX 串,现 A5 blank 判分为纯文本归一化比对,二者可能对不上。建议后端 blank 支持「LaTeX 规范化/等价判定」(或约定填空答案统一以 LaTeX 存储并规范化),否则含公式的填空可能误判。**属判分口径变更,交人工决策**;前端不擅改判分。

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

## IMPL-front · 插图渲染 + 公式填空待批改 + 错题本学科(契约已落地 2026-06-13)

三项契约变更已批准并重新生成 SDK,本轮把学生端/课堂接成真功能。

### 处置
- **题目插图按 anchor 渲染**:新增 `@qiming/ui` 的 `QuestionFigures`(`selectFigures`/`hasFigureAt`),按 `figures[].anchor` 把图落到 题干/选项/解析/参考答案 各位置(缺省 anchor=题干);`QuestionPanel`(作业 + 课堂随堂练/大题共用)渲染题干、选项内联、解析插图,`ResultView` 渲染题干/参考答案/解析插图;`AttemptQuestionView.figures` 改为契约 `QuestionFigure[]`,题面经 `student-store` 原样下发。错题本同口径已就绪,但 `WrongBookItemDto` 无 figures 字段,错题卡暂不渲染插图(见遗留)。
- **公式填空作答反馈**:`student-store.isFormulaBlank`(参考答案含 LaTeX 控制符即判公式填空,与后端口径一致)→ `putAnswer` 返回 `isCorrect=null / judged=false`,交卷置 `submitted`(待教师复核),客观题分照常结算;`QuestionPanel` 的 `FeedbackPanel` 对 `judged=false` 的填空显示「已提交 · 待批改」(与解答题待批改同视觉),简单填空即时判分不变。前端不自判公式对错,一律以后端 `isCorrect` 为准。
- **错题本学科**:`WrongBookItemDto.subject` 已是契约正式字段;`pages/wrong/subjects.ts` 的 view 直接读真实字段(去掉「契约暂无」容错说明),mock 形状对齐;单科优雅退化(学科集合 ≤1 不渲染筛选)不变。

### mock 口径(`src/mocks/`)
- `data.ts`:部分题目挂 anchor 插图(qid 13 题干/选项 A/解析、qid 9 题干、qid 4 题干/rubric)用于自检;qid 7 改造为「含公式填空」(参考答案 `y=\dfrac{1}{2}x+1`),简单填空 qid 11 保持即时判分;新增自检卷(assignment id 3 / paper id 4:单选 + 简单填空 + 公式填空)演示混合判分;`wrongBook` 产出契约 `subject` 字段。
- `student-store.ts`:公式填空 `isCorrect=null` 待批改;交卷 `hasManualReview = 解答题 || 公式填空`。

### 测试 / 构建
- `packages/ui` `QuestionFigure.spec.tsx`(anchor 过滤 / ref 匹配 / 占位与 img 渲染);`pages/homework/__tests__/QuestionPanel.render.spec.tsx`(三处插图就位 + 公式填空「待批改」、简单填空「回答正确」);`mocks/__tests__/student-store.spec.ts`(isFormulaBlank、公式填空 judged=false/isCorrect=null、交卷 submitted、客观题分照常)。
- `npm run build` 绿;`npm run test` 95/95 绿;`npm run test:mock` 绿。

### 与后端对接假设
- figures 形状:`QuestionFigure = { ossKey, position, anchor?: { target: stem|option|analysis|reference|rubric, ref? } }`;ossKey 经 `QuestionFigures` 的 `resolveSrc` 解析为签名 URL(mock 无 URL → 占位框)。
- 公式填空:交卷后该空 `answer.isCorrect=null`(像解答题待批改),由 AI 预批 + 教师复核出分;检测规则由后端实现(参考答案含 LaTeX 即视为公式填空)。
- 遗留风险:错题本 / 课堂大题渲染口径已抽到同一 `QuestionFigures` 组件,但 `WrongBookItemDto` 无 figures 字段,错题卡当前不显示题目插图(契约未含,未自行扩展)。

## C1GAP-front · 答题器读 `attempt.questions`(契约已落地 2026-06-13·C1)

B5 期间题面缺口用私有降级形状(`pages/homework/types.ts`)兜底;本轮契约补齐 `AttemptDto.questions: AttemptQuestionView[]`,答题器改为直接读契约字段渲染。

### 处置
- `pages/homework/types.ts` 不再自定义题面 —— 转出契约 `AttemptQuestionView`,`AttemptWithQuestions` 退化为 `AttemptDto` 别名;`useAttempt`/`QuestionPanel`/`ResultView`/课堂随堂练共用此契约类型。
- `ResultView`:`correctAnswer` 现为契约 `QuestionAnswer` 对象(非字符串),新增 `formatCorrectAnswer` 格式化为可混排串再 `<TexText/>`。
- `HomeworkPage`:移除「题面字段缺失 → 降级错误态」逻辑(题面现由契约保证);`questions` 为空仅作**优雅空态**(「本卷暂无题目」),真实加载失败仍走错误态。
- **防作弊口径**:`correctAnswer/analysisLatex` 仅在该题已判定或交卷后(`status != 'in_progress'`)下发;作答中为 `null`,`QuestionPanel` 即时反馈只用单题 `SubmitAnswerResult.correctAnswer`(判错才下发),组件层不读题面 `correctAnswer`,天然不泄漏。

### mock 口径(`src/mocks/`)
- `student-store.toQuestionViews`:`correctAnswer` 改为下发契约 `QuestionAnswer` 对象(`q.answer`),`in_progress` 期间为 `null`(防作弊);`data.ts` seed `attempt` 题面由 store 派生(类型 `Omit<AttemptDto,'questions'>`)。

### 测试 / 构建
- `pages/homework/__tests__/ResultView.render.spec.tsx`(读 questions 渲染题干/正确答案/解析;`correctAnswer=null` 不泄漏)。
- 更新 `attempt-flow.spec.ts` / `student-store.spec.ts`:交卷后 `questions[].correctAnswer` 断言改为契约对象 `{ choice: 'B' }`;新增「作答中所有题 correctAnswer/analysisLatex 皆 null」断言。
- `npm run build` 绿;`npm run test` 100/100 绿;`npm run test:mock` 绿。

### 与后端对接假设
- `AttemptQuestionView.correctAnswer: QuestionAnswer | null`,后端按防作弊口径仅在已判/交卷后填充;单题即时判分仍走 `PUT .../answers/{qid}` 的 `SubmitAnswerResult.correctAnswer: string | null`(判错才下发)。两者口径不同(题面=对象、即时反馈=字符串)是契约约定,前端分别处理。
- 遗留风险:题面 `correctAnswer` 对象→展示串的格式化在前端(`formatCorrectAnswer`),若后端日后改为直接下发展示串需同步收敛。

## C2-front-redesign · 标准渲染器 + 三种解析展示 + 发布即进课堂

学生端涉及 #6(共享渲染器)/ #7(三种解析展示)/ #9(进课堂)。

### #6 标准 Markdown + LaTeX(共享 TexText)
- 全端题面/解析统一走 `packages/ui` 的 `TexText`(升级为标准 Markdown + 标准 LaTeX,详见 ui/teacher README)。学生端题面、错题、作答结果均自动生效。

### #7 三种解析展示(默认正常,可切换简单/详细)
- 共享组件 `packages/ui` 的 `AnalysisView`:默认显示**正常解析**,提供切换看**简单/详细**;「有哪个显示哪个,空的不显示」,单档时不出切换条,全空不渲染。
- 接入处:错题本 `pages/wrong/WrongItemCard.tsx`(展开「看解析」)与作答结果 `pages/homework/ResultView.tsx`(逐题解析)。
- **契约 gap**:`WrongBookItemDto` / `AttemptQuestionView` 当前仅 `analysisLatex`(正常解析);mock 已**前瞻下发** `analysisBriefLatex`/`analysisDetailLatex`(可选扩展字段,见 `mocks/data.ts`、`mocks/student-store.ts`),组件按可选字段读取——后端在这两个视图补齐两档后切换器即自动点亮,无前端改动。

### #9 学生进课堂:发布即可进
- 去掉「未到上课时间不可进」的前端拦截,改为**只要讲次已发布(ready / in_progress)即可进**;未发布(draft)与已结课(finished)不可进。判定纯函数 `pages/course/lib/entry.ts`(`canEnterClassroom`/`enterClassLabel`),接入讲次时间线 `pages/course/LessonTimeline.tsx`,今日页 `pages/today/TodayPage.tsx` 文案同步调整。单测 `pages/course/lib/__tests__/entry.spec.ts`。

### 与后端对接假设(C2)
- #9 要求「后端同步放开」:`apps/server` 不在本任务负责目录,mock 已按「发布即可进」放行(`/student/today` 对已发布讲次下发可用 sessionId);真实后端需放开课堂进入的时间校验,改以讲次发布状态为准。
- #7 三种解析在学生视图(错题/作答)依赖后端把 `analysisBriefLatex`/`analysisDetailLatex` 补进 `WrongBookItemDto`/`AttemptQuestionView`;契约本次仅给 `QuestionDto`/`QuestionInput`,故学生侧目前以 mock 预演,组件已就绪。
