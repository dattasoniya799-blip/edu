#!/usr/bin/env bash
# =============================================================================
# 鲸云AI教育平台 · 一键生产部署(在服务器上直接运行,供 Workbench / 云助手使用)
# 适用场景:客户端 SSH 被边缘封锁,改由服务器自身拉取代码并部署。
#
# 用法(在服务器 /opt/qiming 仓库根执行,机密项用环境变量传入,勿写进公开仓库):
#   LLM_API_KEY='sk-xxx' ORG_NAME='某某教育' ADMIN_NAME='王校长' ADMIN_PHONE='139xxxxxxxx' \
#     bash deploy/cloud-deploy.sh
#
# POSTGRES_PASSWORD / JWT_SECRET 由脚本自动生成强随机值,写入 deploy/.env.prod(gitignore,留在服务器)。
# 幂等:可重复执行;.env.prod 已存在则复用,init:prod 已建过则跳过。
# =============================================================================
set -uo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_DIR"

PUBLIC_IP="${PUBLIC_IP:-121.41.70.11}"
COMPOSE="docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.prod"

log() { echo; echo "=== $* ==="; }

log "[0/6] 释放 8082 端口(此前临时借给 SSH,现归还给网页)"
if grep -q '^Port 8082' /etc/ssh/sshd_config 2>/dev/null; then
  sed -i '/^Port 8082$/d' /etc/ssh/sshd_config
  # 保证 22 仍在;重启 sshd 让它释放 8082(不影响带外 Workbench)
  grep -q '^Port 22' /etc/ssh/sshd_config || echo 'Port 22' >> /etc/ssh/sshd_config
  systemctl restart ssh 2>/dev/null || systemctl restart sshd 2>/dev/null || true
  echo "已移除 sshd 的 Port 8082 并重启"
else
  echo "sshd 未占用 8082,跳过"
fi

log "[1/6] 安装 Docker + Compose 插件 + git"
if ! command -v docker >/dev/null 2>&1; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -y
  apt-get install -y docker.io docker-compose-v2 git || apt-get install -y docker.io docker-compose git
fi
systemctl enable --now docker

# 国内服务器连不上 Docker Hub(registry-1.docker.io i/o timeout),配镜像加速(幂等)
if [ ! -f /etc/docker/daemon.json ] || ! grep -q registry-mirrors /etc/docker/daemon.json 2>/dev/null; then
  mkdir -p /etc/docker
  printf '%s\n' '{"registry-mirrors":["https://docker.m.daocloud.io","https://docker.1ms.run","https://hub-mirror.c.163.com","https://mirror.baidubce.com"]}' > /etc/docker/daemon.json
  systemctl restart docker
  sleep 3
  echo "已配置 Docker 国内镜像加速(daocloud/1ms/163/baidu)"
fi
docker version >/dev/null || { echo "!! Docker 未就绪,终止"; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "!! docker compose 插件缺失,终止"; exit 1; }
echo "Docker: $(docker --version)"

log "[2/6] 生成 deploy/.env.prod"
ENVFILE="deploy/.env.prod"
if [ ! -f "$ENVFILE" ]; then
  PG_PW="$(openssl rand -hex 16)"
  JWT="$(openssl rand -base64 48 | tr -d '\n')"
  cat > "$ENVFILE" <<EOF
NODE_ENV=production
POSTGRES_USER=qiming
POSTGRES_DB=qiming
POSTGRES_PASSWORD=${PG_PW}
DATABASE_URL=postgresql://qiming:${PG_PW}@postgres:5432/qiming
REDIS_URL=redis://redis:6379
PORT=3000
JWT_SECRET=${JWT}
CORS_ORIGINS=http://${PUBLIC_IP},http://${PUBLIC_IP}:8081,http://${PUBLIC_IP}:8082
UPLOAD_PUBLIC_BASE=http://${PUBLIC_IP}
STORAGE_DRIVER=local
UPLOAD_ROOT=/app/storage
LLM_API_KEY=${LLM_API_KEY:-}
LLM_BASE_URL=${LLM_BASE_URL:-https://api.deepseek.com}
LLM_MODEL=${LLM_MODEL:-deepseek-chat}
AI_COMPANION_USE_LLM=true
AI_DIAGNOSIS_USE_LLM=true
EOF
  chmod 600 "$ENVFILE"
  echo "已生成 $ENVFILE(POSTGRES_PASSWORD/JWT_SECRET 已随机生成)"
else
  echo "$ENVFILE 已存在,复用(不覆盖)"
fi

log "[3/6] 构建镜像(首次约 5-10 分钟)"
$COMPOSE build || { echo "!! 构建失败,查看上方日志"; exit 1; }

log "[4/6] 启动服务"
$COMPOSE up -d || { echo "!! 启动失败"; exit 1; }
echo "等待服务健康(最多 90 秒)..."
for i in $(seq 1 18); do
  sleep 5
  if curl -fs http://localhost/healthz >/dev/null 2>&1; then echo "healthz 通过(第 ${i} 次探测)"; break; fi
done

log "[5/6] 初始化真实机构 + 管理员"
if [ -z "${ADMIN_PHONE:-}" ]; then
  echo "!! 未传 ADMIN_PHONE,跳过初始化(可稍后手动运行 init:prod)"
else
  $COMPOSE exec -T server npm run init:prod -- \
    --org-name "${ORG_NAME:-鲸云教育}" \
    --admin-name "${ADMIN_NAME:-管理员}" \
    --admin-phone "${ADMIN_PHONE}" \
    ${ADMIN_PASSWORD:+--admin-password "${ADMIN_PASSWORD}"} \
    2>&1 || echo "(init:prod 返回非0:多为已初始化过的防呆,属正常)"
fi

log "[6/6] 冒烟检查"
sleep 3
echo "-- healthz(应含 db:true redis:true)--"
curl -s http://localhost/healthz; echo
echo "-- 三端端口(应 200)--"
for p in 80 8081 8082; do
  echo "port ${p}: $(curl -s -o /dev/null -w '%{http_code}' http://localhost:${p}/)"
done
echo "-- WebSocket 升级(应 101)--"
curl -s -o /dev/null -w '%{http_code}' "http://localhost/socket.io/?EIO=4&transport=websocket" \
  -H "Connection: Upgrade" -H "Upgrade: websocket" \
  -H "Sec-WebSocket-Version: 13" -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ=="; echo " (socket.io)"
echo "-- 容器状态 --"
$COMPOSE ps

log "部署完成"
echo "访问(在你自己的浏览器):"
echo "  学生端 http://${PUBLIC_IP}"
echo "  管理端 http://${PUBLIC_IP}:8081"
echo "  教师端 http://${PUBLIC_IP}:8082"
echo "管理员账号见上方 [5/6] init:prod 打印的手机号与密码(请立即保存)。"
