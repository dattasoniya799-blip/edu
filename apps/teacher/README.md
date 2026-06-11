# @qiming/teacher · 教师端(B1 脚手架)

Vite + React18 + TS,结构与 admin 端一致(`src/auth` + `src/api.ts` + `src/mocks` 全量 msw)。

## 怎么跑

```bash
npm install
npm run dev          # http://localhost:5174,默认 mock 模式
npm run build
npm run test:mock    # msw/node 冒烟(同一份 handlers)
```

- mock 登录:教师 `13800000002 / Teacher@123`(真实模式同 seed 账号);`VITE_USE_MOCK=false` 时代理到 A1 后端(`.env.example`)。

## 页面

- 登录页(三角色 Tab,视觉=原型;学生 Tab 指引到平板端)
- Shell:浅色侧栏(教 学/学 生分组)+ topbar
- 工作台(我的课程 + 待复核统计,接 mock)、题库维护(前 5 题经 `<TexText/>` 渲染 LaTeX/mhchem,验证公式链路)、我的课程/资源库/学情分析(空壳占位)

## 覆盖的验收项

- mock 模式可登录进入工作台,主导航 5 项全部可点;`npm run build` 通过;
- 题库页用真实 seed 口径题干验证 TexText 在浏览器内渲染。
