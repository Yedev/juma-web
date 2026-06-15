# juma-nginx 独立仓库搭建说明

> 本文档面向接手 nginx 反向代理的同事。目标是把 nginx 从 `juma-web` 的发版流程里拆出来，
> 单独建一个仓库管理。以后新增服务只需在本仓库加一个配置文件，**不再改动 `juma-web`**。

## 一、背景与目标

现状：nginx 的配置是**硬编码**在 `juma-web` 仓库的 `.github/workflows/deploy.yml` 里（一段 shell heredoc），
每次给 `juma-web` 打 `v*` tag 部署时都会**整体覆盖重写**服务器上的 nginx 配置。

带来的问题：

- 想加一个新服务（让 nginx 转发到它），必须改 `juma-web` 的部署脚本。
- 在服务器上手动改的配置，下次 `juma-web` 部署就被冲掉。
- nginx（基础设施）和 juma-web（业务应用）的发版耦合在一起。

拆分后的目标：

- nginx 作为**独立的入口基础设施**，有自己的仓库和 GitHub Action。
- 配置按 `conf.d/` 目录拆分，**一个服务一个 `.conf` 文件**。
- 新增服务 = 在本仓库加一个 `.conf` 文件并 push，nginx 自动重载，**完全不碰业务仓库**。

## 二、新仓库目录结构

建议仓库名 `juma-nginx`（或 `juma-infra`，如果以后还想放别的共享基础设施）。结构如下：

```
juma-nginx/
├── README.md                       # 仓库说明（可直接用本文档内容）
├── nginx/
│   └── conf.d/
│       └── juma-web.conf           # juma-web 的反代配置（一个服务一个文件）
└── .github/
    └── workflows/
        └── deploy-nginx.yml        # 部署 workflow
```

## 三、nginx 配置（conf.d 拆分）

nginx 官方镜像会自动加载 `/etc/nginx/conf.d/` 下所有 `.conf` 文件。我们把整个 `conf.d` 目录挂进容器，
这样**加服务就是加文件**，互不影响。

### `nginx/conf.d/juma-web.conf`

把原来 `juma-web` 部署脚本里那段 nginx 配置原样搬过来，作为独立文件：

```nginx
# juma-web 主站：chdev.fun
server {
    listen 80;
    server_name chdev.fun www.chdev.fun;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name chdev.fun www.chdev.fun;

    ssl_certificate     /etc/nginx/ssl/chdev.fun.pem;
    ssl_certificate_key /etc/nginx/ssl/chdev.fun.key;
    ssl_protocols       TLSv1.2 TLSv1.3;

    location / {
        proxy_pass http://juma-web:3001;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade           $http_upgrade;
        proxy_set_header Connection        "upgrade";
    }
}
```

> 说明：`proxy_pass http://juma-web:3001` 里的 `juma-web` 是**容器名**，靠 Docker 网络 `juma-net` 的内置 DNS 解析。
> `Upgrade` / `Connection "upgrade"` 两行是为了让 WebSocket（如 `/ws/executor`）能正常穿透代理，别删。

## 四、GitHub Actions workflow

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
          source: "nginx/conf.d/*.conf"
          target: ${{ env.REMOTE_DIR }}/conf.d
          strip_components: 2                   # 去掉 nginx/conf.d 前缀，文件直接落到 target

      - name: 部署 nginx 容器
        uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.ALIYUN_HOST }}
          username: ${{ secrets.ALIYUN_USER }}
          key: ${{ secrets.ALIYUN_SSH_KEY }}
          envs: NETWORK,REMOTE_DIR
          script: |
            mkdir -p $REMOTE_DIR/conf.d
            mkdir -p $REMOTE_DIR/ssl

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
              -v $REMOTE_DIR/ssl:/etc/nginx/ssl:ro \
              nginx:alpine
