# 部署指南

## 目录

- [部署方式概览](#部署方式概览)
- [Docker 部署（推荐）](#docker-部署推荐)
- [手动部署](#手动部署)
- [Nginx 反向代理配置](#nginx-反向代理配置)
- [环境变量安全配置](#环境变量安全配置)
- [数据持久化](#数据持久化)
- [运维与监控](#运维与监控)
- [升级指南](#升级指南)

---

## 部署方式概览

| 方式 | 适用场景 | 复杂度 |
|------|----------|--------|
| Docker（推荐） | 生产环境、快速部署 | 低 |
| 手动部署 | 已有 Node.js 环境 | 中 |
| Docker Compose | 多服务编排 | 中 |

---

## Docker 部署（推荐）

### 构建镜像

```bash
# 在项目根目录执行
docker build -t juma-web:latest .

# 或指定版本
docker build -t juma-web:1.0.0 .
```

Dockerfile 采用**多阶段构建**：
1. **Stage 1**（frontend-builder）：编译 React 前端 → `admin-ui/dist/`
2. **Stage 2**（backend-builder）：编译 TypeScript 后端 → `server/dist/`
3. **Stage 3**（production）：Node 22-alpine 运行时，仅包含编译产物

### 运行容器

```bash
docker run -d \
  --name juma-web \
  --restart unless-stopped \
  -p 3001:3001 \
  -v /data/juma:/app/data \
  -e JWT_SECRET="<强随机密钥-32位以上>" \
  -e APP_SECRET="<移动端签名密钥>" \
  -e DR_JWT_SECRET="<DeepRead密钥-32位以上>" \
  -e EXECUTOR_SHARED_KEY="<执行器共享密钥>" \
  -e NODE_ENV="production" \
  juma-web:latest
```

### 使用 Docker Compose

```yaml
# docker-compose.yml
version: '3.8'

services:
  juma-web:
    image: juma-web:latest
    build: .
    restart: unless-stopped
    ports:
      - "3001:3001"
    volumes:
      - juma-data:/app/data
    environment:
      - NODE_ENV=production
      - JWT_SECRET=${JWT_SECRET}
      - APP_SECRET=${APP_SECRET}
      - DR_JWT_SECRET=${DR_JWT_SECRET}
      - EXECUTOR_SHARED_KEY=${EXECUTOR_SHARED_KEY}
      - DATABASE_URL=file:/app/data/juma.db
    healthcheck:
      test: ["CMD", "wget", "-q", "-O-", "http://localhost:3001/api/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 30s

volumes:
  juma-data:
    driver: local
    driver_opts:
      type: none
      o: bind
      device: /data/juma
```

```bash
# 创建 .env 文件（不提交到 git）
cat > .env << 'EOF'
JWT_SECRET=your_strong_jwt_secret_here
APP_SECRET=your_app_secret_here
DR_JWT_SECRET=your_dr_jwt_secret_here
EXECUTOR_SHARED_KEY=your_executor_key_here
EOF

# 部署
docker-compose up -d

# 查看日志
docker-compose logs -f
```

---

## 手动部署

### 前提条件

```bash
# 安装 Node.js 22
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs

# 验证
node --version   # v22.x.x
npm --version    # 10.x.x
```

### 构建步骤

```bash
# 1. 克隆代码
git clone <repo-url> /opt/juma-web
cd /opt/juma-web

# 2. 构建前端
cd admin-ui
npm install
npm run build
# 产物：admin-ui/dist/

# 3. 构建后端
cd ../server
npm install
npx prisma generate
npm run build
# 产物：server/dist/

# 4. 初始化数据库
DATABASE_URL="file:/data/juma/juma.db" npx prisma db push
DATABASE_URL="file:/data/juma/juma.db" npm run db:seed
```

### 配置 systemd 服务

```ini
# /etc/systemd/system/juma-web.service
[Unit]
Description=Juma Web Server
After=network.target

[Service]
Type=simple
User=nodejs
WorkingDirectory=/opt/juma-web/server
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=5

# 环境变量
Environment="NODE_ENV=production"
Environment="PORT=3001"
Environment="DATABASE_URL=file:/data/juma/juma.db"
Environment="JWT_SECRET=your_strong_jwt_secret"
Environment="APP_SECRET=your_app_secret"
Environment="DR_JWT_SECRET=your_dr_jwt_secret"
Environment="EXECUTOR_SHARED_KEY=your_executor_key"

# 安全限制
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=/data/juma

[Install]
WantedBy=multi-user.target
```

```bash
# 启动服务
sudo systemctl daemon-reload
sudo systemctl enable juma-web
sudo systemctl start juma-web

# 查看状态
sudo systemctl status juma-web
sudo journalctl -u juma-web -f
```

### 前端静态文件服务

前端 `admin-ui/dist/` 目录需要通过 Web 服务器托管（见 Nginx 配置）。

---

## Nginx 反向代理配置

### HTTP 配置（开发/内网）

```nginx
# /etc/nginx/sites-available/juma-web
server {
    listen 80;
    server_name your-domain.com;

    # 前端静态文件
    root /opt/juma-web/admin-ui/dist;
    index index.html;

    # 前端路由（SPA）
    location / {
        try_files $uri $uri/ /index.html;
    }

    # 后端 API 代理
    location /api/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # WebSocket 代理（关键：需要升级协议）
    location /ws/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 3600s;     # WebSocket 长连接超时
        proxy_send_timeout 3600s;
    }
}
```

### HTTPS 配置（生产推荐）

```nginx
server {
    listen 80;
    server_name your-domain.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name your-domain.com;

    # SSL 证书（推荐使用 Let's Encrypt）
    ssl_certificate /etc/letsencrypt/live/your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-RSA-AES128-GCM-SHA256:ECDHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;

    # HSTS
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

    # 前端静态文件
    root /opt/juma-web/admin-ui/dist;
    index index.html;

    # Gzip 压缩
    gzip on;
    gzip_types text/plain text/css application/json application/javascript;
    gzip_min_length 1000;

    # 静态资源缓存
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff2)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
        try_files $uri =404;
    }

    # 前端 SPA 路由
    location / {
        try_files $uri $uri/ /index.html;
    }

    # 后端 API
    location /api/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;

        # API 超时
        proxy_connect_timeout 30s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;

        # 请求体大小限制（文章 HTML 可能较大）
        client_max_body_size 10m;
    }

    # WebSocket 代理
    location /ws/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-Proto https;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }
}
```

```bash
# 验证配置
nginx -t

# 重载配置
systemctl reload nginx
```

### Let's Encrypt 证书申请

```bash
# 安装 certbot
sudo apt install certbot python3-certbot-nginx

# 申请证书
sudo certbot --nginx -d your-domain.com

# 自动续期（certbot 已自动配置 cron）
sudo certbot renew --dry-run
```

---

## 环境变量安全配置

### 生产环境必须修改的密钥

| 变量 | 要求 | 生成方法 |
|------|------|----------|
| `JWT_SECRET` | 32位以上随机字符串 | `openssl rand -hex 32` |
| `APP_SECRET` | 自定义复杂字符串 | `openssl rand -hex 16` |
| `DR_JWT_SECRET` | 32位以上随机字符串 | `openssl rand -hex 32` |
| `EXECUTOR_SHARED_KEY` | 自定义复杂字符串 | `openssl rand -hex 16` |

```bash
# 生成强随机密钥
openssl rand -hex 32
# 输出示例：a3f7c2d4e5b6a1d8f9c0e2b4a6d8f1c3e5b7a9c1d3e5f7a9b1c3d5e7f9a1b3

# 或使用 /dev/urandom
cat /dev/urandom | tr -dc 'a-zA-Z0-9' | fold -w 32 | head -n 1
```

### 密钥存储方案

**方案一：.env 文件（简单部署）**

```bash
# /opt/juma-web/.env（权限 600，不提交到 git）
chmod 600 /opt/juma-web/.env
```

**方案二：系统环境变量（systemd）**

在 `/etc/systemd/system/juma-web.service` 中使用 `EnvironmentFile`：

```ini
[Service]
EnvironmentFile=/etc/juma-web/secrets.env
```

```bash
# /etc/juma-web/secrets.env（权限 600）
chmod 600 /etc/juma-web/secrets.env
```

**方案三：Docker Secrets / Kubernetes Secrets（企业级）**

```bash
# Docker Swarm
echo "your_jwt_secret" | docker secret create jwt_secret -
```

---

## 数据持久化

### SQLite 数据库

SQLite 数据库是**单文件**，需要持久化挂载：

```bash
# Docker
-v /data/juma:/app/data
# 数据库路径：/data/juma/juma.db

# 手动部署
DATABASE_URL="file:/data/juma/juma.db"
```

### 备份策略

```bash
# 方案一：直接复制文件（SQLite 支持热备份）
cp /data/juma/juma.db /backup/juma_$(date +%Y%m%d_%H%M%S).db

# 方案二：使用 SQLite dump（更安全）
sqlite3 /data/juma/juma.db .dump > /backup/juma_$(date +%Y%m%d).sql

# 自动备份（crontab）
0 2 * * * /bin/cp /data/juma/juma.db /backup/juma_$(date +\%Y\%m\%d).db && find /backup -name "juma_*.db" -mtime +30 -delete
```

### 恢复数据

```bash
# 从文件恢复
cp /backup/juma_20260301.db /data/juma/juma.db

# 从 SQL dump 恢复
sqlite3 /data/juma/juma.db < /backup/juma_20260301.sql
```

---

## 运维与监控

### 健康检查

```bash
# 手动检查
curl http://localhost:3001/api/health

# 预期响应
{"code":200,"message":"OK","timestamp":"2026-03-01T12:00:00.000Z"}
```

### 日志管理

```bash
# Docker 日志
docker logs juma-web --tail 100 -f

# systemd 日志
journalctl -u juma-web --since "1 hour ago" -f

# 日志轮转（logrotate）
# /etc/logrotate.d/juma-web
/var/log/juma-web/*.log {
    daily
    rotate 14
    compress
    delaycompress
    missingok
    notifempty
}
```

### 进程监控（PM2，可选）

```bash
# 安装 PM2
npm install -g pm2

# 启动
cd /opt/juma-web/server
pm2 start dist/index.js --name juma-web

# 配置开机自启
pm2 startup
pm2 save

# 监控
pm2 monit
pm2 logs juma-web
```

---

## 升级指南

### 版本升级步骤

```bash
# 1. 备份数据库
cp /data/juma/juma.db /backup/juma_before_upgrade.db

# 2. 拉取新代码
cd /opt/juma-web
git pull origin main

# 3. 重新构建（或拉取新镜像）
docker build -t juma-web:new .

# 4. 停止旧容器
docker stop juma-web

# 5. 运行数据库迁移（如有）
docker run --rm \
  -v /data/juma:/app/data \
  -e DATABASE_URL=file:/app/data/juma.db \
  juma-web:new \
  npx prisma migrate deploy

# 6. 启动新容器
docker run -d \
  --name juma-web-new \
  ... (同原来的启动参数，使用 juma-web:new)

# 7. 验证新版本
curl http://localhost:3001/api/health

# 8. 清理旧容器
docker rm juma-web
docker rename juma-web-new juma-web
```

### 回滚

```bash
# 回滚数据库
cp /backup/juma_before_upgrade.db /data/juma/juma.db

# 回滚容器
docker stop juma-web
docker run -d --name juma-web ... juma-web:previous
```

---

## 执行器客户端部署（Mac Mini）

### 在 Mac Mini 上配置执行器

```bash
# 1. 安装 Node.js（推荐使用 nvm）
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
nvm install 22
nvm use 22

# 2. 克隆代码
git clone <repo-url> ~/juma-executor
cd ~/juma-executor/mac-mini-client
npm install

# 3. 创建启动脚本
cat > ~/start-executor.sh << 'EOF'
#!/bin/bash
export SERVER_URL="https://your-domain.com"
export EXECUTOR_KEY="your_executor_key"
export CLIENT_ID="macmini-$(hostname)-01"
export CLIENT_NAME="$(hostname) Build Machine"
export CLIENT_TAGS="xcode,ios,swift"
export CLIENT_VERSION="1.0.0"
export WORK_DIR="$HOME/workspace"

cd ~/juma-executor/mac-mini-client
npm start
EOF
chmod +x ~/start-executor.sh

# 4. 配置开机自启（LaunchAgent）
cat > ~/Library/LaunchAgents/com.juma.executor.plist << 'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" ...>
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.juma.executor</string>
    <key>ProgramArguments</key>
    <array>
        <string>/bin/bash</string>
        <string>/Users/runner/start-executor.sh</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/Users/runner/juma-executor.log</string>
    <key>StandardErrorPath</key>
    <string>/Users/runner/juma-executor-error.log</string>
</dict>
</plist>
EOF

launchctl load ~/Library/LaunchAgents/com.juma.executor.plist
```

### 验证执行器连接

```bash
# 在管理后台查看
# 访问 http://your-domain.com/tasks → 滚动到"执行器客户端"区域
# 确认 macmini-xxx 显示为"在线"状态
```
