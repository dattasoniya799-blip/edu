# 本地实验专用,永不部署

`apps/lab` 是功能三级流水线「本地实验(lab)→ 系统内测(beta,白名单)→ 正式(ga)」的第一级:
在这里试新想法、搭一次性原型、验证交互,**跑通了再进服务端功能目录(`apps/server/src/features/feature-catalog.ts`)**
以 `off` 或 `beta` 起步,由管理端「实验室管理」放行。

## 边界(改之前先看)

- **不进部署**:`deploy/` 下的 Dockerfile / nginx / compose 一律不收本端,生产镜像里不存在 lab。
- **不进 CI**:没有 vitest,不参与三端的 build + test 门禁。想写断言就写在对应的正式端里。
- **不接生产数据**:只连本地后端或纯前端假数据;要真实数据请在正式端做。
- 需要仓库外的脚本 / 模型实验(OCR 精度测试、FSRS 模拟等)时,用工作区根目录的 `_lab/`,不要塞进这里。

## 起服务

```bash
npm install
npm run dev      # http://localhost:5176
npm run build    # tsc --noEmit && vite build(仅本地自检,产物不发布)
```

契约类型与 UI 组件按三端同一口径引用(vite / tsconfig 别名):

```ts
import type { MyFeatureDto } from '@qiming/contracts';
import { Button, Card } from '@qiming/ui';
```

## 加一个实验

1. 在 `src/experiments/` 下建一个目录放你的组件;
2. 在 `src/experiments/registry.ts` 的 `EXPERIMENTS` 里登记一条(标题、一句话说明、负责人、状态);
3. 首页会自动列出来。实验做完就删,别让列表变成坟场。
