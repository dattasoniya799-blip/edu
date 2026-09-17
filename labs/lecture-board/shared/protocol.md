# 讲题白板 · server ↔ web 协议(v2,2026-09-17 冻结)

类型权威在 `schema.ts`。本文件定义端点、SSE 事件、素材 URL、音频 key、动画桥。两侧只读;要改先改这里。

## 端口与目录

- server:`http://localhost:4310`;web(Vite):`http://localhost:4311`,`/api` 与 `/assets` 代理到 4310。
- server 数据目录:`server/data/lessons/<lessonId>/`:`input/`(上传原图)、`figures/`、`audio/`、`state.json`(LessonState 快照)、`log.ndjson`(每次模型调用的 prompt/response 摘要,便于调试)。

## REST

| 方法 | 路径 | 说明 |
|---|---|---|
| `POST` | `/api/lessons` | `multipart/form-data`:`images[]`(1–3 张 png/jpg,≤ 8 MB/张)、`answer`(文本,必填)、`problemText`(可选)。返回 `{ id }`,**立即返回**,后台开始流水线 |
| `GET` | `/api/lessons/:id` | 返回 `LessonState`(含当前 script 与素材状态) |
| `GET` | `/api/lessons/:id/events` | SSE,见下 |
| `GET` | `/api/lessons` | 列表 `{ id, createdAt, stage, title? }[]`(调试用) |
| `GET` | `/assets/:lessonId/*` | 静态素材(上传原图 / 图 / 音频) |
| `GET` | `/api/health` | `{ ok: true }` |

## SSE(`/api/lessons/:id/events`)

每条 `data:` 一个 JSON;连上先补发一条 `snapshot`。事件:

```ts
type ServerEvent =
  | { type: 'snapshot'; state: LessonState }                                   // 连接时的全量
  | { type: 'stage'; stage: LessonStage; status: 'start' | 'done' | 'error'; message?: string; ms?: number }
  | { type: 'script'; script: BoardScript }                                    // 剧本就绪(素材可能还在生成)→ web 可以开讲
  | { type: 'figure'; id: string; status: 'ready' | 'failed'; src?: string; error?: string }
  | { type: 'animation'; id: string; status: 'ready' | 'failed'; kind?: 'template' | 'html' | 'static'; html?: string; svg?: string; error?: string }
  | { type: 'audio'; key: string; src: string; durationMs?: number; text: string }  // 一句合成完发一条
  | { type: 'complete' }                                                       // 全部素材落定(含失败)
  | { type: 'error'; message: string };                                        // 流水线致命错误(stage=failed)
```

**出剧本纪律 · 审题阶段(2026-09-17 11:40 新增,server 提示词 + 校验器强制)**:`steps` 必须以 1–2 个 `phase=analysis` 的 step 开头,合计 5–9 句 say,顺序为:一句总览这题问什么 → 逐条「已知」(每条 `reveal mark:<数据片段>` + say `ref:'mark:<…>'`,`emph:'mark'`)→ 「隐含条件」(每条 `reveal mark:<线索片段>` + say 解释它意味着什么,`emph:'circle'`,并 `reveal analysis:hidden:<i>`)→ `reveal analysis:find` + 一句说清求什么 → `reveal analysis:ideas` + 每问一句思路。校验器:审题 step 缺失 → 打回重写;审题 say 无 ref → 自动指向本步最近 reveal 的目标并告警;`mark:<text>` 不在 marks 里 → 删该 reveal/ref 并告警。解题阶段:say 有 ref 的比例 < 60% 告警;conclusion 行 reveal 后若无 emph:'circle' 的 say,自动给紧随的 say 加 `ref: <lineId>, emph:'circle'`。

流水线阶段顺序:`recognizing`(识题 → keypoints)→ `planning`(白板规划:列 / 卡 / 配图计划 / 动画计划)→ `scripting`(出 steps/flow + tex/speech + takeaways,校验)→ 发 `script` → `assets`(并行:Seedream 出图、动画生成校验、CosyVoice 逐句合成;每完成一项发一条事件)→ `ready` + `complete`。
planning 与 scripting 可以合成一次模型调用,但阶段事件仍要各发一次(便于计时)。

## 素材 URL

