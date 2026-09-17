# 管理端实验室

侧栏「实验室」(`/lab`)有两块:

## 实验服务(链接卡片,代码在仓库 `labs/`)

不是静态文件,是要单独起的本地/内网服务;管理端只放入口,地址由 `VITE_LAB_KG_URL` / `VITE_LAB_LECTURE_URL` 覆盖(见 `.env.example`)。登记在 `src/pages/lab-exhibits.ts` 的 `LAB_SERVICES`。

| 卡片 | 代码 | 起法 | 缺省地址 |
|---|---|---|---|
| 初中数理化知识图谱(动态) | `labs/knowledge-graph/` | `node server.mjs` | http://127.0.0.1:8787 |
| 讲题白板(AI 自动讲题) | `labs/lecture-board/` | `npm run dev` | http://localhost:4311 |

## 讲解件展台(单文件 HTML,本目录)

三道试跑讲解件(圆 / 浮力 / 平行四边形)。登记在 `src/pages/lab-exhibits.ts` 的 `LAB_EXHIBITS`。

- 开发:`http://localhost:5173/lab/<file>.html`
- 生产:`http://<IP>/admin/lab/<file>.html`

不要把文件放到仓库根 `labs/`(那边永不部署)。
