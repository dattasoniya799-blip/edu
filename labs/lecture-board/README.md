# 讲题白板 · lab 原型(2026-09-17 立项;当日迁入 qiming/labs/lecture-board)

> **在验证什么**:给 AI 一道题的截图 + 答案,AI 自动规划并在 HyperKnow 式白板上把题讲完(旁白 + 板书 + 公式 + 配图 + 动画),效果能否达到"可以给学生看"。验收通过后再按 `_lab/讲题PPT/讲题白板-整体方案-2026-09-17.md` §八 适配进 qiming;这里的代码不进 git、不碰 qiming。
> 上位方案:`../讲题PPT/讲题白板-整体方案-2026-09-17.md`;内容纪律沿用 `../讲题PPT/讲解件-*.md`。

## 需求(2026-09-17 与用户逐条确认)

| 项 | 定稿 |
|---|---|
| 输入 | 题目截图 1–3 张(含题图)+ 答案文本;题干文字可选补充 |
| 自动程度 | **全自动**:上传后一路到白板开讲;规划过程只展示进度(识题 → 规划 → 出剧本 → 素材),不要人确认、不可编辑 |
| 开讲时机 | 剧本就绪即开讲;配图 / 音频后台并行,没到就骨架占位 |
| 讲课模型 | `qwen3.8-flash`(百炼,识题思考开、出剧本思考关);key 复用 `~/.config/edu/bailian.env` |
| 生图 | **`doubao-seedream-5-0-260128`,2K**(不换 4.0);key 复用 qiming `.env` 的 `IMAGE_API_KEY`;情境图每题 ≤ 2 张,几何/函数图禁止生图,图内不放文字 |
| 语音 | CosyVoice `cosyvoice-v3-flash` / `longxiaochun_v3`,句级预渲染;公式 tex + speech 双轨,speech 由 LLM 写、转换器校验兜底 |
| 动画 | 六个现有模板做动画卡(主力)+ 无模板题走 LLM 生成通用 HTML(沙箱 + 三道校验 + 静态降级) |
| 白板 | 一列一阶段(审题 / 第(n)问 / 总结 / 动手);卡片 9 种;红圈标注;表格;KaTeX;右栏旁白流按动作分段;暂停 / 回看 / 跳步 / 语速 |
| 画布底座 | **Excalidraw**(MIT,10:12 拍板;HyperKnow 同款):卡片走 `embeddable + renderEmbeddable`,手绘图元与 Xiaolai 字体原生;卡片组件与画布层分离,将来可换底座。对比过 React Flow(轻但不能画)与 tldraw(最强但商用年费),见 protocol.md「画布底座」 |
| 学生提问 | 第一轮不做,输入框不放 |
| 第一轮不做 | 导出单文件 HTML、学情、多页、知识点模式 |
| 验收题 | 现有三道真题:圆与圆周角 / 浮力与浮沉(潜艇) / 平行四边形与对角线 |

## 验收标准

1. 三道题各上传一次,**不做任何人工干预**,白板讲完全程零报错(控制台 + 服务端日志);节拍四段齐全。
2. 旁白说到的每个结论 / 数值,白板上同步有对应板书或高亮(语义校验器 + 人工抽看)。
3. 含公式的旁白抽听 20 句,无 LaTeX 记号、无误读。
4. 浮力题出情境图 ≥ 1 张且开讲不等图;圆 / 平四走几何模板动画;每题动画卡至少 1 张、可暂停可回看。
5. 从点「开始」到白板开讲 ≤ 2 分钟(识题 + 出剧本);单题总讲解时长 3–8 分钟。
6. 用户看完三题说"可以给学生看"。

## 目录与分工(2026-09-17 开工)

```
labs/lecture-board/
  README.md                 本文:需求 / 验收 / 分工 / 结论
  题目/                     三道验收题:题目截图 + 答案.md(圆与圆周角 / 正方形旋转 / 浮力潜艇)
  shared/                   契约(协调会话冻结,两侧只读):schema.ts · protocol.md · sample-buoyancy.json
  server/                   子智能体 A:Fastify + SSE;识题 → 规划 → 剧本 → 素材并行(Qwen / Seedream / CosyVoice / 动画校验)
  web/                      子智能体 B:Vite React 白板播放器(列/卡/KaTeX/红圈/图占位/动画卡/旁白流/控件)
  package.json              根:concurrently 起两端(server :4310,web :4311)
```

