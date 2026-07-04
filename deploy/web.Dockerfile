# syntax=docker/dockerfile:1
# =============================================================================
# 启明智学 · 前端三端(student/admin/teacher)+ nginx 生产镜像 —— D3
#
# 构建上下文必须是【仓库根】(三端经 vite alias + tsconfig paths 引用 packages/ 源码):
#   docker build -f deploy/web.Dockerfile .
# 方案:三端各自独立构建阶段(各自 npm ci 层按各自 package-lock 缓存,互不牵连,
# 改动单端不重装其它端依赖),产物合入同一 nginx 镜像,三个 server 块分端口托管。
#
# 关键:VITE_USE_MOCK=false 必须显式给定 ——
#   - main.tsx 的 MSW mock 是 opt-in('true' 才开),生产构建开了会直接 throw;
#   - 但 teacher 监控页 source.ts 判定是 `!== 'false'` 即 mock,不设置会静默跑假数据。
# =============================================================================

# ---------- 共享包:安装 packages/ui 依赖(qrcode/katex 及其类型,从 ui 源码就近解析) ----------
FROM node:22-slim AS pkgs
WORKDIR /repo
COPY packages/ui/package.json packages/ui/package-lock.json packages/ui/
RUN cd packages/ui && npm ci
# contracts 无运行时依赖(纯类型 + 生成的 api-types),拷源码即可
COPY packages ./packages

# ---------- 学生端 ----------
FROM node:22-slim AS build-student
ENV VITE_USE_MOCK=false
WORKDIR /repo/apps/student
COPY apps/student/package.json apps/student/package-lock.json ./
RUN npm ci
COPY --from=pkgs /repo/packages /repo/packages
COPY apps/student ./
RUN npm run build

# ---------- 管理端(子路径 /admin/,同托管在 80 端口下) ----------
FROM node:22-slim AS build-admin
ENV VITE_USE_MOCK=false
ENV VITE_BASE=/admin/
WORKDIR /repo/apps/admin
COPY apps/admin/package.json apps/admin/package-lock.json ./
RUN npm ci
COPY --from=pkgs /repo/packages /repo/packages
COPY apps/admin ./
RUN npm run build

# ---------- 教师端(子路径 /teacher/,同托管在 80 端口下) ----------
FROM node:22-slim AS build-teacher
ENV VITE_USE_MOCK=false
ENV VITE_BASE=/teacher/
WORKDIR /repo/apps/teacher
COPY apps/teacher/package.json apps/teacher/package-lock.json ./
RUN npm ci
COPY --from=pkgs /repo/packages /repo/packages
COPY apps/teacher ./
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
