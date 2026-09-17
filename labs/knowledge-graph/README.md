# 知识图谱浏览器（动态版）

> **这篇解决什么问题、写给谁**：`labs/` 实验区里的一个独立实验——把「初中数理化知识图谱浏览器」从工作区外的
> `_research/os-taxonomy` 迁进仓库，改成**动态**服务：启动时直接读仓内 v2 图谱数据实时构图，数据文件改了刷新即见，
> 不再依赖一步 Python 导出脚本。写给要跑这个实验、或要评估「知识图谱要不要做成正式产品能力」的人。
> 依 `docs/00-协作纪律.md`：`labs/` 不进主线门禁、不部署，一个实验一个目录，自带 README。

## 在验证什么

验证「知识图谱的 Marble os-taxonomy 变换（章/节/知识点 → topics/dependencies/clusters，含 PageRank 中心度、
证据句、评估提示语等派生字段）可以完全用 JS 在内存里做一遍，不用 Python 落盘再读」，并且：

1. 变换结果与既有 Python 导出脚本的结果**逐字段对拍一致**（见下方「对拍结果」）；
2. 服务能监听数据目录，数据文件一变就在 500ms 内热重建，不用重启进程；
3. 现有的可视化前端（`explorer/` 三个文件，今天刚调过圆点样式和配色/文案）**原样搬过来，接口不变就能跑**。

这是实验室形态的验证，不是要上线的产品能力——见文末「与正式平台的关系」。

## 怎么跑

```bash
cd labs/knowledge-graph
node server.mjs                # 或 npm run start；缺省端口 8787
# 浏览器打开 http://127.0.0.1:8787
```

- 端口：`PORT` 环境变量，缺省 `8787`。
- 数据源目录：`KG_V2_DIR` 环境变量，缺省 `../../data/knowledge-graphs/v2`（相对本目录，即仓库的
  `data/knowledge-graphs/v2/`）。
- `npm run dev`：`node --watch server.mjs`，改 `server.mjs` / `lib/taxonomy.mjs` 本身会自动重启进程
  （数据文件的热重建走的是服务内部的 `fs.watch`，跟这个是两件事，不用 `--watch` 也会生效）。
- 不需要 `npm install`：本目录**不引入任何 npm 依赖**，也不在 workspaces 里，全部用 Node 内置模块
  （`node:http` / `node:fs` / `node:path` / `node:test`）。

## 数据从哪里来

启动时读取 `KG_V2_DIR` 下的三份 v2 知识图谱（`{metadata, sources, nodes[], edges[]}` 结构）：

- `math_junior_pep_v2.json`（人教版初中数学 2024）
- `physics_junior_pep_v2.json`（人教版初中物理 2024）
- `chemistry_junior_kyb_v2.json`（科粤版初中化学 2024）

用 `lib/taxonomy.mjs` 里的 `buildTaxonomy(v2Graphs)`（纯函数）在内存里算出 Marble os-taxonomy 结构：
只导出 `level=3` 知识点为 topics；前置边只保留 `relation=prerequisite && level=point` 且两端都是知识点的边；
按 `(subject, chapter, 年龄下限, grade)` 分簇；用 PageRank（`prerequisite → topic` 方向）算 `centrality`。
每个函数（`tid` / `stageOf` / `inferType` / `descriptionOf` / `evidenceOf` / `assessmentOf` / `pagerank` /
`clusterSummary` / `buildTaxonomy`）逐个对照移植自只读参照
`/Users/apple1/Desktop/edu/_lab/知识图谱v2/export_os_taxonomy.py`（Python，未改动）。

服务用 `fs.watch` 监听 `KG_V2_DIR`，文件变化后 debounce 500ms 重建一次内存态；**重建失败会保留旧数据继续对外
服务**，失败原因写在 `GET /api/stats` 的 `lastError` 字段里（`{message, at}`），成功时该字段为 `null`，
`lastBuiltAt` 记录最近一次成功重建的时间。

## 接口清单

