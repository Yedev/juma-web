# juma-nginx 独立仓库搭建说明

> 本文档面向接手 nginx 反向代理的同事。目标是把 nginx 从 `juma-web` 的发版流程里拆出来，
> 单独建一个仓库管理。以后新增服务只需在本仓库加一个配置文件，**不再改动 `juma-web`**。
>
> **路由方式：只有一个域名 `chdev.fun`，靠 URL 路径（`/`、`/foo/`、`/bar/`…）转发到不同后端服务。**

## 一、背景与目标

现状：nginx 的配置是**硬编码**在 `juma-web` 仓库的 `.github/workflows/deploy.yml` 里（一段 shell heredoc），
每次给 `juma-web` 打 `v*` tag 部署时都会**整体覆盖重写**服务器上的 nginx 配置。

带来的问题：

- 想加一个新服务（让 nginx 转发到它），必须改 `juma-web` 的部署脚本。
- 在服务器上手动改的配置，下次 `juma-web` 部署就被冲掉。
- nginx（基础设施）和 juma-web（业务应用）的发版耦合在一起。

拆分后的目标：

- nginx 作为**独立的入口基础设施**，有自己的仓库和 GitHub Action。
- 配置按 location 拆分，**一个服务一个文件**，互不干扰。
- 新增服务 = 在本仓库加一个 location 文件并 push，nginx 自动重载，**完全不碰业务仓库**。

## 二、路由方式：单域名 + 路径转发（重要）

因为只有一个域名，整个 nginx 只需要**一个 `server` 块**（监听 443），不同服务通过 `location` 前缀区分：

| 访问路径 | 转发到的后端容器 |
|----------|------------------|
| `https://chdev.fun/` | `juma-web:3001`（主站，根路径兜底） |
| `https://chdev.fun/foo/` | `foo-api:8080`（示例服务） |
| `https://chdev.fun/bar/` | `bar-svc:9000`（示例服务） |

要点：

- **不能**给同一个域名写多个 `server` 块（nginx 会报 "conflicting server name"，只认第一个）。
- 服务之间的隔离用 `location`，而不是 `server`。
- nginx 按**最长前缀**匹配，`/foo/` 永远优先于 `/`，所以 location 文件的加载顺序无所谓。
- 为了「一个服务一个文件」又共用同一个 `server` 块，我们用 nginx 的 `include` 指令：
  `server` 块里 `include /etc/nginx/locations/*.conf;`，每个服务往 `locations/` 丢一个 location 片段。

## 三、新仓库目录结构

建议仓库名 `juma-nginx`（或 `juma-infra`，如果以后还想放别的共享基础设施）。结构如下：

```
juma-nginx/
├── README.md                       # 仓库说明（可直接用本文档内容）
├── nginx/
│   ├── conf.d/
│   │   ├── 00-upgrade-map.conf     # WebSocket 用的 map（http 级，必须在 conf.d）
│   │   └── chdev.fun.conf          # 唯一的 server 块（80→443 跳转 + 443 SSL）
│   ├── locations/
│   │   └── juma-web.conf           # location / → juma-web（一个服务一个文件）
│   └── snippets/
│       └── proxy_common.conf       # 公共 proxy_set_header，被各 location include
└── .github/
    └── workflows/
        └── deploy-nginx.yml        # 部署 workflow
```

## 四、nginx 配置文件

### 4.1 `nginx/conf.d/chdev.fun.conf` —— 唯一的 server 块

```nginx
# HTTP → HTTPS 跳转
server {
    listen 80;
    server_name chdev.fun www.chdev.fun;
    return 301 https://$host$request_uri;
}

# 唯一的 HTTPS 入口；按 URL 路径转发到不同服务
server {
    listen 443 ssl;
    server_name chdev.fun www.chdev.fun;

    ssl_certificate     /etc/nginx/ssl/chdev.fun.pem;
    ssl_certificate_key /etc/nginx/ssl/chdev.fun.key;
    ssl_protocols       TLSv1.2 TLSv1.3;

    # 每个服务一个 location 文件，放在 locations/ 下，自动全部加载
    include /etc/nginx/locations/*.conf;
}
```

### 4.2 `nginx/conf.d/00-upgrade-map.conf` —— WebSocket 支持

`/ws/executor` 这类 WebSocket 需要根据请求是否带 `Upgrade` 头来设置 `Connection`。
`map` 必须放在 `http` 级（即 `conf.d/` 下，会被自动加载进 http 块）：

```nginx
# 带 Upgrade 头时 Connection=upgrade，否则 close（保持普通 HTTP 的 keep-alive）
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}
```

### 4.3 `nginx/snippets/proxy_common.conf` —— 公共反代头

把所有 location 都要用的 `proxy_set_header` 抽成一个片段，每个 location `include` 它，避免重复、避免漏配：

```nginx
proxy_http_version 1.1;
proxy_set_header Host              $host;
proxy_set_header X-Real-IP         $remote_addr;
proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $scheme;
proxy_set_header Upgrade           $http_upgrade;
proxy_set_header Connection        $connection_upgrade;
```

