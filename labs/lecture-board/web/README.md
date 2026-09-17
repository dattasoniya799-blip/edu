# 讲题白板 · web(播放器)

HyperKnow 式白板讲题播放器:一列一阶段、九种卡片、旁白流、红圈标注、模板/HTML 动画、KaTeX + 语音双轨。
画布底座是 **Excalidraw(viewModeEnabled)**,卡片是 `embeddable` 元素里的 React 组件。

## 怎么跑

```bash
cd labs/lecture-board/web
npm install
npm run dev            # http://localhost:4311(/api 与 /assets 代理到 :4310)
```

- **不用起服务端也能看**:`http://localhost:4311/sample` 直接加载 `shared/sample-buoyancy.json`
  (mock 模式:题图用本地占位,情境图 6 秒后「到达」演一遍占位替换)。
- 起了服务端(`:4310`)之后走 `/`:传 1–3 张题目截图 + 答案 → `POST /api/lessons` → 跳 `/lesson/:id`,
  连 SSE 看规划进度,剧本一到就开讲。服务端没起时上传页会明说「连不上讲题服务」。

其它脚本:

```bash
npm test          # vitest,42 个用例
npm run typecheck # tsc --noEmit
npm run build     # vite build
npm run shots     # Playwright 截 3 张图到 web/shots/(要先 npm run dev)
node scripts/smoke.mjs       # 真按 ▷ 连播的冒烟检查(浮现 / 暂停 / 跳步 / 控制台零报错)
node scripts/spike.mjs       # 画布底座三个风险点的验证脚本(见文末)
node scripts/anim-bridge.mjs # 动画桥 template / html / static 三条路各走一遍
node scripts/shots-real.mjs  # 对真服务端的三道课程截图 → shots/real-*.png(要先起 server)
node scripts/hl-shots.mjs    # 「讲到哪、亮到哪」验收截图 → shots/hl-*.png(见下)
```

`/sample` 支持两个开关,用来在没有服务端的情况下走另外两条动画路:
`/sample?anim=html`(自包含 HTML 进 sandbox iframe,走 postMessage 桥)、`/sample?anim=static`(静态 SVG 降级)。

## 结构

```
src/
  board/                  ← 唯一碰 excalidraw 的地方
    ExcalidrawBoard.tsx     适配层:卡=embeddable、列标题=text、红圈=ellipse、下划线=line
    CardHost.tsx            embeddable 里的壳:ResizeObserver 量高 + 量每行偏移 + 150ms 淡入
    layout.ts               列布局纯函数(COL_W 445 / COL_GAP 60 / CARD_GAP 24 / nextY 游标)
  components/
    cards/                  九种卡片,纯 React,**禁止 import excalidraw**(有单测守着)
    TopBar / Narration / PlanningProgress / Katex / CardBody
  lib/
    flow.ts                 flow 调度器(播放器时序的唯一实现,副作用经 PlayerHost 注入)
    targets.ts              目标字符串(五种写法)解析/生成 + 审题列新初态的 reveal 判定
    highlight.ts            「讲到哪、亮到哪」:target 在 speaking/kept 里查出该贴的 className
    audio-keys.ts           音频 key 推导 + clip 可用性判定
    speaker.ts              预渲染 clip(<audio>)优先,回退 Web Speech
    waiter.ts               可暂停的等待(暂停时板书也得停)
    lecture-scene.ts        模板动画运行时加载(public/lecture-scene/ 同源挂载)
    api.ts                  REST + SSE(断线 1s→8s 退避重连)
    script-index.ts         cardId/lineId/colId 反查表
    markdown.ts             表格卡的 markdown→HTML
  pages/                    UploadPage / LessonPage(把调度器接到 BoardApi)
public/
  lecture-scene/            从 ohmyppt-lecture 原样复制的 runtime + 七个模板
  fonts/                    Virgil / Xiaolai(卡片内文字;画布上的手写体走 Excalidraw 自带)
shots/                      验收截图
```

## 与协议的对应