来源代码(复制改造,不跨仓库 import):
- 识题 / 出剧本 / 校验 / TTS / 朗读规范化:`ohmyppt-lecture/src/main/lecture/`(纯 TS 核心,端口注入)
- 六个动画模板与运行时:`ohmyppt-lecture/resources/lecture-scene/{runtime,templates}`
- 白板 UI(卡片 / 主题 / 列布局):`_research/OpenHyperKnow/frontend/src/components/board/`、`pages/WhiteboardPage.tsx`
- Seedream 调用形状:`qiming/apps/server/src/ai/llm/providers/ark-image.provider.ts`

检查点(每个都能开浏览器看):
1. 骨架:上传浮力题 → 识题 → v2 剧本 → 白板列/卡静默逐步浮现(web 先用 `shared/sample-buoyancy.json` 独立开发)
2. 有声有公式:TTS + KaTeX/speech + 红圈 + 表格,三题连播
3. 图 + 动画:Seedream 情境图占位替换、模板动画卡、通用 HTML 动画兜底 → 三题验收

并行调研(子智能体 C):GitHub 上有没有中学数理化**成套**的开源 HTML 交互动画/仿真,可下载作参考或直接嵌入,减少 LLM 现场生成 HTML;结论写 `_research/中学数理化HTML动画资源调研-2026-09-17.md`。

## 怎么跑

```
cd labs/lecture-board && npm install && npm run install:all && npm run dev   # server :4310 + web :4311,浏览器开 http://localhost:4311
```
密钥:百炼 `~/.config/edu/bailian.env`(`DASHSCOPE_API_KEY`);Seedream 读 `qiming/apps/server/.env` 的 `IMAGE_API_KEY`。都不复制进本目录。

## 外部动画素材调研结论(2026-09-17,详见 `_research/中学数理化HTML动画资源调研-2026-09-17.md`)

- 值得建「策划库 + 参数」而不是下载 HTML 直接用:光学题一律走 ray-optics(Apache-2.0,场景即 JSON,可 headless 渲染);PhET 只能当动手卡(发布件无状态注入 API,`flow.anim` 不得指向它;商用口径冲突,上线前须确权);shuxueshuo 借其 `STEPS{t,derive,box}` 声明式形状约束出剧本。
- **本 lab 三道题都用不上外部素材**:数学开源 sim 约等于零,PhET buoyancy 无中文且不可驱动——圆/正方形旋转走自研模板 + LLM HTML,浮力走现有 buoyancy 模板。初中化学是空白,后续自研「装置元件 + 粒子层」双层模板。
- 待回写协议(P2 再做):策划库动画的壳会超过 html 动画 ≤ 30 KB / 禁 `<script src=` 的限制,应单开一条只走运行校验的通道。

## 现状(2026-09-17 17:00)

- 三道验收题 + 四道网上取的中考题(泸州一元二次方程应用 / 北京一次函数不等式 / 滑轮组机械效率 / 并联电路电功率)全部**零人工干预**从上传到讲完;后四道走的是真实上传接口 `POST /api/lessons`,开讲前 85–112 s,校验零 error。
- 已具备:审题逐条讲(题干数据亮起、隐含条件圈出、四块分析随讲随现)、讲到哪亮到哪(`say.ref` + 自动锚点、`emph` 留黄底/红圈)、KaTeX + speech 双轨、模板动画卡 + LLM 生成 HTML 动画(沙箱三道校验、静态降级)、Seedream 情境图占位替换、CosyVoice 句级预渲染、暂停/跳步/回看/语速、总结四色块、动手解锁。
- 门禁:server 149 单测、web 86 单测、两侧 typecheck 绿;浏览器 1600×950 无头走查三题零报错。
- 已知待改(**2026-09-17 运行问题复查已修复前三条,见下方新增章节**):LLM 生成的 HTML 动画常把画面画得偏小(canvas 未按卡片尺寸自适应);动画卡上展示了 `purpose` 里的动作名列表(应只给学生看一句话);「百分之百」被数字化成「百分之 100」;审题步常 10–14 句略超纪律的 5–9 句(软告警,本次复查未处理)。
- 待用户验收第 6 条(「可以给学生看」)后,按 `_lab/讲题PPT/讲题白板-整体方案-2026-09-17.md` §八 走 P0(核心迁入 NestJS、契约申请)。

