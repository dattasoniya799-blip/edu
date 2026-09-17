# 讲题白板 · server

题目截图 + 答案 → 识题 → 规划 → BoardScript v2 剧本 → 情境图 / 动画 / 语音并行 → 白板可以开讲。

契约在 `../shared/`(`schema.ts` 剧本形状、`protocol.md` 端点与事件),两侧只读;实现过程中发现的契约缺口与临时口径记在 `../shared/ISSUES.md`。

## 怎么跑

```bash
cd labs/lecture-board/server
npm install
npx playwright install chromium     # html 动画的无头校验要用

npm run dev          # HTTP + SSE,:4310
npm test             # 97 个单测,不打真接口
npm run typecheck
```

密钥不在本目录,进程启动时从下面两处读,只留在内存里,不写进 `state.json` / `log.ndjson` / 任何错误信息(统一过 `config.ts` 的 `redact()`):

| 用途 | 来源 | 变量 |
|---|---|---|
| Qwen + CosyVoice | `~/.config/edu/bailian.env` | `DASHSCOPE_API_KEY` |
| Seedream 生图 | `qiming/apps/server/.env` | `IMAGE_API_KEY` |

`GET /api/health` 会回 `{ ok, bailian, seedream }`,两个布尔就是「key 读到没有」。

### 不起 HTTP,直接跑一道题

```bash
npm run run-problem -- 题目/03-浮力潜艇
npm run run-problem -- /绝对路径/某个题目目录
```

题目目录里要有 1–3 张 `*.png|jpg|webp` 和一份 `答案.md`。跑完在终端打印各阶段耗时、校验 errors/warnings、剧本规模,产物照常落 `data/lessons/<id>/`。

## 目录

```
src/
  main.ts               Fastify:REST + SSE + /assets 静态
  pipeline.ts           流水线编排(阶段事件、素材并行、失败隔离)
  store.ts              LessonState 落盘 · SSE 订阅 · log.ndjson
  config.ts             密钥读取 · 路径 · 超时 · redact
  ports.ts              ChatPort / TtsPort / ImagePort 接口
  openai-compat-chat.ts 百炼 OpenAI 兼容端点(多模态 + enable_thinking + json_object)
  recognize.ts          识题:图 + 答案 → 要点卡(复用 ohmyppt-lecture 的做法)
  prompt-board.ts       出剧本提示词(A–G 七组硬纪律)
  generate.ts           规划调用 + 校验 + 一次修复轮 + salvage
  validate.ts           BoardScript v2 校验器(errors / warnings 两档)
  tex-to-speech.ts      确定性 LaTeX → 中文口语(兜底 + 参照校验)
  audio-keys.ts         音频 key 与口播文本(protocol 口径)
  templates.ts          读 manifest,解析参数范围与 run 相位
  data/templates-manifest.json   六模板 + board-steps(复制自 lecture-scene)
  assets/
    seedream.ts         情境图(风格前缀 · 2K · sha1 缓存)
    animation.ts        动画编排(template 直通 / html 生成 / static 降级)
    animation-html.ts   html 三道校验(静态扫描 · Playwright 运行 · 动作)
    audio.ts            CosyVoice 逐句预渲染
  tts/                  bailian-cosyvoice · speak-text · mp3-duration · voices
  cli/run-problem.ts    单题跑完整流水线
tests/                  校验器 / tex-to-speech / 音频 key / html 静态校验
data/lessons/<id>/      input · figures · audio · state.json · log.ndjson
data/cache/figures/     按 sha1(风格前缀+prompt) 缓存的生图
```

## 每个阶段做什么

| 阶段 | 做什么 | 模型 |
|---|---|---|
| `uploaded` | 原图落 `input/`,建 `state.json` | — |
| `recognizing` | 图片 base64 进 Qwen(**思考开**),抄题干、审题四块、3–8 步骨架、总结四组、动画模板候选。坏 JSON 触发一次修复轮 | qwen3.8-flash |
| `planning` | 一次调用(**思考关**,`json_object`)出完整 BoardScript v2 草稿 | qwen3.8-flash |
| `scripting` | 校验草稿。有 error 就带着错误清单回一轮(纯结构错关思考、算错说错开思考);还有错就 salvage(删掉断链项、降级成告警),保证剧本能播 | 仅在需要修复时再调一次 |
| → | **发 `script` 事件,web 可以开讲** | |
| `assets` | 三件事并行:Seedream 情境图 / 动画 / CosyVoice 逐句语音。任何一项失败只把那一项标 `failed` | |
| `ready` | 发 `complete` | |

