# @qiming/teacher · 教师端(B1 脚手架 + B3 题库/录题编辑器 + B4 课程/编排/组卷/批改/监控)

Vite + React18 + TS,结构与 admin 端一致(`src/auth` + `src/api.ts` + `src/mocks` 全量 msw)。

## 怎么跑

```bash
npm install          # packages/ui 也需 npm install 一次(tsc 全量检查其源码,缺 react 类型会报错)
npm run dev          # http://localhost:5174,默认 mock 模式
npm run build
npm run test         # vitest 单测(B3 27 例 + B4 33 例)
npm run test:mock    # msw/node 冒烟(同一份 handlers,B3 录题 + B4 编排→发布→组卷→发布作业→批改全链路)
```

- mock 登录:教师 `13800000002 / Teacher@123`(真实模式同 seed 账号);`VITE_USE_MOCK=false` 时代理到 A1 后端(`.env.example`)。

## 页面

- 登录页(三角色 Tab,视觉=原型;学生 Tab 指引到平板端)
- Shell:浅色侧栏(教 学/学 生分组)+ topbar
- 工作台(我的课程 + 待复核统计,B4 接通课程卡入口)、**资源库 `/resources`**(FIX2 补齐,原型 t-res);学情分析(空壳占位)
- **题库维护 `/bank`**(B3,原型 t-bank)
- **录题编辑器 `/bank/new` `/bank/:id/edit`**(B3,原型 t-editor)
- **我的课程/编排/组卷/批改/监控**(B4,见下方 B4 小节)

## B3 · 题库 + LaTeX 录题编辑器

页面清单(`src/pages/bank/`):

| 文件 | 内容 |
| --- | --- |
| `BankList.tsx` | 题库列表:左侧图谱筛选树(图谱选择→年级→章节/节点,`/kp/graphs` `/kp/nodes`)+ 题目卡(TexText 题干、难度点、三维标签胶囊、状态)+ 搜索/题型/难度/状态筛选 + 分页;草稿卡可直接「入库」 |
| `EditorPage.tsx` | 录题编辑器:元信息栏(学段/学科/教材/章节/题型/难度 + 三维标注)、双栏源码/实时预览(9 个工具条插入片段同原型)、题干插图直传、题型联动(选项区 / 填空答案 / 参考答案+rubric 行编辑)、保存草稿 / 提交入库 |
| `components/TagPickerModal.tsx` | 三维标签选择器:弹层内按图谱分 Tab(教材知识点/解题能力/解题策略)勾选节点 |
| `lib/{snippets,transform,validate,upload}.ts` | 纯函数:快捷插入、表单↔QuestionInput 变换、草稿/入库两档校验、/uploads/sts 两步直传 |

验收项映射:

- 录入原型含图解答题 → 预览 → 提交 → 列表回显:`scripts/mock-smoke.mts` 跑通同一链路(sts 签发 → PUT 假端点 → POST /questions → publish → 列表/筛选命中);浏览器内即 `/bank/new` 全流程
- 公式语法错误红色提示:预览均经 `<TexText/>`(内置红色 mono 错误提示)
- rubric 必填校验(解答题)、tagNodeIds ≥1 教材知识点:`lib/validate.ts`(A3 同口径,前端先拦),vitest 覆盖
- 聚焦态(focus:border-primary)与快捷插入(光标处插入+焦点保持)可用;颜色全部来自 design-tokens(无裸色值)
- 每页空态(EmptyState)+ 加载骨架(Skeleton);`npm run build` 通过、vitest 27 例全绿

mock 说明:`src/mocks/` 中 `/questions*` 为**有状态** mock(POST/PUT/DELETE/publish 实改内存数据,刷新前列表可回显);`kpNodes` 的能力/策略维节点已对齐真实图谱全量(能力 41 / 策略 35,见 FIX2 小节),与 30 题的 tags 同口径;`/uploads/sts` 返回的预签名 uploadUrl 由 msw 的 PUT 假端点承接(契约形状同 A3)。

与原型的已知偏差(MVP 裁剪手册 1.1):共享库/「引用到我的题库」、「从 Word 导入」延后不做;左侧树不显示每节点题数(契约无该统计接口);「保存并录下一题」「自动保存」未做(任务卡范围仅保存草稿/提交入库)。

## 覆盖的验收项(B1)

- mock 模式可登录进入工作台,主导航 5 项全部可点;`npm run build` 通过;
- 题库页用真实 seed 口径题干验证 TexText 在浏览器内渲染。

## B4 · 课程/编排/组卷/批改/监控

六页清单(原型 v0.4 t-dash/t-course/t-lesson/t-paper/t-grade/t-monitor):