## 怎么在仓库里跑

```
cd labs/lecture-board && npm run install:all && npm run dev   # server :4310 + web :4311
```
密钥:百炼 `~/.config/edu/bailian.env`(`DASHSCOPE_API_KEY`,可用 `LECTURE_BAILIAN_ENV` 指别处);Seedream 自动读 `apps/server/.env` 的 `IMAGE_API_KEY`(可用 `LECTURE_SEEDREAM_ENV` 指别处)。生成产物在 `server/data/`(gitignore)。管理员端「实验室 → 讲题白板」卡片链到 :4311。

## 运行问题复查(2026-09-17)

一次系统性复查:「已知待改」三条逐一修复(server 提示词 + 校验器 + web 兜底三层),再逐项复查连接恢复 / 错误路径 / 安全 / 播放器 / 资源 / 日志。原则:优先用现有 20+ 课真实产物、单测、假端口/假 ChatPort 注入验证;真接口全程只用了 **2 次**(1 次单独验证 html 动画生成提示词改动;1 次因为手工验证 `from-sample` 路径穿越修复时误触发了一次真实上传,被新加的「重启清理」逻辑在服务重载时自动标成了 `failed`,没有跑满,但恰好反过来验证了那条修复)。修复后 server 219 个单测(原 168)、web 124 个(原 104)全绿,两侧 `typecheck` 绿。

### 已知待改三条(逐层修)

| # | 现象 | 严重度 | 根因 | 处理 |
|---|---|---|---|---|
| 1 | LLM 生成的 HTML 动画画面偏小,内容缩在卡片左上角一小块 | P1 | 三层叠加:①`animation.ts` 的系统提示词只说「画布自适应」,没有禁止写死小分辨率常量与绝对像素坐标;②`animation-html.ts` 静态校验没检查画布会不会随容器 resize;③web `AnimationCard` 的 iframe 高度写死 280px,`srcDoc` 没有兜底 CSS,某些旧动画的 `canvas{width:100%;height:auto}` 与卡片实际高宽比不完全一致 | **已修(三层都改)**:`server/src/assets/animation.ts` 的 `HTML_SYSTEM_PROMPT` 明确要求 canvas/svg 用 `ResizeObserver` 按容器实际尺寸重算分辨率与 DPR、坐标按 w/h 比例算、留白 ≤8%,给了完整代码骨架;`server/src/assets/animation-html.ts` 新增 `checkCanvasSizing()`,canvas/svg 写死像素尺寸又没有任何 resize 处理代码就打回重生成(单测 5 个);web `lib/html-anim.ts` 的 `animIframeHeight()` 按卡宽 16:10 动态算高度(不再是写死的 280),`withBaseCss()` 在 `srcDoc` 前注入 `!important` 基础 CSS 强制 `html/body/canvas/svg` 撑满 iframe。用现有 lesson 的 4 个真实 html 动画(正方形旋转 ×2、滑轮组、并联电路)在 Playwright 里量了注入前后画布对 iframe 的填充比例:0.766~1.0 → 0.772~1.0,零回归、零新增报错(`web/scripts/verify-anim-css-fix.mjs`,截图见 `web/shots/anim-fix-*.png`)。另花 1 次真接口用改过的提示词对滑轮组题重新生成一次动画(`server/scripts/verify-html-anim-real.ts`):三道校验(含新的画布尺寸检查)全过,构图比旧样本略好但仍未完全填满画布——**LLM 对「内容占满 90% 画布」这条指令遵循不完美,是构图问题不是画布尺寸问题,CSS 层面已经无法再修**,记为下面 P2 建议;已落盘的 20+ 道老课不重新生成(不为了这条再花真接口预算)。 |
| 2 | 动画卡上把 `purpose` 展示成了「演示…动作名:rotate(旋转), showPerp(显示垂直)」这种实现细节列表 | P1 | `prompt-board.ts` 原 E3 明确要求「在 purpose 里说明每个动作各演示什么」,直接诱导模型把动作名列表写进这个学生要看的字段;而 html 动画生成时用到的动作名其实是从 `flow` 里的 `anim.action.name` 反查出来的(`usedActionNames()`),purpose 根本不需要背这个信息 | **已修**:`prompt-board.ts` E3 改成「purpose 只写给学生看的一句话,≤40 字,不要列动作名/参数」;`validate.ts` 新增 `sanitizePurpose()`,按「动作名/动作包括/参数」触发词把后面的实现细节截掉并告警(单测 5 个 + `normalizeBoardScript` 集成用例);`web/src/lib/purpose.ts` 用同一套截断逻辑,在 `AnimationCard`/`Cards.tsx`(动手环节文案)渲染时兜底处理——**这条是给已经落盘的 20+ 道老课用的**,它们的 purpose 已经把动作名写死存进 `state.json`,没法回头重新调模型改写。真实截图验证(`web/scripts/shots-real.mjs` → `shots/real-05-正方形-html动画.png`):正方形题动画卡下面从「动作包括:startRotate(…)」变成一句「演示等腰直角三角形绕正方形顶点 A 逆时针旋转的过程,展示边长不变性及特定角度下的垂直关系」。 |
| 3 | `tex-to-speech`/`spoken-text` 把「百分之百」数字化成了「百分之 100」 | P2 | `spoken-text.ts` 的中文数字转换器把「百分之」整体保护后,「百」本身又被当成一个合法的中文数字(百=100)解析,「百分之百」被拆成「百分之」+「百(=100)」;实测复查用户列的其余惯用语(一半/一样/一下/一些/二次函数/三角形/四边形/一元二次/第一问)**其实已经被现有的 `NUM_UNITS` 白名单机制(故意不收「角/边/次/样/下/些」等量词)护住,没有被误伤** | **已修**:`spoken-text.ts` 新增显式成语白名单(`IDIOM_WHITELIST`:百分之百、一半、一样、一下、一些、二次函数、一次函数、一元二次、三角形/四边形/五边形/六边形/八边形/多边形),转换前用占位符整体保护、转换后还原,不受数字化规则影响;正常用法(「百分之八十」→「百分之 80」)不受影响。单测 7 个覆盖全部列出的用例 + 幂等性 + 不误伤正常场景。 |