- 上传原图:`/assets/<lessonId>/input/<n>.<ext>` → 填 `script.problem.images`。
- 情境图:`/assets/<lessonId>/figures/<figureId>.jpg`(Seedream 回 JPEG)。
- 音频:`/assets/<lessonId>/audio/<key>.mp3`,key 里的 `.` 原样(文件名允许)。

## 音频 key(播放器与预渲染的共同约定)

- `steps.<stepId>.flow.<i>`:第 i 个 flow 项(0 起,按 flow 数组下标,不是 say 的序号)。
- `cards.<cardId>.lines.<lineId>`:formula 行的 speech(reveal 该行时若 flow 里没有紧随的 say,播放器念它)。
- `cards.<cardId>.speech`:table 卡的 speech。
- `takeaways.<group>.<i>`:总结四组(knowledge / pitfalls / methods / variants),口播文本 = 去掉【】的条目,首条前加组名(「核心知识点。」「考点与易错。」「方法与技巧。」「举一反三。」)。
- 播放器用 `clip.text === 实际口播文本` 判断可用,不一致回退浏览器 Web Speech。

## 播放器时序(web)

1. 收到 `script`:渲染全部列标题;审题列的 **problem 卡可见但题干高亮全隐藏、analysis 卡可见但四块全隐藏**(2026-09-17 11:40 改;若剧本没有 phase=analysis 的 step,退回「审题列整列可见」),其余列的卡全部隐藏;顶栏 ▷ 可点。可选自动:20 s 后自动开讲。
2. 点 ▷:顺序执行 `steps[].flow`。`say` → 右栏追加一段(段头是当前 step 所属列标题 + 动作图标),播音频(有 clip 用 clip,无则 Web Speech;音频没到就先 Web Speech,不等)。`reveal` → 卡/行/题干高亮/审题块浮现动画(150 ms),视口平滑滚到该卡。`anim` → 转发动画卡。`fx` → 叠加红圈/下划线。
   **讲到哪、亮到哪**(2026-09-17 11:40 新增):每句 `say` 开始时,给 `ref` 目标(没写 ref 则取最近一次 reveal 的目标)加「正在讲」高亮——板书行/审题条目/题干片段是黄色马克笔底,整卡是左侧 3px 本色竖条 + 卡纸微微提亮;句子念完 300 ms 淡出。`emph:'mark'` 念完保留黄底(题干上的 mark 即变为它的三色底);`emph:'circle'` 念完时画一个红色手绘圈并保留(与 `fx:circle` 同一实现)。同一时刻只有一个「正在讲」目标组;跳步时清掉临时高亮、保留 emph 留下的痕迹。
3. 每步开始时右栏加分段标题(✎ 列标题);figure 到达时占位卡替换为图;audio 到达对已播过的句不补播。
4. 步与步之间自动连播;控件:暂停/继续、上一步/下一步(跳步时把该步之前的 reveal 全部瞬时完成)、语速(0.8/1/1.25/1.5,预渲染音频用 `playbackRate`)。
5. 全部 steps 结束 → 总结列 takeaways 卡逐条浮现并念 → 动手:`explore.animationId` 那张动画卡解锁 `unlock` 参数手柄,显示 `tasks`。

## 画布底座(2026-09-17 10:12 用户拍板:Excalidraw)

- web 端白板用 `@excalidraw/excalidraw`(^0.18,MIT)`viewModeEnabled` 作底:无限画布、平移缩放、手绘图元、Excalifont/Xiaolai 手写字体都是原生的。
- **卡片 = `embeddable` 元素 + `renderEmbeddable` 回调**渲染我们自己的 React 卡片组件(KaTeX / 表格 / 图片 / 动画 iframe 全在里面);容器随画布 `translate/scale`。已核实源码(v0.18.1 `renderEmbeddables`):内容任意 DOM;`pointerEvents` 仅在元素被点击激活后开启(悬停有「点击以交互」提示)——看讲解无影响,动手环节多一次点击,接受。
- 列标题 = `text` 元素(手写字体)+ 其后一块黄色低粗糙度矩形当马克笔;红圈 = `ellipse`(roughness 2,红描边);下划线 = `line`;`focus` = `excalidrawAPI.scrollToContent(elements, { animate: true })`。
- 卡片高度:内容渲染后用 ResizeObserver 量高 → `updateScene` 改元素 `height` 并重排该列下方元素(nextY 游标);浮现动画在卡片组件内部用 CSS 过渡,未 reveal 的卡不加入场景。
- **纪律:卡片组件(`components/cards/*`)不得 import excalidraw**,只吃剧本数据;`board/ExcalidrawBoard.tsx` 是唯一碰 excalidraw 的适配层,将来换底座只换它。
- 若 embeddable 在 view mode 下有阻塞性问题(量高、激活、性能),退回 OpenHyperKnow 的写法:Excalidraw 底 + `pointer-events:none` 的 DOM 叠层,按 `onChange` 的 appState(scrollX/scrollY/zoom)同步坐标——底座仍是 Excalidraw,不返工。