```

与 `juma-web` 旧脚本的区别：

- **没有镜像构建步骤** —— 直接用官方 `nginx:alpine`，无需 Dockerfile、无需登录镜像仓库。
- **配置是仓库里的真实文件**，通过 `scp` 上传，而不是 heredoc 内联。
- **挂的是整个 `conf.d` 目录**（`-v .../conf.d:/etc/nginx/conf.d:ro`），不是单个文件。
- 服务器目录从 `/opt/juma-web/{ssl,nginx}` 改为独立的 `/opt/juma-nginx/{ssl,conf.d}`。
- 触发条件是 push 到 `main`（且改了 `nginx/**`）或手动触发，而非 `v*` tag。

## 五、需要配置的 GitHub Secrets

在新仓库 `Settings → Secrets and variables → Actions` 里配置以下 5 个（前 3 个和 `juma-web` 仓库里的同名同值）：

| Secret | 用途 |
|--------|------|
| `ALIYUN_HOST` | 服务器 IP / 域名 |
| `ALIYUN_USER` | SSH 登录用户名 |
| `ALIYUN_SSH_KEY` | SSH 私钥 |
| `TLS_CERT` | `chdev.fun` 证书（PEM 内容） |
| `TLS_KEY` | `chdev.fun` 证书私钥 |

> 如果 `yedev` 是 GitHub Organization，建议把 `ALIYUN_HOST` / `ALIYUN_USER` / `ALIYUN_SSH_KEY`
> 设成 **Organization 级别 Secret**，多个仓库共享，不用重复维护。
>
> 注意：`OSS_*`、`ALIYUN_REGISTRY_*` 是 juma-web 应用专用的，**nginx 仓库不需要**。

## 六、与应用仓库的「契约」

nginx 仓库和各应用仓库通过下面这几个约定对接，**必须保持一致**：

| 约定项 | 值 | 说明 |
|--------|-----|------|
| Docker 网络名 | `juma-net` | 所有需要被反代的容器都要挂到这个网络 |
| 后端容器名:端口 | `juma-web:3001` | nginx 的 `proxy_pass` 要和应用容器的 `--name` + 端口对得上 |
| 网络创建 | `docker network create juma-net \|\| true` | 两边都幂等执行，谁先部署都行 |

新服务想被 nginx 转发，前提是它的容器也 `--network juma-net`，否则 nginx 用容器名找不到它。

## 七、juma-web 仓库要配合做的改动

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

## 八、如何新增一个服务（操作手册）

以后接入一个新服务（假设容器名 `foo-api`、端口 `8080`、域名 `foo.chdev.fun`）：

1. 该服务自己的部署脚本里，容器要加 `--network juma-net`（和 `--name foo-api`）。
2. 在本仓库新增 `nginx/conf.d/foo-api.conf`：

   ```nginx
   server {
       listen 80;
       server_name foo.chdev.fun;
       return 301 https://$host$request_uri;
   }

   server {
       listen 443 ssl;
       server_name foo.chdev.fun;

       ssl_certificate     /etc/nginx/ssl/foo.chdev.fun.pem;
       ssl_certificate_key /etc/nginx/ssl/foo.chdev.fun.key;
       ssl_protocols       TLSv1.2 TLSv1.3;

       location / {
           proxy_pass http://foo-api:8080;
           proxy_set_header Host            $host;
           proxy_set_header X-Real-IP       $remote_addr;
           proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
           proxy_set_header X-Forwarded-Proto $scheme;
       }
   }
   ```

3. 如果是**新域名**，需要为它准备证书：加 `TLS_CERT_FOO` / `TLS_KEY_FOO` 之类的 Secret，
   并在 workflow 的「写入 SSL 证书」段里多写一份到 `$REMOTE_DIR/ssl/foo.chdev.fun.pem`。
   （如果新服务复用同一个 `chdev.fun` 泛域名证书，则无需加证书，直接引用现有 `.pem` 即可。）
4. push 到 `main`，workflow 自动部署，nginx 重载后即生效。

> **删除服务的注意点**：本方案用 `scp` 上传，删掉仓库里的 `.conf` 不会自动删除服务器上的旧文件。
> 下线某服务时，记得手动删服务器上对应的 `/opt/juma-nginx/conf.d/xxx.conf` 再重新部署。

## 九、首次部署与验证

1. 新仓库建好、配好 Secrets、push 到 `main`（或在 Actions 页面手动 `Run workflow`）。
2. 部署完成后，SSH 到服务器验证：

   ```bash
   # 容器是否在跑
   docker ps | grep juma-nginx

   # 配置是否已加载（应能看到 conf.d 下的文件）
   docker exec juma-nginx ls /etc/nginx/conf.d/

   # nginx 配置语法是否 OK
   docker exec juma-nginx nginx -t

   # 看日志排错
   docker logs --tail 50 juma-nginx
   ```

3. 浏览器访问 `https://chdev.fun` 确认正常，`http://chdev.fun` 应自动跳转到 https。

## 附：服务器最终目录结构

```
/opt/juma-nginx/
├── conf.d/
│   └── juma-web.conf          # 由本仓库 scp 上传
└── ssl/
    ├── chdev.fun.pem          # 由 workflow 从 Secret 写入
    └── chdev.fun.key
```

> 迁移完成、确认新 nginx 正常后，旧的 `/opt/juma-web/ssl` 和 `/opt/juma-web/nginx` 目录就可以删掉了。