每次模型调用往 `log.ndjson` 追一行:prompt 摘要(角色 + 字数 + 开头 400 字 + 图片张数)+ response 原文,都过 `redact()`。

### 校验器的两档

- **errors** —— 会让剧本没法播或明显讲错:引用断链、公式行缺 tex、动作不在模板 manifest 里、旁白超 120 字、推理草稿泄漏、缺审题/总结列。第一遍出现就回一轮修复。
- **warnings** —— 能就地修好的:marks 不是题干子串(丢掉)、speech 缺失(用 `tex-to-speech` 兜底生成)、speech 混进 LaTeX(改用转换结果)、speech 漏了 tex 里的数字、希腊字母按拉丁转写念、template 参数越界(夹到 manifest 边界)、scene 超过 2 张、几何图走生图(删掉)、【】不成对、conclusion 与答案.md 对不上(在板书上标「与答案不符,请核对」)。

被规则删掉的东西会**连坐**清理引用它的卡和 flow 项,只记告警 —— 不为我们自己造成的断链再花一轮修复。

### html 动画的三道校验

1. 静态扫描(纯函数,有单测):≤ 30 KB;无 `fetch(` / `XMLHttpRequest` / `import(` / `<script src=` / `<link href=` / `http(s)://`(允许 `data:`);含 `window.lecture` 与 `lecture:ready`。
2. 运行:Playwright headless 把 HTML 塞进 `sandbox="allow-scripts"` 的 iframe,3 s 内收到 `lecture:ready` 且无 `pageerror` / `console.error`。
3. 动作:对剧本里用到的每个 `do.name` 各发一次 `lecture:do`,不抛错。

任一不过 → 把问题清单回给模型重生成一次 → 再不过 → 降级成 `static`(一张写着 `purpose` 的米白 SVG,不可交互)。

## 三道题的实测(2026-09-17,真接口)

### 阶段耗时

| 题目 | recognizing | planning | scripting | assets | 总计 | 开讲前(识题+规划+出剧本) |
|---|---|---|---|---|---|---|
| 01 圆与圆周角 | 26.4 s | 37.3 s | 0.0 s | 39.7 s | **103.5 s** | 63.7 s |
| 02 正方形旋转 | 40.3 s | 44.9 s | 0.0 s | 60.4 s | **145.7 s** | 85.2 s |
| 03 浮力潜艇 | 18.9 s | 35.0 s | 0.0 s | 28.4 s | **82.2 s** | 53.9 s |

三题都是**一轮过**(校验零 error,不需要修复轮),所以 scripting 只有校验的耗时,不到 100 ms。README 的「≤ 2 分钟开讲」达成(53.9 / 63.7 / 85.2 s)。
早一版代码上圆题曾触发过一次修复轮,开思考的那一轮单独花了 170 s —— 所以修复轮现在按错误类型决定开不开思考。

### 校验结果

| 题目 | errors | warnings | 具体 |
|---|---|---|---|
| 01 圆与圆周角 | 0 | 3 | 模型想给几何图开 `scene`,被拦下 + 配图卡连坐清理(2 条);1 条 speech 漏了 tex 里的 180 |
| 02 正方形旋转 | 0 | 5 | 同样想给几何图开 `scene`(2 条连坐);1 条 speech 把 α 念成「alpha」;1 张动画被 2 张卡引用;1 个 `fx:"highlight"` 不在枚举里被丢掉 |
| 03 浮力潜艇 | 0 | 0 | — |

### 剧本规模与素材

| 题目 | columns | cards | figures | animations | steps / 旁白 | 语音 |
|---|---|---|---|---|---|---|
| 01 圆与圆周角 | 6(审题·(1)求角·(2)①证倍数·(2)②判垂直·总结·动手) | 7 = problem 1 + analysis 1 + board 3 + animation 1 + takeaways 1 | 0 | 1 × `template:circle-angle` | 7 步 / 22 句 746 字 | 39 句 1.1 MB |
| 02 正方形旋转 | 6(审题·(1)猜想证明·(2)①相似证明·(2)②面积比值·总结·动手) | 8 = problem 1 + analysis 1 + board 3 + animation 2 + takeaways 1 | 0 | 1 × `html`(6.5 KB canvas) | 10 步 / 26 句 871 字 | 41 句 1.1 MB |
| 03 浮力潜艇 | 6(审题·(1)桌面压强·(2)沉底浮力·(3)上浮做功·总结·动手) | 8 = problem 1 + analysis 1 + board 3 + figure 1 + animation 1 + takeaways 1 | 1 × `scene`(Seedream 2048×2048,27.4 s) | 1 × `template:buoyancy` | 12 步 / 19 句 456 字 | 32 句 748 KB |

