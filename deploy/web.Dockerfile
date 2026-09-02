# syntax=docker/dockerfile:1
# =============================================================================
# 启明智学 · 前端三端(student/admin/teacher)+ nginx 生产镜像 —— D3(2026-08-31 npm workspaces)
#
# 构建上下文必须是【仓库根】(三端经 vite alias + tsconfig paths 引用 packages/ 源码):
#   docker build -f deploy/web.Dockerfile .
#
# workspaces 布局:三端 + packages/ui(katex/qrcode 及其 @types 供 ui 源码就近编译)的依赖
# 由根 lockfile 在 deps 阶段一次 npm ci 装齐,三个构建阶段共享该层。
# 取舍:统一 lockfile 后,任一端改依赖都会使共享装依赖层失效(旧版"改单端不重装其它端"
# 的缓存粒度不再存在,已接受;三端构建阶段本身仍并行)。
#
# 关键:VITE_USE_MOCK=false 必须显式给定 ——
#   - main.tsx 的 MSW mock 是 opt-in('true' 才开),生产构建开了会直接 throw;
#   - 但 teacher 监控页 source.ts 判定是 `!== 'false'`,不设置会静默跑假数据。
# =============================================================================

# ---------- 共享依赖:根 lockfile 一次装齐三端 + ui ----------
FROM node:22-slim AS deps
WORKDIR /repo
# workspaces 依赖树清单:根 lockfile + 全部 workspace 的 package.json(缺一 npm ci 会报森林不一致)
COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/
COPY apps/admin/package.json apps/admin/
COPY apps/teacher/package.json apps/teacher/
COPY apps/student/package.json apps/student/
COPY labs/playground/package.json labs/playground/
COPY packages/contracts/package.json packages/contracts/
COPY packages/ui/package.json packages/ui/
# ui 不带 --omit=dev:其 devDependencies 里的 @types/katex、@types/qrcode 是三端 tsc 编译
# ui 源码所必需(contracts 无运行时依赖,拷源码即可,无需单列安装)
RUN npm ci --workspace=apps/student --workspace=apps/admin --workspace=apps/teacher \
      --workspace=packages/ui
COPY packages ./packages

# ---------- 学生端 ----------
FROM deps AS build-student
ENV VITE_USE_MOCK=false
COPY apps/student ./apps/student
WORKDIR /repo/apps/student
RUN npm run build

# ---------- 管理端(子路径 /admin/,同托管在 80 端口下) ----------
FROM deps AS build-admin
ENV VITE_USE_MOCK=false
ENV VITE_BASE=/admin/
COPY apps/admin ./apps/admin
WORKDIR /repo/apps/admin
RUN npm run build

# ---------- 教师端(子路径 /teacher/,同托管在 80 端口下) ----------
FROM deps AS build-teacher
ENV VITE_USE_MOCK=false
ENV VITE_BASE=/teacher/
COPY apps/teacher ./apps/teacher
WORKDIR /repo/apps/teacher
RUN npm run build

# ---------- nginx:三端静态托管 + API/WS/上传回看反代 ----------
FROM nginx:1.27-alpine
COPY deploy/nginx/qiming.conf /etc/nginx/conf.d/default.conf
COPY --from=build-student /repo/apps/student/dist /usr/share/nginx/html/student
COPY --from=build-admin   /repo/apps/admin/dist   /usr/share/nginx/html/admin
COPY --from=build-teacher /repo/apps/teacher/dist /usr/share/nginx/html/teacher
# 单端口·路径分端:80 端口下 / 学生、/admin/ 管理、/teacher/ 教师(见 nginx/qiming.conf)
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:80/ || exit 1
