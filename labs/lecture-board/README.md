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
- 已知待改:LLM 生成的 HTML 动画常把画面画得偏小(canvas 未按卡片尺寸自适应);动画卡上展示了 `purpose` 里的动作名列表(应只给学生看一句话);「百分之百」被数字化成「百分之 100」;审题步常 10–14 句略超纪律的 5–9 句(软告警)。
- 待用户验收第 6 条(「可以给学生看」)后,按 `_lab/讲题PPT/讲题白板-整体方案-2026-09-17.md` §八 走 P0(核心迁入 NestJS、契约申请)。

## 怎么在仓库里跑

```
cd labs/lecture-board && npm run install:all && npm run dev   # server :4310 + web :4311
```
密钥:百炼 `~/.config/edu/bailian.env`(`DASHSCOPE_API_KEY`,可用 `LECTURE_BAILIAN_ENV` 指别处);Seedream 自动读 `apps/server/.env` 的 `IMAGE_API_KEY`(可用 `LECTURE_SEEDREAM_ENV` 指别处)。生成产物在 `server/data/`(gitignore)。管理员端「实验室 → 讲题白板」卡片链到 :4311。
