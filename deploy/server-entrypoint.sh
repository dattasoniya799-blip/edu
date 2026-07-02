#!/bin/sh
# 启明智学 · server 容器入口(D3)
# 1) 默认启动前执行 prisma migrate deploy(幂等,应用 prisma/migrations 下未执行的迁移);
#    置 AUTO_MIGRATE=0 可跳过(如需人工控制迁移窗口,改为 docker compose exec server npx prisma migrate deploy)。
# 2) 以与 npm start 完全一致的方式启动(tsconfig-paths 解析 @qiming/contracts → dist/packages/...)。
set -e

if [ "${AUTO_MIGRATE:-1}" = "1" ]; then
  echo "[entrypoint] prisma migrate deploy ..."
  npx prisma migrate deploy
fi

exec node -r tsconfig-paths/register dist/apps/server/src/main.js
