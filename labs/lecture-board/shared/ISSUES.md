# shared 契约的缺口与临时口径

> 由 server 侧(子智能体 A)在 2026-09-17 实现时记录。`schema.ts` / `protocol.md` 已冻结,**这里只记问题和我采用的临时口径,没有改动契约本身**。
> 每条给出:现象 → server 现在怎么做 → 建议契约怎么改。web 侧按「server 现在怎么做」对接即可。

## 1. `Animation.kind='template'` 的取值范围里没说 `board-steps` 算不算

- **现象**:`schema.ts` 注释列了六个模板;`lecture-scene/templates/manifest.json` 里其实有七个,第七个是 `board-steps`(通用板书)。
- **口径**:v2 的白板本身就是「列 + 卡 + 板书行」,`board-steps` 的职责已经被白板吸收,所以它**不进动画模板目录**。`server/src/templates.ts` 的 `ANIMATION_TEMPLATES` 过滤掉它,只保留六个;识题时仍把它列给模型看,作为「这题没有现成场景,请走 html 动画」的信号。
- **建议**:在 schema 注释里写明这一点。

## 2. SSE 的 `animation` / `figure` 事件带不回「参数被改过」

- **现象**:`animation` 事件只有 `{ id, status, kind, html, svg, error }`,**没有 `params` 与 `template`**;`figure` 事件只有 `{ id, status, src, error }`,没有 `caption` / `kind`。但校验器会把越界的 template 参数夹到 manifest 边界(如 `V: 99 → 10`),这个修正推不给 web。
- **口径**:所有对 `script` 的结构性修正(template 参数夹取、越界参数丢弃、违规配图删除、id 连坐清理)**全部在发 `script` 事件之前完成**;`script` 事件里的剧本就是最终形态,后续 `figure` / `animation` / `audio` 事件只负责把 `src` / `html` / `svg` 填进去,不再改别的字段。web 可以放心以 `script` 事件为准。
- **建议**:给 `animation` 事件补 `params?`,或在文档里写死「script 之后结构不再变」。

## 3. `Figure.kind` 只有两种,方案 §四 说的是四种

- **现象**:方案 §四把配图分成 `scene` / `geometry`|`graph` / `diagram` / `table` 四类,`schema.ts` 的 `Figure.kind` 只有 `scene | diagram`。
- **口径**:几何图与函数图**根本不进 `figures`**(方案的本意就是「禁止生图」),它们走动画卡或板书行;表格走 `Card.kind='table'`。校验器发现 `scene` 的 prompt 里出现几何/函数词(圆心、圆周角、三角形、正方形、坐标系、抛物线、对角线、∠…)就把这张图删掉并告警。
- **实测**:三道题里圆题和正方形旋转题的模型**都**试图给几何图开 `scene`,两次都被拦下 —— 这条规则是必要的,不是多余的防御。

## 4. 模型常写 `fx: 'highlight'`,schema 只认 circle/underline/pulse

- **现象**:`FlowItem` 的 `fx` 枚举是 `'circle' | 'underline' | 'pulse'`,但 lecture-scene 的动作表里有 `highlight`,模型受它影响会写 `{"fx":"highlight"}`(2026-09-17 正方形旋转题实测出现一次)。
- **口径**:不认识的 `fx` 直接丢掉并记告警(不打回重写 —— 少一个高亮不影响讲课)。
- **建议**:要么给 `fx` 加上 `'highlight'` 作为 `pulse` 的别名,要么在 schema 注释里显式写「不要用 highlight」。

## 5. 音频 key 直接当文件名有越界风险

- **现象**:protocol 说「音频 URL `/assets/<lessonId>/audio/<key>.mp3`,key 里的 `.` 原样(文件名允许)」。但 key 里的 `<stepId>` / `<cardId>` / `<lineId>` 都来自模型输出,理论上可以包含 `/` 或 `..`。
- **口径**:`audioFileName()` 把 `/ \ : * ? " < > |` 与控制字符换成 `_`,`.` 原样保留。正常剧本里这些字符不会出现,所以生成的文件名与 protocol 一致。
- **建议**:在 protocol 里补一句「key 只允许 `[A-Za-z0-9_.-]`」,由两侧各自保证。

## 6. takeaways 口播前缀的标点

- **现象**:protocol 写的是「首条前加组名(「核心知识点。」…)」用句号;v1 的 `tts/prerender.ts` 用的是冒号(`核心知识点:`)。
- **口径**:**按 protocol 用句号**,`clip.text` 存的就是带前缀、去【】之后的最终口播文本(如 `核心知识点。固体压强 p=F/S,水平面上压力等于重力`)。web 端比对时请用同样的拼法。

## 7. `explore.unlock` 对 html 动画没有意义

