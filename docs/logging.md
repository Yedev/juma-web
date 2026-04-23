# 日志系统说明

> 记录 juma-web 后端的日志架构、查看方式、容量预算与运维要点。

## 一、概览

后端基于 [pino](https://github.com/pinojs/pino) 构建结构化日志体系：

- **结构化 JSON**：每条日志单行 JSON，方便 grep / jq / ELK / Loki 消费
- **多路输出**：控制台（dev 彩色 / prod JSON）+ 文件落盘（带轮转）
- **HTTP 请求自动日志**：通过 `pino-http` 自动记录每个请求的 method/url/status/耗时/traceId
- **traceId 全链路追踪**：每个请求自动生成 UUID，写入响应头 `x-request-id`，业务日志自动继承
- **敏感字段脱敏**：`authorization`、`cookie`、`x-sign`、`password`、`token`、`code` 自动 `[REDACTED]`
- **容量受控**：应用日志硬上限 220MB、Docker stdout 日志硬上限 250MB/容器

## 二、日志级别

| 级别 | 数值 | 用途 |
|------|------|------|
| `fatal` | 60 | 进程级致命错误（uncaughtException） |
| `error` | 50 | 业务错误、HTTP 5xx、外部依赖失败 |
| `warn` | 40 | HTTP 4xx、登录失败、配置缺失、Redis 断连、敏感操作（如删除用户）审计 |
| `info` | 30 | 启动、HTTP 2xx/3xx、关键业务事件（注册、登录、加入空间） |
| `debug` | 20 | 开发期排查信息（如 JWT 解码失败原因、Redis 初始连接失败） |

可通过环境变量 `LOG_LEVEL` 调整最低输出级别（默认：dev=debug，prod=info）。

## 三、日志格式

### 标准字段

```json
{
  "level": 30,
  "time": "2026-04-23T06:42:18.908Z",
  "service": "juma-server",
  "module": "drAuthService",
  "msg": "dr.user.registered",
  "userId": 42,
  "phone": "138****0000"
}
```

| 字段 | 含义 |
|------|------|
| `level` | 数值级别（10/20/30/40/50/60） |
| `time` | ISO 8601 UTC 时间戳 |
| `service` | 固定 `juma-server` |
| `module` | 模块名（通过 `logger.child({ module: "xxx" })` 注入） |
| `msg` | 日志事件名（建议用 `domain.action` 风格，如 `dr.user.login`） |
| 其他 | 业务上下文字段（userId、reqId、err 等） |

### HTTP 请求日志字段

```json
{
  "level": 30,
  "time": "2026-04-23T06:42:18.908Z",
  "service": "juma-server",
  "req": {
    "id": "f6dd89d5-798f-481d-ba97-e3565c4ae942",
    "method": "GET",
    "url": "/api/admin/dr/users",
    "remoteAddress": "::ffff:127.0.0.1"
  },
  "res": { "statusCode": 401 },
  "responseTime": 1,
  "msg": "GET /api/admin/dr/users -> 401"
}
```

- `req.id`：traceId，可用于关联同一请求的所有业务日志
- `responseTime`：响应耗时（毫秒）
- `/api/health` 不记录请求日志（避免探活噪音）
- HTTP 状态码自动映射日志级别：≥500 → error，≥400 → warn，其他 → info

## 四、关键业务事件清单

| 事件名 | 级别 | 模块 | 触发场景 |
|--------|------|------|----------|
| `admin.login` | info | adminAuth | 管理后台登录成功 |
| `admin login failed: user not found` | warn | adminAuth | 管理员账号不存在 |
| `admin login failed: bad password` | warn | adminAuth | 管理员密码错误 |
| `dr.user.registered` | info | drAuthService | DeepRead 新用户注册成功 |
| `dr.user.login` | info | drAuthService | DeepRead 用户登录（含 isNewUser 标记） |
| `dr.user.joined-default-space` | info | drAuthService | 新用户自动加入默认空间成功 |
| `dr_default_space_id not configured` | warn | drAuthService | 默认空间未配置，新用户跳过加入 |
| `default space not found` | warn | drAuthService | 默认空间 ID 在 DB 中查无此 space |
| `auto-join default space failed` | error | drAuthService | 加入默认空间过程抛出异常 |
| `admin.dr.user.delete.start` | warn | admin | 管理员触发删除用户（审计） |
| `admin.dr.user.delete.done` | warn | admin | 删除用户成功（含级联删除统计） |
| `admin.dr.user.delete.failed` | error | admin | 删除用户失败 |
| `connected` | info | redis | Redis 连接成功 |
| `connection error` | warn | redis | Redis 运行时断开 |
| `connection failed after retries` | warn | redis | 多次重连失败，降级为 DB-only |
| `client initialized` | info | oss | OSS 客户端初始化（含 bucket、region） |
| `client initialization failed` | error | oss | OSS 初始化失败 |
| `backup start` / `backup done` / `backup failed` | info/error | DBBackup | SQLite 每日备份到 OSS |
| `cleanup start` / `cleanup done` / `cleanup failed` | info/error | InviteCodeCleaner、AnalyticsCleaner | 定时清理任务 |
| `executor disconnected` | info | executorWS | 远程执行器断开连接 |
| `dispatch error` / `message handler error` | error | executorWS | WS 任务派发或消息处理异常 |
| `local task execute error` | error | executionEngine | 本地任务执行失败 |
| `unhandledRejection` / `uncaughtException` | error/fatal | (root) | 进程级未捕获异常兜底 |
| `unhandled error` | error | (root) | Express 全局错误中间件兜底 |

## 五、文件落盘与轮转

### 路径

| 环境 | 路径 | 说明 |
|------|------|------|
| 本地开发 | `server/logs/` | 自动创建，已加入 `.gitignore` |
| Docker 容器 | `/app/logs/` | 由 `Dockerfile` 中 `ENV LOG_DIR=/app/logs` 设置 |
| 生产宿主机 | `/opt/juma-web/logs/` | 由 deploy.yml 挂载 `-v /opt/juma-web/logs:/app/logs` |

### 文件命名

```
app.YYYY-MM-DD.N.log       # 全量日志（info 及以上）
error.YYYY-MM-DD.N.log     # 仅 error 及以上
```

`N` 是当天的轮转序号：满 size 后自动切到下一个编号。

### 轮转策略与容量上限

由 [`pino-roll`](https://github.com/mcollina/pino-roll) 控制，配置见 `server/src/lib/logger.ts`：

| 流 | 单文件大小 | 保留个数 | 总上限 | 切分触发 |
|----|------------|----------|--------|----------|
| `app.log` | 20MB | 10 | **200MB** | 按天 + 满 20MB |
| `error.log` | 5MB | 4 | **20MB** | 按天 + 满 5MB |

**总上限 220MB**，超过后 `pino-roll.limit.count` 自动删除最旧文件。无论运行多久，磁盘占用都不会超过这个数。

### 行为细节

- 写满 20MB → 立刻切到 `app.YYYY-MM-DD.2.log`
- 跨过 0 点 → 切到 `app.YYYY-MM-DD.1.log`（新日期）
- 文件总数到第 11 个 → 自动删除最旧的 `.1.log`
- 服务异常退出**不会丢日志**（pino 默认带 worker thread 同步刷盘）

## 六、查看方式

### 本地开发

```powershell
# 启动后控制台直接输出彩色日志（pino-pretty）
cd server
npm run dev

# 另开一个窗口看落盘文件
cd server\logs
Get-Content app.2026-04-23.1.log -Wait -Tail 20

# 只看 error
Get-Content error.2026-04-23.1.log -Wait -Tail 20
```

### Docker 容器（两种方式都可用）

#### 方式 1：看 docker stdout（最简单）

```bash
ssh 到生产服务器后：

# 实时跟随
docker logs -f juma-web

# 看最近 200 行
docker logs --tail 200 juma-web

# 按时间窗口
docker logs --since 1h juma-web
docker logs --since "2026-04-23T10:00" juma-web

# 只看 error（pino "level":50）
docker logs juma-web 2>&1 | grep '"level":50'

# 追某个 traceId 的全链路
docker logs juma-web 2>&1 | grep 'f6dd89d5-798f-481d'

# 用 jq 美化（需要 apt install jq）
docker logs --tail 100 juma-web 2>&1 | jq .
```

#### 方式 2：看挂载到宿主机的文件（推荐排查历史）

```bash
# 全量
tail -f /opt/juma-web/logs/app.*.log

# 只看 error
tail -f /opt/juma-web/logs/error.*.log

# 按用户查
grep '"userId":42' /opt/juma-web/logs/app.*.log

# 按 traceId 串联
grep 'f6dd89d5-798f' /opt/juma-web/logs/app.*.log

# 美化看最近 100 条
tail -n 100 /opt/juma-web/logs/app.2026-04-23.1.log | jq .

# 找登录相关
grep '"msg":"dr.user.login"' /opt/juma-web/logs/app.*.log | jq .

# 找新用户注册
grep '"msg":"dr.user.registered"' /opt/juma-web/logs/app.*.log | jq .
```

### 常用查询模板

```bash
# 1. 5xx 错误统计（按接口）
grep '"statusCode":5' /opt/juma-web/logs/app.*.log \
  | jq -r '.req.url' | sort | uniq -c | sort -rn

# 2. 慢请求（>1s）
grep '"responseTime"' /opt/juma-web/logs/app.*.log \
  | jq 'select(.responseTime > 1000) | {url: .req.url, ms: .responseTime, id: .req.id}'

# 3. 某天的 admin 删除用户审计
grep '"msg":"admin.dr.user.delete' /opt/juma-web/logs/app.2026-04-23.*.log | jq .

# 4. Redis 抖动
grep '"module":"redis"' /opt/juma-web/logs/app.*.log | jq .
```

## 七、Docker 部署配置

### Dockerfile

`Dockerfile` 中关键配置：

```dockerfile
ENV NODE_ENV=production
ENV PORT=3001
ENV LOG_DIR=/app/logs

EXPOSE 3001
VOLUME ["/app/data", "/app/logs"]
```

- `LOG_DIR` 显式声明日志目录，避免依赖 `__dirname` 解析
- `VOLUME` 声明数据卷（如果未挂载，Docker 会用匿名卷，避免容器层无限膨胀）

### GitHub Actions 部署脚本

`.github/workflows/deploy.yml` 中关键片段：

```yaml
# 准备目录
mkdir -p /opt/juma-web/data
mkdir -p /opt/juma-web/logs    # 日志目录
mkdir -p /opt/juma-web/ssl
mkdir -p /opt/juma-web/nginx

# 启动容器
docker run -d \
  --name juma-web \
  --restart always \
  --network $NETWORK \
  -e OSS_ACCESS_KEY_ID=... \
  -v /opt/juma-web/data:/app/data \
  -v /opt/juma-web/logs:/app/logs \    # ← 日志卷挂载
  $REGISTRY/$NAMESPACE/$IMAGE:latest
```

挂载后，容器内 pino-roll 写到 `/app/logs/`，宿主机就能在 `/opt/juma-web/logs/` 直接看到。

### Docker Daemon 日志轮转（生产服务器一次性配置）

防止 `docker logs`（json-file driver）在长时间运行后撑爆磁盘。

```bash
# 1. 备份现有配置
sudo test -f /etc/docker/daemon.json && sudo cp /etc/docker/daemon.json /etc/docker/daemon.json.bak

# 2. 写入配置
sudo tee /etc/docker/daemon.json > /dev/null <<'EOF'
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "50m",
    "max-file": "5"
  }
}
EOF

# 3. 重启 docker 让配置生效
sudo systemctl restart docker

# 4. 重新创建 juma-web 容器（旧容器的 log 策略在创建时固定，必须重建才生效）
# 通过推送一个新 tag 触发 deploy 即可，或手动：
docker rm -f juma-web
# 然后跑 deploy 脚本里的 docker run 命令
```

> ⚠️ 如果 `/etc/docker/daemon.json` 已有其他配置（如 `registry-mirrors`），不要直接覆盖，手动合并 `log-driver` 和 `log-opts` 字段。

每个容器的 `docker logs` 上限 = `50MB × 5 = 250MB`。

### 验证清单

部署后在服务器上执行：

```bash
# 1. 确认日志目录被挂载
ls -lh /opt/juma-web/logs/
# 期望：app.2026-XX-XX.1.log、error.2026-XX-XX.1.log

# 2. 确认 pino-roll 在写入
tail -f /opt/juma-web/logs/app.*.log

# 3. 确认 docker 轮转策略已生效
docker inspect juma-web | grep -A 5 LogConfig
# 期望：max-size=50m, max-file=5

# 4. 确认容器内环境变量正确
docker exec juma-web env | grep LOG
# 期望：LOG_DIR=/app/logs
```

## 八、容量预算汇总

| 来源 | 上限 | 控制方 |
|------|------|--------|
| 应用文件日志 (`/opt/juma-web/logs/`) | 220MB | `pino-roll.limit.count` |
| Docker stdout (`juma-web`) | 250MB | `daemon.json` log-opts |
| Docker stdout (`juma-nginx`) | 250MB | `daemon.json` log-opts |
| Docker 镜像 | 每次 deploy `prune` | `docker image prune -f` |
| **单容器总占用** | **≈ 720MB** | 永久 |

跑 1 天还是 1 年，磁盘占用都是这个量级。

## 九、环境变量参考

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `LOG_DIR` | `<projectRoot>/logs`（dev）/ `/app/logs`（prod） | 日志落盘目录 |
| `LOG_LEVEL` | `debug`（NODE_ENV != production）<br>`info`（NODE_ENV == production） | 最低输出级别 |
| `LOG_TO_FILE` | `true` | 设为 `false` 关闭文件落盘（仅控制台） |
| `LOG_PRETTY` | dev=true, prod=false | 设为 `false` 强制 JSON 控制台输出 |
| `NODE_ENV` | - | `production` 时关闭 pretty、提高默认级别 |

## 十、开发指南

### 在新模块中使用 logger

```typescript
import logger from "../lib/logger";

const log = logger.child({ module: "myModule" });

// 信息日志
log.info({ userId: 42, action: "subscribe" }, "user.subscribed");

// 警告
log.warn({ retries: 3 }, "external API slow");

// 错误（带原始异常）
try {
  await riskyCall();
} catch (err) {
  log.error({ err, context: "riskyCall" }, "external call failed");
}
```

### 在路由中带上请求上下文

`pino-http` 会把 logger 注入到 `req.log`，自动携带 `reqId`：

```typescript
router.post("/foo", async (req, res) => {
  req.log.info({ body: req.body }, "received foo request");
  // ...这里的日志会自动带上 req.id（traceId）
});
```

### 推荐的 msg 命名

- 业务事件：`domain.subdomain.action`，如 `dr.user.login`、`admin.dr.user.delete.done`
- 错误：用动词短语，如 `auto-join default space failed`
- 状态变化：用过去式，如 `connected`、`executor disconnected`

### 不要做的事

- ❌ 不要在 `msg` 里拼接动态值：`log.info("user " + userId + " logged in")`，应该写 `log.info({ userId }, "user.login")`
- ❌ 不要 `log.info(error)`：应该 `log.error({ err: error }, "context")`，pino 才能正确序列化堆栈
- ❌ 不要在循环里 `log.debug`：高 QPS 下会拖慢
- ❌ 不要直接 `console.log`：绕过了 logger 体系，没有时间戳、traceId、模块名，且不会落盘