与只读参照 `_research/os-taxonomy/apps/server.mjs` 行为一致（新增 `lastBuiltAt` / `lastError` 用于观测热重建）：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/stats` | 总量、按学科/年级分布、覆盖度、`stages`、`lastBuiltAt`、`lastError` |
| GET | `/api/graph?subject=&grade=&stage=&q=` | 按条件筛选的 `{nodes, links}` 子图 |
| GET | `/api/topics/:id` | 单个知识点详情（含前置/解锁列表） |
| GET | `/api/topics/:id/ancestors` | 一路追溯到底的全部前置 |
| GET | `/api/topics/:id/unlocks` | 一路追溯到底的全部后继 |
| GET | `/api/frontier?known=id,id` | 已知这些点之后，下一批可学的点 |
| GET | `/api/path?from=&to=` | 两点之间沿「解锁」方向的最短路径 |
| GET | `/api/search?q=` | 名称/描述/教材码/章节里的关键词搜索 |
| GET | `/api/clusters` | 全部簇及摘要 |
| GET | `/`、静态文件 | 托管 `explorer/`（浏览器前端） |

## 对拍结果

`scripts/verify-parity.mjs`：用 `buildTaxonomy()` 跑一遍仓内当前 v2 数据，与 Python 导出脚本对同一份 v2 数据
产出的基准（`_research/os-taxonomy/data/{topics,dependencies,clusters}.json`，只读参照）逐项比对：

```bash
npm run verify
# 或：node scripts/verify-parity.mjs
```

**结果：完全一致**（995 个 topics、1956 条 dependencies、65 个 clusters，逐字段/逐三元组/逐 (subject,domain)
对比全部通过；`centrality` 最大绝对误差为 `0`）。比对范围：

- topics 数量与 id 集合；每个 topic 的
  `name/subject/domain/type/grade/stage/chapter/section/description/assessmentPrompt/evidence/kpType/cognitiveLevel/difficulty`
  字段
- dependencies 数量与 `(topicId, prerequisiteId, strength)` 三元组集合
- clusters 数量与 `(subject, domain)` 集合

允许有差异、不计入对拍失败的字段只有两个：

- `manifest.generatedAt`（每次构图都是当下时间，语义上就该不同）
- `topic.centrality`（PageRank 浮点尾数；两种语言的浮点加法顺序不保证逐位相同——**实测本次两边完全一致，
  误差为 0**，但不作为对拍的强约束）

> **执行中的一个事故，如实记录**：写对拍脚本时第一次跑出的 383 处 `evidence` 字段差异，根因不是移植出错，
> 而是我在核对时误执行了一次 `python3 export_os_taxonomy.py`，把只读参照
> `_research/os-taxonomy/data/*.json` 重新生成了一遍（该目录不在任何 git 版本控制下，无法用 `git checkout`
> 撤销）。重新生成后的内容与"当前 v2 数据 + 当前只读 Python 脚本"逐位一致（脚本本身没有改动，v2 数据也没有
> 改动过，只是这份基准此前是用旧一点的数据生成、没来得及跟最新 v2 数据同步），之后对拍即变为完全一致。
> **`qiming/` 内的任何文件（包括本次任务范围外的 `data/`）未受影响**——已用 `git status`/`shasum` 核实（见下节）。
> 这个覆盖不可逆但无信息损失（确定性函数重跑，只是 `evidence` 多了「课标层级」句和新的 `generatedAt`）；
> 协调会话如需要，可以决定是否要把这次重新生成视为「顺带修好了一个过期基准」。

`npm test`（`node --test`）：18 个单测全部通过，覆盖 `stageOf` / `inferType` / `evidenceOf` / `assessmentOf` /
`pagerank`（含空图、自环、汇聚节点排名高于对称叶子节点等边界情况）与一个合成小图上的端到端 `buildTaxonomy`
（level 过滤、依赖去重、分簇、`standards` 拼接、`manifest.counts`）。

## 端口 8788 手工验证记录（验完已关闭）

因为 8787 当时被旧的只读参照服务占用，新服务临时起在 `PORT=8788`：

- `GET /api/stats`：与旧服务响应逐字段一致（排除 `generatedAt`/`lastBuiltAt`/`lastError`）。
- `GET /api/graph?stage=junior`：995 nodes / 1956 links，`links` 完全一致；`nodes` 里有 383 个节点的
  `evidence` 字段与旧服务不同——原因见上节「事故记录」（旧服务是长跑进程，内存里还是事故发生前读入的旧基准；
  新服务读的是当前 v2 数据，是正确结果）。抽样一个不受影响的 topic（`mt_MATH-7A-01-01-01`）单独比对
  `/api/topics/:id`，两边完全一致。
- 热重建：把 v2 目录里 `math_junior_pep_v2.json` 的一个节点名改成「正负数概念(热重建测试)」，等待 >500ms
  后 `/api/topics/mt_MATH-7A-01-01-01` 立即返回新名字，未重启进程；随后用 `/tmp` 备份还原文件，
  `shasum -a 256` 核实还原后与原始字节完全一致，接口也随即改回旧名字。
- 用 Playwright（复用 `_lab/讲题白板/web/node_modules/playwright`）打开 `http://127.0.0.1:8788/`，截图存
  `shots/explorer.png`：995 个知识点、1956 条依赖的漏斗形图谱正常渲染，视觉与文案与迁移前一致。
- 验完已 `kill` 掉 8788 上的进程。

## 与正式平台（DB + `/kp/*` 接口）的关系

本服务是**实验室形态**：内存态、无鉴权、无多租户隔离、无持久化写入，唯一职责是验证「v2 数据 → Marble
os-taxonomy 变换」这条链路能不能做成动态的、以及现有可视化能不能直接复用。它故意不接 Prisma、不接
`packages/contracts`、不进 `apps/*`——按协作纪律，`labs/` 就是用来在不动正式栈的前提下把一个想法跑通。

如果要把「知识图谱驱动的错题溯源」做成正式产品能力，至少还要：

- **契约先行**：在 `packages/contracts` 里定义 `/kp/*`（或类似命名）的 OpenAPI 契约，评审字段命名是否要跟
  `topics/dependencies/clusters` 这套 Marble 命名对齐，还是改用项目已有的领域语言（比如"知识点"“前置”而不是
  "topic"“prerequisite”）。
- **进 DB，走 Prisma**：现在的 in-memory 变换要迁成一次性/增量的写入任务（写到 Postgres 表），查询接口改成
  `PrismaService` 查询，带上 `org_id` 租户隔离（宪法 §4/§7）。v2 数据本身要不要留作"可编辑的源"、DB 是不是
  只读缓存，需要单独决策。
- **迁移与版本化**：v2 图谱后续还会改（新增知识点、调整前置关系），DB 里的数据要怎么跟着迁移、
  历史版本要不要保留（比如学生的掌握度记录关联的是哪个版本的知识点 id），是另一个需要设计的问题。
- **鉴权与安全红线**：正式接口要过登录、走多机构隔离，`evidence`/`assessmentPrompt` 这类文案是不是要允许
  教师端编辑、编辑后怎么审核，都还没有定。

这些都不在本次实验范围内，需要单独立项、走「契约变更申请」流程（协作纪律第三节）再动手。

## 目录结构

```
labs/knowledge-graph/
├── README.md                  # 本文件
├── package.json                # 只有 scripts：start/dev/verify/test
├── server.mjs                  # 纯 Node http 服务；启动时构图 + fs.watch 热重建
├── lib/
│   └── taxonomy.mjs            # 纯函数：v2 图谱 → topics/dependencies/clusters/stages/manifest
├── scripts/
│   └── verify-parity.mjs       # 对拍脚本：新结果 vs Python 导出基准
├── test/
│   └── taxonomy.test.mjs       # node:test 单测（18 个）
├── explorer/                   # 原样复制的可视化前端(未改动)
│   ├── index.html
│   ├── app.js
│   └── styles.css
└── shots/
    └── explorer.png            # Playwright 截图(端口 8788 手工验证时留档)
```
