# syntax=docker/dockerfile:1
# =============================================================================
# 启明智学 · 后端(NestJS + Prisma)生产镜像 —— D3
#
# 构建上下文必须是【仓库根】(server 经 tsconfig paths 引用 ../../packages/contracts 源码):
#   docker build -f apps/server/Dockerfile .
# 多阶段:build(全量依赖 + prisma generate + nest build)
#       → proddeps(仅生产依赖 + prisma generate;另装 prisma CLI/tsx 供迁移与 init:prod)
#       → runtime(node:22-slim,非 root,HEALTHCHECK /healthz)
#
# 运行时布局(WORKDIR /app,等价于源码树的 apps/server/):
#   dist/apps/server/src/main.js   nest build 产物(rootDir 跨仓库根,故有 apps/server 前缀)
#   dist/packages/contracts/...    共享契约编译产物(tsconfig-paths 运行时按 tsconfig.json 映射解析)
#   src/                           AI 配置(src/ai/config,config-loader 按 <cwd>/src/ai/config 解析)
#                                  与 init:prod 复用的 password.util 源码(tsx 直跑 TS)
#   prisma/ tools/                 迁移 SQL 与生产初始化脚本
#   /app/storage                   STORAGE_DRIVER=local 落盘目录(compose 挂持久卷)
# =============================================================================

# ---------- 阶段 1:全量依赖 + 编译 ----------
FROM node:22-slim AS build
WORKDIR /repo/apps/server
# argon2 有预编译二进制,正常无需工具链;装上 python3/make/g++ 作为兜底(仅本阶段,不进最终镜像)
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates openssl \
  && rm -rf /var/lib/apt/lists/*
COPY apps/server/package.json apps/server/package-lock.json ./
RUN npm ci
# 共享包源码(tsconfig include 覆盖 ../../packages/contracts/src)
COPY packages/contracts /repo/packages/contracts
COPY apps/server/tsconfig.json apps/server/nest-cli.json ./
COPY apps/server/prisma ./prisma
COPY apps/server/src ./src
RUN npx prisma generate && npm run build \
  # 产物自检:入口与契约编译产物必须存在(start 脚本按此路径运行)
  && test -f dist/apps/server/src/main.js \
  && test -f dist/packages/contracts/src/index.js

# ---------- 阶段 2:仅生产依赖 ----------
FROM node:22-slim AS proddeps
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates openssl \
  && rm -rf /var/lib/apt/lists/*
COPY apps/server/package.json apps/server/package-lock.json ./
# prisma CLI(migrate deploy)与 tsx(npm run init:prod)是 devDependencies;
# 生产镜像运维需要这两个工具,故 --no-save 追加安装(版本与 package-lock 锁定值一致,
# 不改动仓库 package.json)。dotenv 已由 @nestjs/config 传递依赖提供。
RUN npm ci --omit=dev \
  && npm install --no-save prisma@5.22.0 tsx@4.22.4 \
  && npm cache clean --force
COPY apps/server/prisma ./prisma
# 在生产 node_modules 里生成 Prisma Client(与 runtime 同 base 镜像,引擎二进制兼容)
RUN npx prisma generate

# ---------- 阶段 3:运行时 ----------
FROM node:22-slim AS runtime
ENV NODE_ENV=production \
    # start 脚本同款:tsconfig-paths 以 dist/apps/server 为 baseUrl 解析 @qiming/contracts
    TS_NODE_BASEURL=./dist/apps/server \
    PORT=3000
WORKDIR /app
# openssl:Prisma 引擎依赖;ca-certificates:出站 HTTPS(LLM 网关等)
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates openssl \
  && rm -rf /var/lib/apt/lists/*
COPY --from=proddeps --chown=node:node /app/node_modules ./node_modules
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