| 路由 | 文件 | 内容 |
| --- | --- | --- |
| `/`(工作台课程卡) | `pages/Dashboard.tsx`(B1 基础上加入口) | 课程卡补「讲次列表 / 编排课堂」按钮 → 讲次时间线;「待复核答卷」卡可点 → 批改 |
| `/courses` | `pages/course/CourseLessonsPage.tsx` | 讲次时间线:课程切换、rail 圆点 + 状态胶囊(已上课/下次上课/已就绪/未备课)、备课清单进度行、入口(编排/回放/批改/学情) |
| `/lessons/:id/arrange` | `pages/lesson/LessonArrangePage.tsx` | 编排:环节卡**上下移按钮**(替代拖拽)+ 时长编辑 + 挂课件(lecture)/挂卷(practice/homework)+ 添加环节;课堂 AI 设置(MVP 两开关:引导模式/卡住提醒,落 practice 环节 config);检查清单实时计算(口径=A4);发布 → **4201 弹缺失项弹窗**(detail=键数组),通过 → 讲次 ready |
| `/lessons/:id/paper` | `pages/paper/PaperBuilderPage.tsx` | 组卷:已选题列表(TexText 题干 + 分值编辑 + 实时总分)+ 题库选题弹窗(B3 题库同源数据,仅已入库题)+ 发布设置(名称/对象/截止时间);发布作业 = 保存卷(POST/PUT /papers)→ POST /assignments → 自动挂载 homework 环节 |
| `/grading` `/grading/:assignmentId` | `pages/grading/GradingHomePage.tsx` `GradingReviewPage.tsx` | 批改复核:待复核列表 → 学生切换条(pending/已复核 ✓)、作答原稿(照片或文字)、AI 逐步预批(rubric 对照 ✓/✕ + 错因标签)、改分+评语、确认下一份(自动跳到下一份 pending)、全部采纳 AI 分、出分(4501 时提示剩余份数) |
| `/lessons/:id/monitor` | `pages/monitor/MonitorPage.tsx` | 监控:mock `monitor:roster` 流驱动(每 5s 一帧),顶部四卡(环节进度/实时正确率/卡住提醒/AI 答疑)、学生卡片网格(**卡住红框**、举手橙标、离线置灰)、告警侧栏(monitor:alert 时间线) |

### monitor source 抽象(A6 联调替换点)

- `pages/monitor/source.ts`:页面只依赖 `MonitorSource { connect(handlers) → stop }` 接口;事件载荷类型直接取自 `@qiming/contracts` 的 `S2TEvents`(`monitor:roster` / `monitor:alert`),mock 帧由 `src/mocks/monitorStream.ts` 按 tick 确定性生成(单测逐字段断言与 ws-protocol.ts 一致)。
- A6 接入 = 在 `createMonitorSource()` 的真实分支返回 socket.io 实现(`io('/classroom', { auth: { token } })` + `socket.on('monitor:roster'|'monitor:alert', …)`),页面与 reducer 零改动。
- 不闪烁实现:`pages/monitor/lib/roster.ts` 的 `mergeRoster` 增量合并(未变化的学生沿用旧对象引用,全员无变化返回原数组)+ `memo` 学生卡 → 5s 刷新只重渲变化的卡片。

### 验收项映射

- **编排→发布→组卷→发布作业整条可走(mock 有状态,发布后讲次变 ready)**:`scripts/mock-smoke.mts` B4 段逐步断言(4201 缺失项 → 组卷 published/totalScore=Σ → assignment 创建 → 挂载后 checklist.homework=true → publish → `status=ready`);浏览器内即 第 4 讲编排 → 去题库组卷 → 发布作业 → 返回编排发布 的同一链路
- **批改页改分后列表状态变化**:复核确认后学生切换条出现「✓ 已复核」、剩余 pending 数下降(冒烟断言 4→3→0;`/grading/pending` 与 `/assignments/1/progress` 同步对账)
- **监控页 5s 刷新不闪烁**:`mergeRoster` 引用保持 + memo 卡片(`roster.spec.ts` 断言无变化返回原引用、单人变化只换该人引用)
- **发布校验提示 / 分值汇总 / roster 流 reducer 单测**:`lesson/lib/__tests__/segments.spec.ts`、`paper/lib/__tests__/paper.spec.ts`、`monitor/lib/__tests__/roster.spec.ts`(共 33 例)
- 每页空态 + 加载骨架(课程无讲次/未选题/无待复核/无告警等);颜色全部来自 design-tokens(mock 作答照片 SVG 不写任何色值,底色由页面 bg-card 提供)

