# AI 生成课件(前端已切正式契约,后端并行实现中)

- 走查前置:`apps/teacher` 下 `npm run dev`(`.env.development` 已带 `VITE_USE_MOCK=true`),教师 `13800000002 / Teacher@123`。
- 入口 A:资源库右上「✦ AI 生成课件」→ `/courseware/new`(无上下文)。
- 入口 B:讲次编排页 → 某单元「讲解」槽「挂载课件」弹窗顶部「没有合适的课件?✦ AI 生成课件」→ 带 `?lessonId=&kpNodeId=`,页面顶部显示「将结合知识点…」提示。
- 三步走查:① 填名称 + 文字稿(如「勾股定理:由旗杆影长引入…」)+ 页数 + **选 PPT 风格**(6 张带缩略图的卡片,默认清爽学院蓝;选「自定义风格」需填风格描述)→ 「生成大纲」约 1.5 秒;② 逐页改标题/要点/画面描述,可上下移、删除、在任意位置插入 → 「确认并生成 N 页课件」;③ 进度页 2 秒轮询,mock 每 3 秒出一页(真实约 23 秒/页)。
- 失败态演示:**第 3 页固定失败一次** → 出现红色标记 +「重试失败页」→ 点后该页转成功,轮询继续到 `done`。
- 完成态:全部页缩略图可点开放大;「去资源库查看」能看到新课件(`type=ppt`、`meta.kind=ai_courseware`、`meta.pages`);从编排页进入时另有「返回编排课堂」。
- 页面图片是 mock 内联 SVG(`src/mocks/data.ts` 的 `slideImage`),**横版 1264×848**、配色版式随所选风格变(深色科技=深底浅字、瑞士网格=黑白直角、手绘=米纸马克笔…),不是真图,仅供版式走查。
- 进度可恢复:第 3 步会把 jobId 写进地址栏 `?job=`(保留 `lessonId/kpNodeId`),刷新或离开再回来直接续上轮询;任务不在了(mock 内存表刷新即失效,真实后端 Redis 存 24h)→ 404 4040 → 提示「任务已过期,请重新生成」并可一键回第 1 步。
- 契约已正式化(2026-08-22):报文类型一律从 `@qiming/contracts` 取(`CoursewareStyleInput` / `CoursewareOutlinePageDto` / `CoursewareJobPageDto` / `CoursewareJobDto`),原 `lib/types.ts` 已删;`lib/coursewareApi.ts` 走 `api.get/api.post` 类型化路径,无类型放宽。

## 真实链路提示词规范(给后端实现固化用,2026-08 实测口径)

- 每页最终提示词 = **风格前缀 + 该页完整内容 + 页码**,三段缺一不可;只给短语会得到「一页几个字」的废片。组装口径见 `lib/styles.ts` 的 `composePagePrompt`,后端入队时按同一函数实现。
- 风格系统:5 套内置 `academic_blue`(默认)/ `hand_sketch` / `vector_illust` / `dark_tech` / `swiss_grid`,外加 `custom`;**`lib/styles.ts` 是唯一事实**(模板改写自 JuneYaooo/gpt-image2-ppt-skills 与 ningzimu/codex-ppt-skill,MIT),后端实现时整份迁到服务端 `ai/config`,前端只传 `style.id` / `style.customText`。
- 自定义风格组装:`CUSTOM_GUARDRAIL`(横版教学幻灯片 + 标题要点层级 + 中文准确 + 讲解性配图 + 无水印)**在前**,教师原文**在后**,只准影响观感;描述为空时兜底回默认风格模板,接口侧同样拦 400。
- 该页完整内容:页标题 + **3~5 条完整句要点**(整句,约 18–36 字,别压缩成短语)+ 该页配图说明(画什么示意图、版式重点)。
- 页码:提示词结尾显式写 `页码:右下角标注「n/N」`,成品右下角才会有连续页码。
- 尺寸:**请求横版**(实测 `1536x1024` / `medium`)。中转会归一参数,实际返回 `1264x848` / `low`。
- 因此:**记账与落库一律按 API 响应里的实际 `size` / `quality` 字段,不得按请求参数假设**;前端展示比例也以实际返回尺寸为准(mock 的 `SLIDE_WIDTH/SLIDE_HEIGHT` 即取 1264×848)。
- 计时口径:实测单页约 23 秒,`lib/outline.ts` 的 `SECONDS_PER_PAGE=25` 用于向教师报预计耗时;mock 为走查方便压到 3 秒/页。
