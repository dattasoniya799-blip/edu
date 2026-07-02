#!/usr/bin/env bash
# =============================================================================
# 启明智学 · PostgreSQL 备份脚本(D3)
# 在 postgres 容器内执行 pg_dump(custom 格式,自带压缩),落到宿主 BACKUP_DIR,
# 并清理超过 KEEP_DAYS 天的旧备份。
#
# 用法(在仓库根执行):
#   bash deploy/backup.sh
# 可用环境变量覆盖(默认值与 docker-compose.prod.yml / .env.prod.example 对齐):
#   COMPOSE_FILE_PATH=deploy/docker-compose.prod.yml
#   ENV_FILE=deploy/.env.prod
#   PROJECT=qiming-prod          # compose 项目名(-p);本机验证栈传 qiming-prod-test
#   BACKUP_DIR=deploy/backups
#   KEEP_DAYS=14                 # 保留天数
#
# crontab 示例(每天 02:30,root 或 docker 组用户;写绝对路径):
#   30 2 * * * cd /opt/qiming && bash deploy/backup.sh >> /var/log/qiming-backup.log 2>&1
#
# 恢复步骤见 deploy/部署手册.md「备份与恢复」。
# =============================================================================
set -euo pipefail

COMPOSE_FILE_PATH="${COMPOSE_FILE_PATH:-deploy/docker-compose.prod.yml}"
ENV_FILE="${ENV_FILE:-deploy/.env.prod}"
PROJECT="${PROJECT:-qiming-prod}"
BACKUP_DIR="${BACKUP_DIR:-deploy/backups}"
KEEP_DAYS="${KEEP_DAYS:-14}"

# 库名/用户与 .env.prod 对齐(未设置则用默认 qiming)
DB_USER="$(grep -E '^POSTGRES_USER=' "$ENV_FILE" 2>/dev/null | cut -d= -f2- || true)"
DB_NAME="$(grep -E '^POSTGRES_DB=' "$ENV_FILE" 2>/dev/null | cut -d= -f2- || true)"
DB_USER="${DB_USER:-qiming}"
DB_NAME="${DB_NAME:-qiming}"

mkdir -p "$BACKUP_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="$BACKUP_DIR/qiming-$STAMP.dump"

echo "[backup] pg_dump $DB_NAME (project=$PROJECT) -> $OUT"
docker compose -p "$PROJECT" -f "$COMPOSE_FILE_PATH" --env-file "$ENV_FILE" \
  exec -T postgres pg_dump -U "$DB_USER" -d "$DB_NAME" -Fc > "$OUT"

# 空文件视为失败(避免静默产出坏备份)
[ -s "$OUT" ] || { echo "[backup] 失败:产出为空 $OUT"; rm -f "$OUT"; exit 1; }
echo "[backup] 完成:$(du -h "$OUT" | cut -f1) $OUT"

# 清理过期备份
find "$BACKUP_DIR" -name 'qiming-*.dump' -type f -mtime +"$KEEP_DAYS" -print -delete | sed 's/^/[backup] 清理过期:/' || true
echo "[backup] 当前保留:$(ls "$BACKUP_DIR" | grep -c '\.dump$' || true) 份"