### 正方形旋转题走了哪条动画路径

**`html` 一轮通过(`first-pass`),没有重生成、没有降级。**

- 识题判定六个交互模板都摆不出「正方形 + 等腰直角三角形绕 A 旋转」,推荐 `board-steps`(置信度 high);出剧本时按纪律 E3 转成 `kind: "html"`。
- 生成耗时 31.9 s / 60.4 s(两次运行),产物 6.5 KB:DPR 自适应 canvas,按边长 15、AE=AF=9、cos α=3/5 算实际坐标画图,暴露 `window.lecture.{do,unlock,reset}`,`do("rotate")` 做旋转动画、`do("showPerp")` 显示 AE′⊥BE′ 的特殊位置。
- 三道校验全过:静态扫描无外链无网络;iframe 里 3 s 内发出 `lecture:ready`;剧本用到的 `showPerp` 发过去不报错。

降级路径本身也验证过(单测 + 手工构造):不发 `lecture:ready` 的 HTML 会报「3 s 内没有收到 lecture:ready」,`do()` 里抛异常的会报「发动作 play 时出错:页面报错:boom」,两次都不过就出兜底 SVG。

## 单测

97 个,全绿,都不打真接口:

| 文件 | 数量 | 覆盖 |
|---|---|---|
| `tests/validate.test.ts` | 37 | 引用闭合(7)、marks 子串、tex/speech 配对与希腊字母、say 纪律、scene 上限与几何图禁令、连坐清理、template 参数越界 / 动作与相位越界 / html 动作形状、列结构、【】、数值与答案一致、`extractJson` |
| `tests/tex-to-speech.test.ts` | 41 | 分式根号、上下标(含 `\text{水}` 包裹)、几何关系符号、单位与指数、五行整式、兜底清理、`texHasLatexMarkup`、中文数字比对 |
| `tests/audio-keys.test.ts` | 9 | flow 下标编 key、formula/table 的 key、takeaways 组名前缀、key 去重与顺序、文件名越界防护;外加「手写样例剧本本身零 error」的回归 |
| `tests/animation-html.test.ts` | 10 | 静态扫描八种不合格情形 + 兜底 SVG |

## 已知问题

1. **speech 的措辞质量参差**。数值层面有兜底(转换器比对数字、缺了就补生成),但「念得像不像老师」只能靠提示词。实测两类毛病:希腊字母按拉丁转写念(`ρ_水` 念成「rho 水」)、数字写成中文数字。前者现在只告警不改写(自动替换会把模型写得更好的措辞一起冲掉),后者在比对时按数值等价处理。
2. **模型总想给几何题开生图**。三道题里两道都试过,靠校验器硬拦。提示词 D2 已经写死,仍然拦不住 —— 这条规则不能拿掉。
3. **`fx` 只有 circle/underline/pulse**,模型受 lecture-scene 动作表影响会写 `highlight`,目前丢弃。见 `../shared/ISSUES.md` 第 4 条。
4. **一张动画被两张卡引用**时播放器无法区分,只告警不拦。见 ISSUES 第 8 条。
5. **静态降级的 SVG 很朴素**(米白底 + purpose 文字),只保证「不空」,谈不上教学价值。三道题都没走到这条路,所以没有进一步打磨。
6. **重跑同一道题会重新出图**:缓存键是 `sha1(风格前缀 + prompt)`,模型每次写的 prompt 措辞会变,所以命中率低。每张 2K 约 ¥0.3,调试时注意。
7. **动画卡与剧本的动作名可能对不齐**:html 动画是照 `purpose` + 剧本里用到的 `do.name` 生成的,模型有时会实现比剧本用得更多的动作(正方形旋转题实现了 `rotate` 但剧本只调了 `showPerp`)。多实现无害,少实现会被第三道校验抓到。
8. **`npm run dev` 用的是 `tsx watch`**,已经 `--ignore ./data/**`;如果再往项目里加会被频繁写入的目录,记得一并加进 ignore,否则流水线跑到一半会被重启打断。