| protocol.md | 落在哪 |
|---|---|
| 播放器时序 1(收到 script:列标题全画、审题列整列可见) | `ExcalidrawBoard` 的 `isCardVisible`:`phase==='analysis'` 恒可见 |
| 时序 2(say / reveal / anim / fx) | `lib/flow.ts` 的 `runItem`;reveal 后 `wait(150)`,卡片浮现由 `CardHost` 的 CSS 过渡做 |
| 时序 2(讲到哪、亮到哪:speaking 临时高亮 / emph 留痕) | `FlowScheduler.speak()` 算 ref 目标(没写就取 `lastReveal`)→ `PlayerHost.speaking/keep`;`LessonPage` 把这两个集合存进 state 转给 `BoardContext`;卡片组件按 `lib/highlight.ts` 出 className,circle 由 `ExcalidrawBoard.keepCircle()`(独立于 `fx`/`clearFx`,不会被跳步清掉)画 |
| 审题列新初态(problem/analysis 卡默认隐藏高亮,等 `mark:`/`analysis:` reveal) | `components/cards/Cards.tsx` 的 `ProblemCard`/`AnalysisCard`,判定用 `lib/targets.ts` 的 `hasAnalysisStep`(按「剧本真的发过 mark:/analysis: reveal」判,不是按列 phase——原因见 `shared/ISSUES.md` W9) |
| 时序 3(每步分段 ✎ 列标题;figure 到达原地替换) | `onStepStart` 推 segment;figure 事件改 `script.figures[]`,卡片重渲染 |
| 时序 4(暂停 / 上一步下一步 / 语速) | `FlowScheduler.pause/resume/goTo` + `Waiter` + `Speaker.setRate`(clip 走 `playbackRate`) |
| 时序 4(跳步补齐) | `FlowScheduler.fastForward`:之前所有 reveal 瞬时完成,anim 以 `durationMs:0` 重放 |
| 时序 5(总结逐条念 → 动手解锁) | `FlowScheduler.runTakeaways` → phase `explore` → 对 `explore.animationId` 调 `setUnlocked` |
| 音频 key 四种形态 + clip 文本比对 | `lib/audio-keys.ts`(单测覆盖) |
| 动画桥 · template | `AnimationCard` 的 `TemplateScene`:`LectureScene.templates[id].mount()`,`scene.applyAction` |
| 动画桥 · html | `HtmlScene`:`sandbox="allow-scripts"` + `srcDoc`,收 `lecture:ready`/`lecture:error`,发 `lecture:do`/`unlock`/`reset` |
| 动画桥 · static | `StaticScene`:直接渲染降级 SVG |
| 画布底座 | `board/ExcalidrawBoard.tsx`,对外只有 `reveal / fx / clearFx / focus / setZoom / addColumn`(+ 调试用 `dumpElements`) |
| SSE 八种事件 | `lib/api.ts` 连接,`LessonPage.applyServerEvent` 分发 |

**纪律**:调度器只认 `BoardApi` 这六个方法,不认识 excalidraw;卡片组件只吃剧本数据。换底座只动 `board/`。

## 画布底座:三个风险点的实测结论

用 `node scripts/spike.mjs` 复现:

| 风险点 | 结论 | 现象 |
|---|---|---|
| (a) viewMode 下 embeddable 能不能渲染、能不能交互 | **能** | 卡片正常渲染;未激活时 `pointer-events:none`,**单击一次后变 `all`**。动手环节实测:解锁后点一下卡再拖「注水」滑杆,读数 0.05 → 0,拖得动。悬停提示(「点击以交互」)在无头环境没稳定触发,不影响看讲解 |
| (b) 量高 → updateScene → 下方卡重排 | **能,不闪** | 场景元素高 = DOM 高 × zoom,同列重叠 0 对;静置前后画面稳定。**坑**:卡被裁到视口外时 Excalidraw 会 `display:none`,量到 0 —— 已丢弃 0 读数,否则整列会塌 |
| (c) 淡入 | **能** | 淡入放在卡片组件内部(`.card-host` 的 150 ms CSS 动画),不依赖画布 |

所以走的是 **embeddable 方案**,没有退到 protocol.md 的 DOM 叠层备选。

## 动画桥三条路的验证

`node scripts/anim-bridge.mjs` 的实测输出:

```
template:挂载 svg=true,show 动作点亮的层数=4(剧本里发了 4 个 show)
html:iframe 内 log="do:bars #5",tank opacity=1,还在等 ready = false
static:渲染 svg=true,内容="静态降级图(不可交互)"
✓ 三条路控制台零报错
```

- **template**:样例剧本自带,`LectureScene.templates.buoyancy.mount()` 同源挂载,四个 `show`
  把四层点亮,`run towater/rise` 跑得动,动手环节解锁后滑杆拖得动(见上表 a7)。