### mock 口径(B4 扩充,均在 `src/mocks/`)

- `/lessons/:id/segments` PUT 全量替换并**同步重算 prep_checklist**;`/lessons/:id/publish` 按 A4 形状返回 `4201 + detail=缺失键数组`(修正了 B1 占位 mock 的 `{missing:[…]}` 包装与 422 状态码 → 数组 + 409),通过则 `status=ready`
- `/papers` POST 创建即 `published`、totalScore 服务端重算;被 assignment 引用的卷 PUT → `4302`(A4 口径)
- 批改链有状态:4 份解答题(answerId 41–44,许诺 7/周子航 3/林小满 7/郑一鸣 10,rubric 3+4+3)…review/adopt-ai 实改 finalScore,finalize 前有 pending → `4501 + detail=pendingAnswerIds`(A5 口径)
- 第 4 讲初始 `status=draft`(seed 落库为 ready 但与其 checklist.homework=false 互斥,按 A4 publish 语义取 draft 使状态跃迁可演示);其余口径同 seed(2 课程 6 讲次、第 3 讲批改链)

### 与原型的已知偏差(MVP 裁剪手册 1.1 + 契约口径)

- 编排:拖拽 → 上下移按钮;AI 设置 4 开关 → 2 开关(环节同步推进/平板锁定延后);「预览学生端」「从往期复制编排」延后
- 组卷:AI 组卷建议、定时发布延后(保留截止时间);组卷页选题用弹窗(与 B3 题库同源数据,不改 bank 页面行为)
- 监控:「介入辅导(推语音)」「回放时点切换」延后;工作台待办/上讲学情区块未做(不在 B4 任务卡范围)
- 讲次时间线:「+ 追加讲次」未做(契约无创建讲次端点)
- **契约缺口**:无「按作业列出主观题答卷」端点,批改页学生切换条经 `pages/grading/source.ts` 适配层枚举(mock 固定 answerId 41–44,详情仍走 `GET /grading/answers/{id}`);已提契约变更申请(建议新增 `GET /grading/assignments/{id}/answers`),端点落地后只改该文件

## FIX2 · 教师端 mock 走查三问题修复

| 问题 | 根因 | 处置 |
| --- | --- | --- |
| 1. 录题编辑器缺图片支持(选项/解析/参考答案插图) | **契约缺口**:`Question.figures` 仅 `{ossKey, position:int}`(position 是排序号,无「归属位置」语义,只能落在题干);`QuestionOption` 仅 `{label, contentLatex, isCorrect}`、`RubricStep` 仅 `{step, desc, score}`、`answer`/`analysisLatex` 均无图片字段 | 题干插图本就支持(`/uploads/sts` 两步直传)。选项/解析/参考答案处加「⛶ 插图」占位按钮,点击仅 toast 提示「待后端支持(FIX2-CR-01)」,**不伪造数据结构**;已提契约变更申请(见下) |
| 2. 三维标注能力/策略维节点不全 | mock 子集:`kpNodes` 旧版只塞了能力 4(201–204)/策略 3(301–303)个演示节点,真实图谱为能力 41 / 策略 35(`data/knowledge-graphs/*.json`、`IMPORT_REPORT.md`) | 由真实图谱 JSON 全量生成 `src/mocks/kpAbilityStrategyNodes.ts`(能力 id 201–241 / 策略 301–335,保留 `parentCode` 树形与 `summary`),灌入 `kpNodes`;`kpGraphs` 的 nodeCount 同步为 41/35;30 题的能力/策略 tag 改从全量叶子节点取,id/code/name 一致 |
| 3. 资源库打不开(显示占位) | **分工缝隙**:占位串来自旧 `App.tsx` 的 `<Placeholder … hint="B3 任务接 /resources">`;但 B3 负责目录仅 `pages/bank/`(题库),B4 为 course/lesson/paper/grading/monitor,`/resources`(A4 后端已实现)**无任何 B 轨任务卡认领** | 在 `pages/resources/` 新建资源库页(走 `createClient` + A4 `/resources` 契约形状):类型筛选 + 资源卡网格(封面/大小/页数·时长 meta + **usedByLessons 被引用讲次反查**)+ 上传(两步直传后 POST)+ 未引用资源可删 + 空态/骨架/分页;路由替换占位 |

页面/数据清单:`pages/resources/ResourcesPage.tsx`、`pages/resources/lib/resource.ts`(类型→标签/图标/色、大小与 meta 文案、usedByLessons 反查纯函数,`__tests__/resource.spec.ts` 6 例)、`src/mocks/kpAbilityStrategyNodes.ts`(自动生成,扩图谱时重跑生成脚本)。