- **现象**:`explore.unlock: string[]` 是「开放哪些参数手柄」,这套语义来自 template 动画的 manifest `handles`;LLM 现场生成的 html 动画没有参数表。
- **口径**:html 动画的 `unlock` 一律写 `[]`,动手环节只给 `tasks`(白板侧仍可以让学生手动重放 `do` 动作)。校验器会把 template 动画里不在 `handles` 表内的 unlock 项去掉。

## 8. 同一张动画被多张卡引用时,动作派发有歧义

- **现象**:`{do:'anim', target}` 的 `target` 是**动画 id**,不是卡 id。如果两张 `kind='animation'` 的卡引用同一个 `animationId`(2026-09-17 正方形旋转题实测出现),播放器不知道该驱动哪一张,只能两张一起驱动。
- **口径**:校验器记一条告警,不拦(两张一起动虽然浪费,但不算错)。
- **建议**:要么规定「一张动画只能放一处」,要么把 `anim.target` 改成卡 id。

## 9. `LessonState.timings` 里的 `ready`

- **现象**:`timings` 的 key 类型是 `Exclude<LessonStage, 'uploaded' | 'failed'>`,含 `ready`;但 `ready` 是一个瞬时状态,没有「时长」。
- **口径**:`ready` 写 `{ startedAt, endedAt, ms: 0 }`,只当作「什么时候讲完全部素材」的时间戳用。

## 10. `problem.images` 谁来填

- **现象**:schema 说是 `/assets/...` URL,但剧本是模型产出的,模型并不知道 lessonId。
- **口径**:提示词里把真实 URL 数组给模型让它抄,同时 server 在校验时**无条件用自己的那份覆盖**(`NormalizeContext.images` 优先)。模型编错了也不影响。

---

# 二、web 侧(子智能体 B)记录 —— 2026-09-17,由协调会话合并追加

> 以下是 web 侧对接真剧本时发现的缺口;详表与兜底做法见 `web/README.md`「真剧本踩到的坑与 web 侧兜底」与「已知问题」。**两侧以后只追加,不整份重写本文件。**

## W1. 剧本层(应回流到出剧本提示词 / 校验器;web 已兜底但不该长期靠兜底)
- 给动画发 `do:anim` 却从未 `reveal` 承载它的卡(圆题 `k_anim`)→ web:`anim` 前自动浮现承载卡。
- template 动画只发 `run`/`highlight`,没 `show` 底图层 → 卡片空白(浮力题零 show;圆题只 show 了 `segBE`)→ web:首个动作前按 `manifest.actions.draw` 点亮剧本没管的底图层。**建议服务端校验器对 template 动画自动在首个 anim 前补 `show` 底图动作,并在提示词写明。**
- 动手列的卡没人 reveal(正方形题 `k_explore`)→ web:进动手环节时放出 explore 列全部卡。
- 同一 `animationId` 挂两张卡(正方形题 `a_rot`)→ web:动作广播给所有承载卡。**建议规定一张动画只挂一张卡。**
- 总结/动手被写成 steps 且 `reveal` 整张 takeaways 卡而非逐条 → web 两种都认。
- 模型写 `fx:'highlight'`(schema 无此值)→ server 已丢弃告警;web 也忽略未知 fx。

## W2. 协议缺口(待冻结方改)
- table 卡的 `speech` 何时念未定义 → web:reveal 该卡且其后无紧随 say 时念。
- `anim.target` 指 animationId(非 cardId)应在 schema 注释点明。
- 跳步时动画如何补齐未定义 → web:瞬时重放该步之前所有 anim 动作。
- explore 列的 `tasks` 挂在哪张卡未定义 → web 合成一张「动手」卡(schema 无此卡型)。
- `status:'ready'` 不保证 `html`/`svg`/`src` 字段存在 → web 按字段存在性判断。

## W3. 底座(Excalidraw embeddable)相关
- embeddable 必须带 `link`(否则渲染成「Empty Web-Embed」),带 link 会在卡右上角画「↗」徽标,CSS 盖不掉。
- 红圈画在 embeddable 之后仍被卡纸盖住 → 卡纸拆为普通 `rectangle` + 全透明 embeddable 只承载 DOM,顺序 卡纸 → 红圈 → 透明 embeddable;**卡片组件不许再上不透明背景**。
- `fx:'pulse'` 画布元素无 CSS 动画 → 近似为「红圈闪 1.4s 撤」。
- 卡被裁到视口外时 Excalidraw 会 `display:none`,ResizeObserver 量到 0,必须丢弃该读数。

## W9.「有 phase=analysis 的 step」这个判定信号,光看列 phase 不够(2026-09-17「讲到哪、亮到哪」上线时发现,真实回归)
- **现象**:schema.ts `Card` 注释说「若剧本没有 phase=analysis 的 step,播放器退回旧行为(审题列整列可见)」。
  但实测已经落地的真剧本(`20260917-104306-yeqe-03-浮力潜艇`)**列本身就是 `phase:'analysis'`、也确实有
  step(`s1`/`s2`)落在这一列**,可这些 step 只对整张 `k_analysis` 卡发 `fx:'circle'`/`fx:'underline'`,
  从来没有 `reveal mark:<text>` 或 `analysis:<block>`。如果单纯按「有没有 step 落在 analysis 列」判定,
  会把这批旧剧本也误判成走「新初态」——题干三色高亮和审题四块永远等不到对应的 reveal,白板上审题列直接
  开天窗(用这道真题实测复现过,截图见 web 的交接记录)。
