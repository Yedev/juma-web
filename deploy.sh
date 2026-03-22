#!/usr/bin/env bash
set -e

# ── JUMA 一键部署脚本 ────────────────────────────────────
#
# 用法:
#   chmod +x deploy.sh
#   ./deploy.sh          # 默认端口 3001
#   ./deploy.sh 8080     # 自定义端口
#
# 要求: Linux + Docker

APP_NAME="juma-web"
PORT="${1:-3001}"
DATA_DIR="$(pwd)/juma-data"

echo "================================================"
echo "  JUMA 后台管理系统 - 一键部署"
echo "================================================"
echo ""
echo "  容器名:  $APP_NAME"
echo "  端口:    $PORT"
echo "  数据目录: $DATA_DIR"
echo ""

# 检查 Docker
if ! command -v docker &> /dev/null; then
  echo "❌ 未检测到 Docker，请先安装 Docker"
  exit 1
fi

# 创建数据目录（SQLite 持久化）
mkdir -p "$DATA_DIR"

# 停止旧容器
if docker ps -a --format '{{.Names}}' | grep -q "^${APP_NAME}$"; then
  echo "⏹  停止旧容器..."
  docker stop "$APP_NAME" 2>/dev/null || true
  docker rm "$APP_NAME" 2>/dev/null || true
fi

# 构建镜像
echo ""
echo "🔨 构建镜像 (首次较慢，后续有缓存)..."
echo ""
docker build -t "$APP_NAME" .

# 构建启动参数
DOCKER_RUN_ARGS=(
  -d
  --name "$APP_NAME"
  --restart unless-stopped
  -p "${PORT}:3001"
  -v "${DATA_DIR}:/app/data"
)

# 如果存在 .env 文件，则挂载环境变量
if [ -f .env ]; then
  echo "📄 发现 .env 文件，已加载环境变量..."
  DOCKER_RUN_ARGS+=(--env-file .env)
else
  echo "⚠️ 未发现 .env 文件，将使用系统默认配置..."
fi

# 启动容器
echo ""
echo "🚀 启动容器..."
docker run "${DOCKER_RUN_ARGS[@]}" "$APP_NAME"

# 等待启动
echo ""
echo "⏳ 等待服务启动..."
for i in $(seq 1 15); do
  if curl -s "http://localhost:${PORT}/api/health" > /dev/null 2>&1; then
    break
  fi
  sleep 1
done

# 验证
if curl -s "http://localhost:${PORT}/api/health" > /dev/null 2>&1; then
  echo ""
  echo "================================================"
  echo "  ✅ 部署完成!"
  echo ""
  echo "  访问地址:  http://localhost:${PORT}"
  echo "  默认账号:  juma"
  echo "  默认密码:  juma2026"
  echo ""
  echo "  常用命令:"
  echo "    查看日志:  docker logs -f $APP_NAME"
  echo "    停止服务:  docker stop $APP_NAME"
  echo "    重启服务:  docker restart $APP_NAME"
  echo "    删除容器:  docker rm -f $APP_NAME"
  echo "    数据目录:  $DATA_DIR"
  echo "================================================"
else
  echo ""
  echo "⚠️  容器已启动但健康检查未通过，请查看日志:"
  echo "    docker logs $APP_NAME"
fi
