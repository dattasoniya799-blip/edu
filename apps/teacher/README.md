# @qiming/teacher · 教师端(B1 脚手架 + B3 题库/录题编辑器)

Vite + React18 + TS,结构与 admin 端一致(`src/auth` + `src/api.ts` + `src/mocks` 全量 msw)。

## 怎么跑

```bash
npm install
npm run dev          # http://localhost:5174,默认 mock 模式
npm run build
npm run test         # vitest 单测(B3:表单校验/数据变换/快捷插入)
npm run test:mock    # msw/node 冒烟(同一份 handlers,含 B3 录题全链路)
```

- mock 登录:教师 `13800000002 / Teacher@123`(真实模式同 seed 账号);`VITE_USE_MOCK=false` 时代理到 A1 后端(`.env.example`)。

## 页面

- 登录页(三角色 Tab,视觉=原型;学生 Tab 指引到平板端)
- Shell:浅色侧栏(教 学/学 生分组)+ topbar
- 工作台(我的课程 + 待复核统计,接 mock)、我的课程/资源库/学情分析(空壳占位)
- **题库维护 `/bank`**(B3,原型 t-bank)
- **录题编辑器 `/bank/new` `/bank/:id/edit`**(B3,原型 t-editor)

## B3 · 题库 + LaTeX 录题编辑器

页面清单(`src/pages/bank/`):

| 文件 | 内容 |
| --- | --- |
| `BankList.tsx` | 题库列表:左侧图谱筛选树(图谱选择→年级→章节/节点,`/kp/graphs` `/kp/nodes`)+ 题目卡(TexText 题干、难度点、三维标签胶囊、状态)+ 搜索/题型/难度/状态筛选 + 分页;草稿卡可直接「入库」 |
| `EditorPage.tsx` | 录题编辑器:元信息栏(学段/学科/教材/章节/题型/难度 + 三维标注)、双栏源码/实时预览(9 个工具条插入片段同原型)、题干插图直传、题型联动(选项区 / 填空答案 / 参考答案+rubric 行编辑)、保存草稿 / 提交入库 |
| `components/TagPickerModal.tsx` | 三维标签选择器:弹层内按图谱分 Tab(教材知识点/解题能力/解题策略)勾选节点 |
| `lib/{snippets,transform,validate,upload}.ts` | 纯函数:快捷插入、表单↔QuestionInput 变换、草稿/入库两档校验、/uploads/sts 两步直传 |

验收项映射:

- 录入原型含图解答题 → 预览 → 提交 → 列表回显:`scripts/mock-smoke.mts` 跑通同一链路(sts 签发 → PUT 假端点 → POST /questions → publish → 列表/筛选命中);浏览器内即 `/bank/new` 全流程
- 公式语法错误红色提示:预览均经 `<TexText/>`(内置红色 mono 错误提示)
- rubric 必填校验(解答题)、tagNodeIds ≥1 教材知识点:`lib/validate.ts`(A3 同口径,前端先拦),vitest 覆盖
- 聚焦态(focus:border-primary)与快捷插入(光标处插入+焦点保持)可用;颜色全部来自 design-tokens(无裸色值)
- 每页空态(EmptyState)+ 加载骨架(Skeleton);`npm run build` 通过、vitest 27 例全绿

mock 说明:`src/mocks/` 中 `/questions*` 为**有状态** mock(POST/PUT/DELETE/publish 实改内存数据,刷新前列表可回显);`kpNodes` 扩充了能力(201–204)/策略(301–303)维节点,与 seed 30 题的 tags 同口径;`/uploads/sts` 返回的预签名 uploadUrl 由 msw 的 PUT 假端点承接(契约形状同 A3)。

与原型的已知偏差(MVP 裁剪手册 1.1):共享库/「引用到我的题库」、「从 Word 导入」延后不做;左侧树不显示每节点题数(契约无该统计接口);「保存并录下一题」「自动保存」未做(任务卡范围仅保存草稿/提交入库)。

## 覆盖的验收项(B1)

- mock 模式可登录进入工作台,主导航 5 项全部可点;`npm run build` 通过;
- 题库页用真实 seed 口径题干验证 TexText 在浏览器内渲染。