- **口径**:web 侧把判定信号换成「剧本是不是真的 `reveal` 过 `mark:` 或 `analysis:` 前缀的 target」
  (`web/src/lib/targets.ts` 的 `hasAnalysisStep`),不再看列 phase 或 step.col。真按新契约出的剧本一定会
  发这类 reveal,旧剧本一条都不会发,这个信号比列 phase 更准。
- **建议**:`schema.ts` 那句注释改成「若剧本没有 `reveal` 过 `mark:`/`analysis:` 目标」,而不是「没有
  phase=analysis 的 step」;或者 server 出剧本 / 校验器给这类剧本显式打一个标记(如
  `analysisRevealDriven: boolean`),别让两侧各自猜同一件事却猜出不同答案。

## W10. `emph:'circle'` 是「念完时」画圈,还是「讲到就」画圈,protocol.md 原文两种读法都通
- **现象**:protocol.md 写的是「`emph:'circle'` 念完时画一个红色手绘圈并保留」,字面像是等这句话说完才画。
  但按这个顺序没法呈现「这句正在讲(黄底)+ 圈已经画上」这种更自然的画面——圈跟着讲到就出现,比等一整句
  念完才出现更贴近口语讲课的直觉,验收截图(讲到「沉入水底」那句)也需要这两者同框。
- **口径**:web 侧改成「`emph:'circle'` 一开口就画圈并留着,不等这句念完」(`web/src/lib/flow.ts` 的
  `FlowScheduler.speak()`);`emph:'mark'` 仍按字面「念完才留黄底」不变,没有这个提前的问题。
- **建议**:protocol.md 那句话明确一下到底是哪种时机,两侧口径对齐(如果 server 出剧本/校验器以后要按
  时机做什么假设,现在 web 的口径是「提前画」)。

---

# 三、运行问题复查(2026-09-17,由复查会话追加)

## W11. `{ type: 'complete' }` 的语义「全部素材落定(含失败)」只覆盖「资产部分失败」,不覆盖「整道题都没跑起来」
- **现象**:protocol.md 给 `complete` 的注释是「全部素材落定(含失败)」。实测 `pipeline.ts` 的 `runPipeline`:
  流水线一路顺利跑到 `ready` 才会发 `complete`;但如果 `recognizing`/`planning`/`scripting` 任一步直接抛错
  (比如 Qwen 超时、两次都拿不到合格 JSON),走的是 `catch (error) { await failLesson(state, error) }`,只发
  `{ type: 'error', message }`,**从来不会再发 `complete`**。协议注释「含失败」容易被读成「不管成不成功最终
  都会收到一条 complete」,但实际上只有「figures/animations/audio 这几项素材部分失败」才算在“含失败”里,
  整题失败(stage=failed)完全是另一条路径,靠 `error` 事件收尾。
- **口径**:web 侧(本次复查新加的 `lib/api.ts` 的 `connectEvents`)把「收到 `error` 事件」与「`snapshot` 里
  `state.stage` 已经是 `failed`」也当作终态处理(自动断开 SSE 连接),不再假设一定会收到 `complete`。
- **建议**:protocol.md 那句注释改成「`complete`:资产阶段全部落定(单项失败也算落定);整道题失败走
  `error`,不会再发 `complete`」,把两条终态路径分开写清楚,免得两侧各自猜。

## W12. 动画桥没有 `lecture:pause`/`lecture:resume`,暂停播放器时 html 动画的内部动画不会收到信号
- **现象**:protocol.md「动画桥 · html 动画」只定义了 `lecture:do`/`lecture:unlock`/`lecture:reset` 三种
  parent→iframe 消息。播放器暂停(`FlowScheduler.pause()`)时,template 动画会调 `setSceneClockPaused(true)`
  暂停 `LectureScene.Clock`,但沙箱 iframe 里的 html 动画完全不知道播放器暂停了——如果它内部用
  `requestAnimationFrame` 跑一段比较长的动画,暂停期间它会继续跑完。
- **口径**:目前靠约定弱化影响——`animation.ts` 的 `HTML_SYSTEM_PROMPT` 要求「单次 ≤2 秒」的短动画,不是
  持续循环,所以暂停时最多有一段 2 秒以内的动画继续跑完,影响很小,本次复查没有新增消息类型去修。
- **建议**:protocol.md 补一条 `{ type: 'lecture:pause' }` / `{ type: 'lecture:resume' }`,html 动画收到后
  自行决定要不要 `cancelAnimationFrame`(多数场景可以什么都不做,只有做了长循环动画的才需要响应)。
