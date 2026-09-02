# labs/playground · 前端实验区(永不部署)

`labs/playground`(包名 `@qiming/lab`,2026-09-02 自 `apps/lab` 迁入)是功能三级流水线
「本地实验(lab)→ 系统内测(beta,白名单)→ 正式(ga)」的第一级:
在这里试新想法、搭一次性原型、验证交互,**跑通了再进服务端功能目录(`apps/server/src/features/feature-catalog.ts`)**
以 `off` 或 `beta` 起步,由管理端「实验室管理」放行。

`apps/` 只放可部署的四个应用;`labs/` 下每个目录是一个独立的实验项目(仍是 npm workspace,
能直接 import `@qiming/ui` / `@qiming/contracts` 源码)。本项目是前端交互实验的公共外壳,
按 `src/experiments/registry.ts` 登记多个实验;需要完全不同技术栈的实验再开 `labs/<另一个>`。

## 边界(改之前先看)

- **不进部署**:`deploy/` 下的 Dockerfile / nginx / compose 一律不收本项目,生产镜像里不存在它。
  两个 Dockerfile 只 COPY 本项目的 `package.json`(npm ci 校验整片 workspace 森林所需),不拷源码、不构建。
- **不进主线门禁**:根 `check:all` 不含本项目;CI 里单独一个 `labs` job 跑 `npm run check:labs`
  (剧本质检 + 动画校验 + build),`continue-on-error`——红了只提示,不拦主线合并。
  没有 vitest;想写断言就写在对应的正式端里。
- **不接生产数据**:只连本地后端或纯前端假数据;要真实数据请在正式端做。
- 需要仓库外的脚本 / 模型实验(OCR 精度测试、FSRS 模拟等)时,用工作区根目录的 `_lab/`,不要塞进这里。

## 起服务

```bash
npm install                    # 在仓库根执行一次即可(workspaces)
npm -w @qiming/lab run dev     # http://localhost:5176
npm run check:labs             # 仓库根:check:scripts + validate:anim + build 三连
```

或 `cd labs/playground` 后直接 `npm run dev` / `npm run build`(tsc --noEmit && vite build,产物不发布)。

契约类型与 UI 组件按三端同一口径引用(vite / tsconfig 别名):

```ts
import type { MyFeatureDto } from '@qiming/contracts';
import { Button, Card } from '@qiming/ui';
```

## 加一个实验

1. 在 `src/experiments/` 下建一个目录放你的组件;
2. 在 `src/experiments/registry.ts` 的 `EXPERIMENTS` 里登记一条(标题、一句话说明、负责人、状态);
3. 首页会自动列出来。实验做完就删,别让列表变成坟场。

当前登记的实验(见 `registry.ts`):**动画课堂**(running,学生上课页)与 **知识点动画**(parked,素材/校验车间)。

## 动画课堂(`src/experiments/dynamic-lecture/`)

学生端上课页 demo:一套播放器读「讲解剧本」,五堂坐标系课(一次函数 / 导数 / 弹簧讲题 / 出租车计费 / 相遇问题)。
需求与验收见 `docs/需求文档/2026-08-31-动画课堂-学生端demo需求.md`。

| 文件 | 职责 |
|---|---|
| `script-schema.ts` | 剧本契约(zod):`kind: concept\|problem`、≥5 拍、`label` 必填、全课至少一拍 `interaction`、引用完整性与表达式可编译性校验 |
| `expr.ts` | 受限表达式安全编译(白名单函数,绝不 eval)+ `reference` 自查算例 |
| `CanvasScene.tsx` | 坐标系场景族渲染,target / current 双轨缓动 |
| `Player.tsx` / `DynamicLecture.tsx` | 上课页(双栏、步骤条、动手拍滑杆、浏览器 TTS 占位)/ 课表 |
| `samples/*.ts` | 五份手写剧本;`samples/index.ts` 是出口 |
| `../../tools/check-scripts.ts` | 质检门:schema + 自查算例 + 讲稿禁词 + 学段术语(八年级禁「斜率/截距」) |

剧本是中枢:以后教师端生成、TTS、分发都读同一份格式,不过质检门的剧本不进播放器。

## 知识点动画

初高中知识点的交互动画在这里生产。动画是**内容资产**,不是前端代码:
产物是零依赖的单文件交互 HTML(原生 HTML/CSS/JS + Canvas 2D,30KB 级),
先落在本端 `public/animations/` 里试玩与人审,通过后再谈上资源库。

### 管线

```
skills/知识点动画-skill.md   →  生成 HTML  →  npm run validate:anim  →  车间页试玩  →  人审
（EVAL 评值不值得做 / PRD    （放进对应       （确定性校验 + 生成       （首页选「知识点
  想清楚 / CODE 硬规范）       学段目录）       manifest.json）          动画」实验）
```

- **skill**:`skills/知识点动画-skill.md`。三段式:EVAL 先给「动态收益 / 交互必要性」打分,
  低分直接拦下不做;PRD 写清定位、误区、单一认知动作、交互流程、分步揭示、反馈文案;
  CODE 是必须遵守的实现规范。PRD 以头部注释形式内嵌在每个 HTML 里留档。
- **校验**:`npm run validate:anim`(`tools/validate-animations.mjs`)。扫
  `public/animations/**/*.html`,逐项检安全红线、必填 meta、重置按钮、色板纪律、触控尺寸、
  脚本语法与文件体积,任一失败退出码非 0;同时生成 `public/animations/manifest.json`。
- **人审**:校验器只管机械规范。数学正确性、首屏是否真的只剩最小可理解单元、
  反馈文案有没有说出不变量,这三样必须人看。

### 目录约定

```
public/animations/
├── manifest.json        # 由 validate:anim 生成,车间页读它;不要手改
├── 初中/<中文文件名>.html
└── 高中/<中文文件名>.html
```

文件名即动画标题;`meta[name=grade]` 必须与所在目录一致。
知识图谱节点写进 `meta[name=kpNodeId]`(取 `data/knowledge-graphs/*.json` 节点的 `code`),
暂时挂不上就留空串,manifest 里会显示「未挂载」,人审时集中补挂。

### 安全规范

一句话:动画在 `<iframe sandbox="allow-scripts">` 里跑,不许有任何外链(含字体)、
不许联网、不许访问宿主窗口、不许写本地存储、不许动态求值 —— 校验器会逐条卡。
