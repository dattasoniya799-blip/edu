# @qiming/admin · 管理员端(B1 脚手架)

Vite + React18 + TS。类型/客户端来自 `@qiming/contracts`(alias 指向源码),UI 来自 `@qiming/ui`。

## 怎么跑

```bash
npm install
npm run dev          # http://localhost:5173,默认 mock 模式(msw)
npm run build        # tsc --noEmit + vite build
npm run test:mock    # msw/node 冒烟:登录→/me→列表接口(与浏览器同一份 handlers)
```

- **mock 开关**:`VITE_USE_MOCK`(见 `.env.example`)。非 `false` 即启用 msw;`VITE_USE_MOCK=false npm run dev` 时 `/api` 代理到 `VITE_API_TARGET`(默认 `http://localhost:3000` 的 A1 后端)。
- mock 登录:管理员 `13800000001 / Admin@123`(真实模式同 seed 账号)。
- msw handlers 按 `packages/contracts/openapi.yaml` **全量**实现,数据集中在 `src/mocks/data.ts`(W0 seed 口径:启明演示机构、2 教师、12 学生、30 题…)。

## 结构

- `src/auth/`:AuthProvider(token 内存+localStorage,401 统一跳登录)+ token 存取
- `src/api.ts`:contracts `createClient()` 唯一出口(禁止手写 fetch)
- `src/pages/`:登录页(三角色 Tab,视觉=原型)、Shell(浅色侧栏+topbar)、数据总览/教师/学生(接 mock 数据)、课程/AI 用量/设置(空壳占位)
- `tailwind.config.ts`:仅引用 `@qiming/ui` 的 design-tokens 预设

## 覆盖的验收项

- mock 模式可登录进入工作台,主导航 6 项(总览/教师/学生/课程/AI 用量/设置)全部可点;
- `npm run build` 通过;`VITE_USE_MOCK=false` 时经 dev 代理可真实登录 A1 后端(已回归)。