### 4.4 `nginx/locations/juma-web.conf` —— 主站（根路径兜底）

```nginx
# juma-web 主站，挂在根路径，兜底所有未被其他 location 命中的请求
location / {
    proxy_pass http://juma-web:3001;
    include /etc/nginx/snippets/proxy_common.conf;
}
```

> `proxy_pass http://juma-web:3001` 里的 `juma-web` 是**容器名**，靠 Docker 网络 `juma-net` 的内置 DNS 解析。

## 五、GitHub Actions workflow

### `.github/workflows/deploy-nginx.yml`

```yaml
name: 部署 nginx 反向代理

on:
  push:
    branches: [main]
    paths:
      - 'nginx/**'                              # 只在 nginx 配置变化时触发
      - '.github/workflows/deploy-nginx.yml'
  workflow_dispatch:                            # 支持手动触发（重新部署）

env:
  NETWORK: juma-net
  REMOTE_DIR: /opt/juma-nginx

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - name: 检出代码
        uses: actions/checkout@v4

      - name: 拷贝 nginx 配置到服务器
        uses: appleboy/scp-action@v0.1.7
        with:
          host: ${{ secrets.ALIYUN_HOST }}
          username: ${{ secrets.ALIYUN_USER }}
          key: ${{ secrets.ALIYUN_SSH_KEY }}
          source: "nginx/conf.d/*,nginx/locations/*,nginx/snippets/*"
          target: ${{ env.REMOTE_DIR }}
          strip_components: 1                   # 去掉 nginx/ 前缀，conf.d/locations/snippets 直接落到 target 下

      - name: 部署 nginx 容器
        uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.ALIYUN_HOST }}
          username: ${{ secrets.ALIYUN_USER }}
          key: ${{ secrets.ALIYUN_SSH_KEY }}
          envs: NETWORK,REMOTE_DIR
          script: |
            mkdir -p $REMOTE_DIR/conf.d $REMOTE_DIR/locations $REMOTE_DIR/snippets $REMOTE_DIR/ssl

            # 写入 SSL 证书（来自仓库 Secrets）
            cat > $REMOTE_DIR/ssl/chdev.fun.pem << 'CERT'
            ${{ secrets.TLS_CERT }}
            CERT
            cat > $REMOTE_DIR/ssl/chdev.fun.key << 'KEY'
            ${{ secrets.TLS_KEY }}
            KEY
            chmod 600 $REMOTE_DIR/ssl/chdev.fun.key

            # 创建 Docker 网络（已存在则跳过）
            docker network create $NETWORK 2>/dev/null || true

            # 重启 nginx 容器
            docker stop juma-nginx 2>/dev/null || true
            docker rm juma-nginx 2>/dev/null || true
            docker run -d \
              --name juma-nginx \
              --restart always \
              --network $NETWORK \
              -p 80:80 \
              -p 443:443 \
              -v $REMOTE_DIR/conf.d:/etc/nginx/conf.d:ro \
              -v $REMOTE_DIR/locations:/etc/nginx/locations:ro \
              -v $REMOTE_DIR/snippets:/etc/nginx/snippets:ro \
              -v $REMOTE_DIR/ssl:/etc/nginx/ssl:ro \
              nginx:alpine
```

与 `juma-web` 旧脚本的区别：

- **没有镜像构建步骤** —— 直接用官方 `nginx:alpine`，无需 Dockerfile、无需登录镜像仓库。
- **配置是仓库里的真实文件**，通过 `scp` 上传，而不是 heredoc 内联。
- 触发条件是 push 到 `main`（且改了 `nginx/**`）或手动触发，而非 `v*` tag。

## 六、需要配置的 GitHub Secrets

在新仓库 `Settings → Secrets and variables → Actions` 里配置以下 5 个（前 3 个和 `juma-web` 仓库里的同名同值）：

| Secret | 用途 |
|--------|------|
| `ALIYUN_HOST` | 服务器 IP / 域名 |
| `ALIYUN_USER` | SSH 登录用户名 |
| `ALIYUN_SSH_KEY` | SSH 私钥 |
| `TLS_CERT` | `chdev.fun` 证书（PEM 内容） |
| `TLS_KEY` | `chdev.fun` 证书私钥 |

> 单域名只需要这**一套证书**。如果 `yedev` 是 GitHub Organization，建议把
> `ALIYUN_HOST` / `ALIYUN_USER` / `ALIYUN_SSH_KEY` 设成 **Organization 级别 Secret**，多个仓库共享。
>
> 注意：`OSS_*`、`ALIYUN_REGISTRY_*` 是 juma-web 应用专用的，**nginx 仓库不需要**。

## 七、与应用仓库的「契约」

nginx 仓库和各应用仓库通过下面这几个约定对接，**必须保持一致**：

| 约定项 | 值 | 说明 |
|--------|-----|------|
| Docker 网络名 | `juma-net` | 所有需要被反代的容器都要挂到这个网络 |
| 后端容器名:端口 | 如 `juma-web:3001` | location 里的 `proxy_pass` 要和应用容器的 `--name` + 端口对得上 |
| 网络创建 | `docker network create juma-net \|\| true` | 两边都幂等执行，谁先部署都行 |