### 复查发现并修复的问题

| 现象 | 严重度 | 根因 | 处理 |
|---|---|---|---|
| server 重启(`tsx watch` 重载,或直接被杀)时正在跑的 lesson 永远卡在 `recognizing`/`planning`/… | P1 | `main.ts` 启动时没有任何逻辑清理上次进程留下的半成品 `state.json`;流水线 Promise 跟着进程一起消失,没人再推进它 | **已修**:`store.ts` 新增 `reapInterruptedLessons()`,启动时扫一遍 `data/lessons/`,把所有非终态(不是 `ready`/`failed`)的课标成 `failed`,原因写清「服务在「X」阶段重启,流水线没跑完,请重新上传」。`main.ts` 启动时调用并打日志。单测 4 个;**真实验证**:任务过程中一次误触发的真实上传(`20260917-135827-ao08`,滑轮组题)在 `planning` 阶段因代码改动触发 `tsx watch` 重载被中断,重启后确认它被正确标成了 `failed` 并带上了这条原因,行为与预期一致。 |
| `POST /api/lessons/from-sample/:dir` 的 `dir` 没有白名单校验,能拼出 `题目/` 目录之外的路径 | P1(安全) | `samples.ts` 的 `loadSampleInput()` 直接 `join(SAMPLES_ROOT, dir)`,没检查穿越;对运行中的服务器实测 `dir=../../../server/src` 确实能把 `full` 解析到仓库里的 `server/src` 目录(只是因为那里没有一个恰好叫「题目.png」的文件才没有进一步暴露内容) | **已修**:`samples.ts` 新增 `resolveSampleDir()`,拒绝含 `/`、`\`、`..` 的 `dir`,解析后的绝对路径必须真的落在 `SAMPLES_ROOT` 内部才放行,`loadSampleInput()` 改用它。单测 6 个(含端到端穿越 payload);对运行中的服务器复测同一个穿越 payload,修复前能拼到 `server/src`(仅因文件名不匹配才没有数据泄漏),修复后统一 404。 |
| 上传图片只按文件名后缀判断类型(`.png`/`.jpg`/`.webp`),不看文件内容 | P2(安全) | `main.ts` 原逻辑只看 `part.filename` 的后缀;把任意文件(脚本、文本)改名成 `.png` 上传会被原样接收,原样送进 Qwen 的 `image_url` 里 | **已修**:新增 `server/src/upload.ts` 的 `sniffImageExt()`,按 PNG(`89 50 4E 47…`)/JPEG(`FF D8 FF`)/WEBP(`RIFF….WEBP`)文件头字节判断类型,`main.ts` 改用魔数结果决定收不收、存成什么后缀,不再信任文件名。单测 6 个;对运行中的服务器实测:文本文件改名 `fake.png` 上传,修复前会被受理,修复后返回 400「文件内容不是可识别的图片」。 |
| SSE 连接在 lesson 到终态(讲完 / 失败)之后不会自动释放 | P2 | `web/src/lib/api.ts` 的 `connectEvents()` 只在组件卸载(离开这个 lesson 页)时才 `close()`;用户看完课留在结果页不走,或者重连到一节早就失败的课(`snapshot` 里 `stage` 已经是 `failed`,而流水线失败时从来不发 `complete`,只发 `error`),连接会一直挂着,server 那边的 15s 心跳定时器与 `listeners` 订阅也跟着不释放 | **已修**:`connectEvents()` 收到 `complete`/`error` 事件,或者 `snapshot` 里 `state.stage` 已经是 `ready`/`failed`,就自动关闭当前 `EventSource`(手动 `close()` 路径不受影响)。客户端一关,server 侧 `request.raw.on('close', …)` 也会跟着清理心跳定时器与订阅。单测 6 个覆盖全部终态场景。 |

### 复查确认没有问题(不需要改动)

| 项 | 结论 |
|---|---|
| `/assets/:lessonId/*` 与 `/samples/*` 静态托管的路径穿越 | `@fastify/static` 默认防护生效。对运行中的服务器发送 `..%2f`/`%2e%2e%2f` 等编码穿越 payload,一律 403/404,没有信息泄漏。 |
| html 动画 iframe 的 `sandbox` 属性 | 只有 `sandbox="allow-scripts"`,没有 `allow-same-origin`,动画代码拿不到父页面 DOM/Cookie,是最小权限设置,不需要改。 |
| Qwen 返回非 JSON / 请求超时 | 用假 `ChatPort` 注入验证(`generate.test.ts` 8 个、`recognize.test.ts` 7 个):非 JSON / 结构不对会触发一次修复轮,两次都不行给出清楚的错误信息;超时这类不可重试的错误直接冒泡,由 `pipeline.ts` 的 `failLesson` 兜底,既不会被吞掉也不会死循环重试。 |
| Seedream 失败 / CosyVoice 失败 | 代码审查 + 单测确认隔离生效:`pipeline.ts` 对每张情境图、`assets/audio.ts` 对每一句语音都单独 `try/catch`,只把那一项标 `failed`,不阻塞流水线剩下的部分。新增 `audio.test.ts`(3 个,假 `TtsPort` 注入:部分失败/全部失败/`close()` 收尾都覆盖)。 |
| 没有密钥时服务还能不能看旧课 | 能。`GET /api/lessons/:id` 只读本地 `state.json`,完全不触发任何 key 读取;对运行中的服务器实测确认。 |
| 一次多道题并行时是否有共享变量串号 | 复查确认没有:`grep` 全部 `server/src` 找不到任何模块级(顶层)可变状态;`createBailianCosyVoicePort()` 按 lesson 现场创建而非全局单例;`store.ts` 的内存 Map 都按 `lessonId` 隔离。 |
| `log.ndjson` 是否够排障 / key 是否外泄 | 结构化记录 prompt 摘要 + response 原文 + 错误,足够排障。grep 了全部 `catch`/`emit`/`reply.send`/`note` 路径,错误信息拼接一律经过 `redact()`,没找到绕过的地方。 |
| 课生成中刷新页面 / 4 道题并行 | 代码审查确认没问题:`runPipeline` 是进程内后台任务,与具体某次 HTTP 请求/SSE 连接完全解耦,刷新页面只是重新 `GET` 一次状态 + 重连 SSE(拿到最新 `snapshot`),不影响后台流水线;第 3 题浮力/圆/正方形/滑轮组等已有的真实并行产物也没有互相串号的痕迹。 |
| 移动端 / 窗口 resize 不崩 | 对一节真实已完成的课(潜艇模型)做 Playwright 验证:桌面宽屏 → 平板横竖屏 → 手机竖横屏 → 回桌面,连续 resize 6 次,画布始终存活、控制台零报错(`web/scripts/verify-resize.mjs`)。 |
| 暂停时动画是否也停 | template 动画:`LessonPage.tsx` 暂停时调 `setSceneClockPaused(true)`,`scene-base.js` 的 `Clock` 暂停,确认已生效。html 动画沒有 `lecture:pause` 这个消息类型(见下面「未修」表的建议)。 |

### 没修的(按严重度)

| # | 现象 | 严重度 | 说明/建议 |
|---|---|---|---|
| 1 | LLM 生成 html 动画时,即使按新提示词要求「坐标按比例算、留白 ≤8%」,构图利用率仍不完美(真实验证:滑轮组题重新生成后仍有明显留白) | P2 | LLM 对构图类指令的遵循程度有限,CSS/校验器层面已经做到能做的(强制画布撑满容器);进一步改善需要更强的示例/少样本,或者生成后再加一道「按内容实际 bounding box 自动居中放大」的后处理步骤,超出本次复查范围,留给下一轮迭代。 |
| 2 | html 动画协议里没有 `lecture:pause`/`lecture:resume` 消息,暂停时沙箱 iframe 内部的 `requestAnimationFrame` 循环不会收到暂停信号 | P3 | 每个 `do()` 动作按提示词设计是「单次 ≤2 秒」的短动画,不是持续循环,实际影响很小;建议 `protocol.md` 补一条 `lecture:pause`/`lecture:resume`,html 动画收到后自行决定怎么响应(多数场景可以什么都不做)。 |
| 3 | Web Speech 语速切换对正在播的句子不生效(`speechSynthesis` 的 `utterance.rate` 创建后不可变) | P3 | 浏览器原生 API 限制,不是代码 bug;预渲染的 `<audio>` clip 走 `playbackRate`,语速切换对它是实时生效的,只有回退到 Web Speech 的句子(clip 还没到/文本不一致)才有这个限制。 |
| 4 | 审题列题干很长时(如正方形旋转题)开讲前初始缩放偏小(~47%) | P3 | `web/README.md`「已知问题」7 已经记录过这条既定折中(缩放下限 0.4,进入解题列后自动回到 ≥0.62);本次复查确认这是有意为之的权衡,没有再改。 |
| 5 | 每列卡片数没有上限/分页,长列一直往下长 | P3 | `web/README.md`「已知问题」6 已经记录;方案 §十提到「每列 ≤6 卡自动开新页」第一轮没做,本次复查没有新增改动。 |
| 6 | `server/data` 没有留存策略,只会一直增长(现在 20+ 课约 21 MB) | P3(运营建议) | 建议加一个按时间或条数清理的脚本/cron(比如只保留最近 N 天或最近 M 课),不属于代码缺陷,本次没有实现。 |
| 7 | `Animation.kind='template'` 挂了两张卡、`fx:'highlight'` 等历史契约缺口 | P3 | 已经记在 `shared/ISSUES.md` 与两侧 README「已知问题」里,本次复查确认现有兜底(自动去重卡 / 归一成 pulse)仍然有效,没有新发现,不重复记录。 |

### 真接口使用记录

| # | 用途 | 花费估算 | 结果 |
|---|---|---|---|
| 1 | 用改过的 `HTML_SYSTEM_PROMPT`(动画画面偏小修复)对滑轮组题现场生成一次动画 HTML(纯文字,不含图 / TTS) | 远低于整题 ¥0.5(仅 2 次文本 chat 调用) | 三道校验(含新的画布尺寸检查)全过;构图利用率略有改善但不完美,见上表「没修的」#1 |
| 2 | 手工验证 `from-sample` 路径穿越修复时,误将真实的合法 `dir` 参数发给了运行中的服务器,触发了一次真实的完整上传流水线(圆与圆周角题) | 部分花费(识题 + 部分规划,被中途打断) | 意外验证了「server 重启清理」那条修复:该 lesson 在 `planning` 阶段因为代码改动触发 `tsx watch` 重载被打断,重启后被正确标成 `failed` 并带上清楚的原因 |

两次合计,在「整个任务里真跑不超过 3 次」的预算内。
