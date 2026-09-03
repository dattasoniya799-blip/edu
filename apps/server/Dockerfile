# syntax=docker/dockerfile:1
# =============================================================================
# 启明智学 · 后端(NestJS + Prisma)生产镜像 —— D3(2026-08-31 迁移至 npm workspaces)
#
# 构建上下文必须是【仓库根】(server 经 tsconfig paths 引用 ../../packages/contracts 源码):
#   docker build -f apps/server/Dockerfile .
#
# workspaces 布局:依赖统一装在仓库根 node_modules(全仓单一 package-lock.json)。
# npm ci 校验 lockfile 与整个 workspace 森林的一致性,所以装依赖前必须 COPY 根 lockfile
# 加上**全部 7 个** workspace 的 package.json(改任一端的依赖都会使装依赖层缓存失效,
# 这是统一 lockfile 的已接受取舍);实际只安装 server 子树:npm ci --workspace=apps/server。
#
# 多阶段:build(全量依赖 + prisma generate + nest build)
#       → proddeps(仅生产依赖 + prisma generate;另装 prisma CLI/tsx 供迁移与 init:prod)
#       → runtime(node:22-slim,非 root,HEALTHCHECK /healthz)
#
# 运行时布局(WORKDIR /app,等价于源码树的 apps/server/):
#   node_modules/                  由仓库根 node_modules 整体拷入(hoist 后依赖都在这层;
#                                  其中 @qiming/* 是指向 ../../apps|packages 的悬空符号链接,
#                                  运行时无人引用 —— contracts 走 tsconfig-paths 的 dist 映射)
#   dist/apps/server/src/main.js   nest build 产物(rootDir 跨仓库根,故有 apps/server 前缀)
#   dist/packages/contracts/...    共享契约编译产物(tsconfig-paths 运行时按 tsconfig.json 映射解析)
#   src/                           AI 配置(src/ai/config,config-loader 按 <cwd>/src/ai/config 解析)
#                                  与 init:prod 复用的 password.util 源码(tsx 直跑 TS)
#   prisma/ tools/                 迁移 SQL 与生产初始化脚本
#   /app/storage                   STORAGE_DRIVER=local 落盘目录(compose 挂持久卷)
# =============================================================================

# ---------- 阶段 1:全量依赖 + 编译 ----------
FROM node:22-slim AS build
WORKDIR /repo
# argon2 有预编译二进制,正常无需工具链;装上 python3/make/g++ 作为兜底(仅本阶段,不进最终镜像)
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates openssl \
  && rm -rf /var/lib/apt/lists/*
# workspaces 依赖树清单:根 lockfile + 全部 workspace 的 package.json(缺一 npm ci 会报森林不一致)
COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/
COPY apps/admin/package.json apps/admin/
COPY apps/teacher/package.json apps/teacher/
COPY apps/student/package.json apps/student/
COPY labs/playground/package.json labs/playground/
COPY packages/contracts/package.json packages/contracts/
COPY packages/ui/package.json packages/ui/
RUN npm ci --workspace=apps/server
# 共享包源码(tsconfig include 覆盖 ../../packages/contracts/src)
COPY packages/contracts ./packages/contracts
COPY apps/server/tsconfig.json apps/server/nest-cli.json apps/server/
COPY apps/server/prisma ./apps/server/prisma
COPY apps/server/src ./apps/server/src
WORKDIR /repo/apps/server
RUN npx prisma generate && npm run build \
  # 产物自检:入口与契约编译产物必须存在(start 脚本按此路径运行)
  && test -f dist/apps/server/src/main.js \
  && test -f dist/packages/contracts/src/index.js

# ---------- 阶段 2:仅生产依赖 ----------
FROM node:22-slim AS proddeps
WORKDIR /repo
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates openssl \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/
COPY apps/admin/package.json apps/admin/
COPY apps/teacher/package.json apps/teacher/
COPY apps/student/package.json apps/student/
COPY labs/playground/package.json labs/playground/
COPY packages/contracts/package.json packages/contracts/
COPY packages/ui/package.json packages/ui/
# prisma CLI(migrate deploy)与 tsx(npm run init:prod)是 devDependencies;
# 生产镜像运维需要这两个工具,故 --no-save 追加安装(版本与 package-lock 锁定值一致,
# 不改动仓库 package.json)。dotenv 已由 @nestjs/config 传递依赖提供。
RUN npm ci --workspace=apps/server --omit=dev \
  && npm install --no-save --workspace=apps/server prisma@5.22.0 tsx@4.23.13 \
  && npm cache clean --force
COPY apps/server/prisma ./apps/server/prisma
# 在生产 node_modules 里生成 Prisma Client(与 runtime 同 base 镜像,引擎二进制兼容)
WORKDIR /repo/apps/server
RUN npx prisma generate

# ---------- 阶段 3:运行时 ----------
FROM node:22-slim AS runtime
ENV NODE_ENV=production \
    # start 脚本同款:tsconfig-paths 以 dist/apps/server 为 baseUrl 解析 @qiming/contracts
    TS_NODE_BASEURL=./dist/apps/server \
    PORT=3000 \
    # 进程时区与机构时区一致(日志时间、Date 本地方法);业务判定(学习时段)另经 ORG_TIMEZONE 显式取值
    TZ=Asia/Shanghai \
    ORG_TIMEZONE=Asia/Shanghai
WORKDIR /app
# openssl:Prisma 引擎依赖;ca-certificates:出站 HTTPS(LLM 网关等);tzdata:让 TZ=Asia/Shanghai 对 Date 本地方法生效
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates openssl tzdata \
  && rm -rf /var/lib/apt/lists/*
COPY --from=proddeps --chown=node:node /repo/node_modules ./node_modules
COPY --from=build --chown=node:node /repo/apps/server/dist ./dist
COPY --chown=node:node apps/server/package.json apps/server/tsconfig.json ./
COPY --chown=node:node apps/server/prisma ./prisma
COPY --chown=node:node apps/server/src ./src
COPY --chown=node:node apps/server/tools ./tools
COPY --chown=node:node deploy/server-entrypoint.sh /usr/local/bin/server-entrypoint.sh
# 本地存储落盘目录(compose 以命名卷挂载;首挂载会继承此处属主 node)
RUN chmod +x /usr/local/bin/server-entrypoint.sh && mkdir -p /app/storage && chown node:node /app/storage
USER node
EXPOSE 3000
# /healthz 在全局前缀之外;db/redis 任一不通(degraded)判不健康
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>r.json()).then(j=>process.exit((j.data??j).status==='ok'?0:1)).catch(()=>process.exit(1))"
# 入口:默认先 prisma migrate deploy(AUTO_MIGRATE=0 关闭)再启动
ENTRYPOINT ["/usr/local/bin/server-entrypoint.sh"]