## 动画桥

**template 动画**(同源,直接挂载):web 把 `lecture-scene/runtime/scene-base.js` 与六个 `templates/*.js` 打进包,`LectureScene.templates[<id>].mount(container, params, ctx)` 得到 scene;flow 的 `anim.action` 直接 `scene.applyAction(action, ctx)`;动手时按 `unlock` 调 scene 的手柄开关(参考 `runtime/player.js` 的 explore 段)。

**html 动画**(sandbox iframe,`sandbox="allow-scripts"`,`srcDoc=html`):
- iframe → parent:`{ type: 'lecture:ready' }`(加载完)、`{ type: 'lecture:error', message }`。
- parent → iframe:`{ type: 'lecture:do', name: string, params?: object }`(对应 flow `anim.action = {type:'do', name, params}`)、`{ type: 'lecture:unlock', params: string[] }`(动手)、`{ type: 'lecture:reset' }`。
- html 必须在 `window.lecture` 上暴露 `{ do(name, params), unlock(params), reset() }` 并在 load 时 postMessage ready;server 的校验器静态检查这几个符号存在。

**server 侧 html 动画校验**(三道,任一不过重生成一次,再不过降级 static):
1. 静态:≤ 30 KB;无 `fetch(`、`XMLHttpRequest`、`import(`、`<script src=`、`<link href=`、`http://`、`https://`(允许 `data:`);含 `window.lecture` 与 `lecture:ready`;
2. 运行:Playwright headless 打开 `srcDoc`,3 s 内收到 ready 且无 `pageerror`/`console.error`;
3. 动作:对剧本里用到的每个 `do.name` 发一次 `lecture:do`,不抛错。

## Seedream 情境图

- 请求:`POST https://ark.cn-beijing.volces.com/api/v3/images/generations`,`{ model:'doubao-seedream-5-0-260128', prompt, size:'2K', response_format:'b64_json', watermark:false, sequential_image_generation:'disabled', stream:false }`;key 读 `/Users/apple1/Desktop/edu/qiming/apps/server/.env` 的 `IMAGE_API_KEY`(不复制到别处)。
- 风格前缀(固定拼在 prompt 前):`教学插画,手绘线稿加淡彩,米白纸底,构图简洁,画面里不要出现任何文字、字母、数字或标签。`
- 实测 2K 一张 20–33 s,回 JPEG;并行发出,不阻塞开讲。
- 缓存:`server/data/cache/figures/<sha1(风格前缀+prompt)>.jpg`,命中直接复制。

## Qwen(百炼)

- OpenAI 兼容端点 `https://dashscope.aliyuncs.com/compatible-mode/v1`,模型 `qwen3.8-flash`;key 读 `~/.config/edu/bailian.env` 的 `DASHSCOPE_API_KEY`。
- 识题:图片进 `content: [{type:'image_url', image_url:{url:'data:image/png;base64,...'}}, {type:'text', ...}]`,`enable_thinking: true`;规划/出剧本:`enable_thinking: false`,`response_format: { type: 'json_object' }`。
- 每次调用把 prompt 摘要 + response 原文写 `log.ndjson`。

## CosyVoice(百炼 WebSocket)

沿用 `ohmyppt-lecture/src/main/lecture/tts/bailian-cosyvoice.ts` 的协议实现(`wss://dashscope.aliyuncs.com/api-ws/v1/inference`,`ws` 包带 Authorization 头,`cosyvoice-v3-flash`,音色 `longxiaochun_v3`,mp3 / 22050 / 32 kbps)。合成前经 `speak-text.ts` 规范化(去【】、Unicode 符号转口语);formula 行念 `speech` 字段,不念 tex。