- **html**:`/sample?anim=html` 换上一个自包含 HTML 夹具(`src/mock/sample.ts`),它按协议暴露
  `window.lecture` 并在 load 时 `postMessage({type:'lecture:ready'})`;播放器把 flow 的 anim 动作翻成
  `{type:'do', name, params}` 发进去,iframe 里确实执行了(方块显出来、日志计到 #5)。
- **static**:`/sample?anim=static` 换成一段 SVG,直接内联渲染,收到动作不报错也不动。

## 真剧本踩到的坑与 web 侧兜底(2026-09-17 接真服务端后)

Qwen 出的真剧本和 `shared/sample-buoyancy.json` 有几处不一样,web 侧做了兜底。**这几条要回流给出剧本提示词/校验器**
(`shared/ISSUES.md` 已被服务端同学重写过一版,我这次没动那个文件,先记在这里):

| 现象 | 哪道题 | web 侧兜底 |
|---|---|---|
| 剧本把「总结 / 动手」也写成 steps,且 `reveal` 的是整张 takeaways 卡(不是逐条) | 浮力题 s11/s12 | 整卡 reveal → 卡里条目全显示;逐条 reveal 也照旧支持 |
| 给动画发了动作,却从没 `reveal` 那张动画卡 | 圆题(`k_anim` 全篇没 reveal) | `do:anim` 会先把承载该动画的卡浮现(动手列的卡除外) |
| 动手列的卡没人 reveal | 正方形题 `k_explore` | 进动手环节时把 explore 列的卡全部放出来 |
| 只发 `run`/`highlight`,没把模板底图 `show` 出来 → 动画卡空白 | 浮力题(一个 show 都没有)、圆题(只 show 了 segBE) | 第一个动作前,把「剧本自己不管的底图层」瞬时点亮;底图取自 `templates/manifest.json` 的 `actions.draw`,剧本写全了这条就是空集 |
| 同一个 `animationId` 挂在两张卡上 | 正方形题 `a_rot`(第(2)问 + 动手列) | 动作发给所有挂了这个 id 的卡,`unlock` 同理 |

## 已知问题

1. **卡片右上角有个「↗」链接徽标**。embeddable 必须带 `link` 才会渲染(否则是「Empty Web-Embed」),
   而带 link 的元素 Excalidraw 会在画布上画链接徽标,CSS 盖不掉。详见 `shared/ISSUES.md` W5。
2. **动手环节要多点一下**。view mode 下 embeddable 的 `pointer-events` 只有被点击激活后才打开,
   所以拖动画手柄前要先点一下那张卡。看讲解不受影响(协议里已经认了这条)。
3. **卡片首次浮现时高度会校正一次**。先按卡型估高入场,ResizeObserver 量到真高后重排同列下方的卡;
   图片/KaTeX/动画 SVG 落地会再触发一次校正。肉眼基本看不出来,但跳步时偶尔能看到一次轻微下沉。
4. **`fx:'pulse'` 不是真脉冲**,画布元素没有 CSS 动画,现在是「红圈闪 1.4 秒再撤」。
5. **Web Speech 在无头 Chromium 里不发声**,`speak` 可能不回 `end`;`Speaker` 有按字数估时的兜底定时器,
   所以截图脚本一律静音(`window.__board.setMuted(true)`),靠估时推进节奏。
6. **卡片过多时没有分页**。方案 §十 提到「每列 ≤ 6 卡,超出自动开新页」,第一轮没做,长列就一直往下长。
7. **审题列很长时开讲前的缩放会偏小**(正方形题到 47%)。取景规则是「审题列整列看得全」,列越长字越小;
   讲到解题列时会自动把缩放拉回 ≥ 62%,开讲前想看清可以按 +。
8. **题干里的 mark 片段如果正好跨行,红圈只圈得住占比最大的那一段**(`board/CardHost.tsx` 的
   `offsetWithin` 用 `getClientRects()` 挑最大的一个矩形,不是整段文字的并集,否则跨行会给出一个
   从首行到末行的诡异大框,比只圈半句更难看)。肉眼几乎不影响(marks 通常不长),截图见 `shots/hl-01-*`。

## 调试钩子

讲题页会在 `window.__board` 上挂几个方法(截图脚本和排障用):

```js
window.__board.seek(stepIndex, flowIndex) // 瞬时推进到某步某项(不播音)
window.__board.summary()                  // 直接到总结 + 动手
window.__board.setMuted(true)             // 静音(按字数估时推进)
window.__board.deliverFigure('f_scene')   // mock 模式下手动让配图「到达」
window.__board.elements()                 // 当前画布场景元素概览
```