### 契约变更申请 FIX2-CR-01(题目多位置插图,待人工拍板,**未自行改动 contracts/schema**)

- **现状**:`figures` 是 Question 级数组、`position` 为整数排序号,渲染约定「题干下方依序铺图」,无法表达「此图属于选项 B / 解析 / 参考答案 / rubric 步骤」。`QuestionOption`、`RubricStep`、`QuestionAnswer`、`analysisLatex` 均无图片字段。
- **应支持插图的完整位置清单**:① 题干(已支持)② 单选/多选**选项** ③ **解析** ④ 解答题**参考答案** ⑤ rubric **步骤说明**。
- **建议方案(择一,供仲裁)**:
  - 方案 A(最小改动,推荐):给 `figures[]` 增加可空 `anchor` 字段,形如 `{ ossKey, position, anchor?: { target: 'stem'|'option'|'analysis'|'reference'|'rubric', ref?: string } }`(`ref`=选项 label 或 rubric step),不新增表、`question_options`/`rubric` 结构不动;前端按 anchor 把图渲到对应位置。
  - 方案 B:`QuestionOption` 增 `figureOssKey String?`、`analysisLatex` 旁增 `analysisFigures Json`、`RubricStep` 增 `figureOssKey?`——字段直观但改动面更大(schema 多列 + DTO 多处)。
- **影响任务**:A3(题库 schema/DTO/校验/无损读写)、B3(编辑器补对应插图 UI 与直传)、A5/B5(学生端题目渲染需消费新字段)、A6/B6(课堂题目展示)。
- **前端现状**:占位按钮已就位,契约落地前不写入任何数据;落地后仅在 `EditorPage.tsx` + 渲染处接字段,占位替换为真实直传。

## IMPL-front · 题目插图 anchor + 公式填空复核接线(契约已落地 2026-06-13)

FIX2-CR-01 的「方案 A」已批准并重新生成 SDK(`QuestionFigure.anchor?: { target: stem|option|analysis|reference|rubric, ref? }`),本轮把教师端从占位接成真功能。

### 处置
- **录题编辑器多位置插图**(`pages/bank/EditorPage.tsx`):删除 FIX2 的「待后端支持」占位按钮,改为 `FigureAnchorControl`——选项行 / 参考答案头 / 评分要点每步 / 解析头各一个「⛶ 插图」,点击走与题干同款两步直传(`/uploads/sts` → PUT,`lib/upload.ts`),成功后把 `{ ossKey, position, anchor:{target, ref} }` 写入 `form.figures`(option/rubric 带 `ref`=选项 label / step),带缩略图预览 + 删除;题干插图保持原样(anchor 缺省=stem,写库时省略以向后兼容)。`lib/transform.ts` 的 `FigureItem`/`formToInput`/`questionToForm` 同步带 anchor 无损往返。
- **主观题复核扩到公式填空**(`pages/grading/GradingReviewPage.tsx`):公式填空(参考答案含 LaTeX)与解答题同管线进待复核列表;`textResponse` 改用 `<TexText/>` 混排渲染(`$..$` 公式),复核界面(AI 预批 / 改分 / 评语)与解答题一致;页面措辞由「解答题复核」改为「主观题复核(解答题 / 公式填空)」。

### mock 口径(`src/mocks/data.ts`)
- `WrongBookItem` 已含契约正式字段 `subject`(源自题目学科)。
- `gradingAnswers` 中 answerId 44 改为公式填空待复核样例(LaTeX 作答 `$y=\dfrac{1}{2}x+1$`,单步 rubric 5 分),验证 TexText 渲染与改分;`/grading/pending` 待复核计数维持 4(冒烟口径不变)。

### 测试 / 构建
- `pages/bank/lib/__tests__/transform.spec.ts`:新增 anchor 往返用例(非题干 anchor 保留、题干 anchor 省略、回填原样)。
- `npm run build` 绿;`npm run test` 68/68 绿;`npm run test:mock` 绿。

### 与后端对接假设
- figures 形状:`QuestionFigure = { ossKey, position, anchor?: { target, ref? } }`;缺省 anchor=题干。渲染统一走 `@qiming/ui` 的 `QuestionFigures`(ossKey 经 `resolveSrc` 解析为签名 URL;mock 无 URL 时降级占位框)。
- 遗留:`GradingItemDto` 无 figures 字段,复核页暂不渲染题目插图(仅题面 LaTeX);`/grading/assignments/{id}/answers` 列举端点仍缺(沿用 `pages/grading/source.ts` 适配层)。