新服务想被 nginx 转发，前提是它的容器也 `--network juma-net`，否则 nginx 用容器名找不到它。

## 八、juma-web 仓库要配合做的改动

拆分后，`juma-web` 的 `.github/workflows/deploy.yml` 要**删掉 nginx 相关部分**，只保留构建和跑自己的容器。

**删除**以下内容：

- `mkdir -p /opt/juma-web/ssl` 和 `mkdir -p /opt/juma-web/nginx` 两行
- 写入 SSL 证书的整段（`cat > .../ssl/chdev.fun.pem ...` 到 `chmod 600 ...`）
- 写入 nginx 配置的整段（`cat > .../nginx/default.conf << 'NGINX' ... NGINX`）
- 启动 `juma-nginx` 容器的整段（`docker stop juma-nginx ...` 到 `nginx:alpine`）

**保留**：

- 镜像构建与推送
- `docker network create juma-net 2>/dev/null || true`（保留！juma-web 容器要靠它加入网络）
- 启动 `juma-web` 容器的整段（`docker run --name juma-web ... --network juma-net ...`）

同时 `juma-web` 仓库里的 `TLS_CERT` / `TLS_KEY` Secret 就不再被它使用了（迁到 nginx 仓库）。

## 九、如何新增一个服务（操作手册）

以接入一个新服务为例：容器名 `foo-api`、端口 `8080`、希望通过 `https://chdev.fun/foo/` 访问。

1. 该服务自己的部署脚本里，容器要加 `--network juma-net`（和 `--name foo-api`）。
2. 在本仓库新增 `nginx/locations/foo-api.conf`：

   ```nginx
   location /foo/ {
       proxy_pass http://foo-api:8080/;     # 注意末尾的 /，含义见下方
       include /etc/nginx/snippets/proxy_common.conf;
   }
   ```

3. push 到 `main`，workflow 自动部署，nginx 重载后即生效。

### ⚠️ 坑一：`proxy_pass` 末尾的斜杠

这是路径转发最容易出错的地方，决定了**前缀 `/foo` 要不要传给后端**：

| 写法 | 访问 `/foo/bar` 时后端实际收到 |
|------|------------------------------|
| `proxy_pass http://foo-api:8080/;`（**有** `/`） | `/bar` —— nginx 把 `/foo` 前缀**去掉** |
| `proxy_pass http://foo-api:8080;`（**无** `/`） | `/foo/bar` —— **原样**带着前缀传过去 |

- 如果后端服务是从根路径提供接口、不知道 `/foo` 前缀的存在 → 用**有斜杠**的写法。
- 如果后端服务自己就监听在 `/foo` 下（或配置了 base path）→ 用**无斜杠**的写法。

### ⚠️ 坑二：前端应用的 base path

如果挂到 `/foo/` 的是一个**前端 SPA**，它生成的静态资源 URL 往往是绝对路径（如 `/assets/x.js`），
经过 `/foo/` 转发后会 404。这种情况需要在**前端构建时**设置 base path（Vite 的 `base: '/foo/'`、
React Router 的 `basename` 等），让它生成 `/foo/assets/x.js`。纯后端 API 服务没有这个问题。

> **删除服务的注意点**：本方案用 `scp` 上传，删掉仓库里的 location 文件不会自动删除服务器上的旧文件。
> 下线某服务时，记得手动删服务器上对应的 `/opt/juma-nginx/locations/xxx.conf` 再重新部署。

## 十、首次部署与验证

1. 新仓库建好、配好 Secrets、push 到 `main`（或在 Actions 页面手动 `Run workflow`）。
2. 部署完成后，SSH 到服务器验证：

   ```bash
   # 容器是否在跑
   docker ps | grep juma-nginx

   # 配置是否已加载（应能看到 conf.d / locations 下的文件）
   docker exec juma-nginx ls /etc/nginx/conf.d/ /etc/nginx/locations/

   # nginx 配置语法是否 OK
   docker exec juma-nginx nginx -t

   # 看日志排错
   docker logs --tail 50 juma-nginx
   ```

3. 浏览器访问 `https://chdev.fun` 确认主站正常，`http://chdev.fun` 应自动跳转到 https；
   有子路径服务后，访问 `https://chdev.fun/foo/` 确认转发正确。

## 附：服务器最终目录结构

```
/opt/juma-nginx/
├── conf.d/
│   ├── 00-upgrade-map.conf
│   └── chdev.fun.conf          # 唯一的 server 块
├── locations/
│   ├── juma-web.conf           # location /
│   └── foo-api.conf            # location /foo/（以后新增的服务）
├── snippets/
│   └── proxy_common.conf
└── ssl/
    ├── chdev.fun.pem           # 由 workflow 从 Secret 写入
    └── chdev.fun.key
```

> 迁移完成、确认新 nginx 正常后，旧的 `/opt/juma-web/ssl` 和 `/opt/juma-web/nginx` 目录就可以删掉了。
