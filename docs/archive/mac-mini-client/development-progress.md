# mac-mini-client 开发进度与部署指南

本文档记录 `mac-mini-client` 的当前功能完成状态、已知限制、部署配置方案，以及后续开发建议。

---

## 当前版本功能完成状态

### 核心功能

| 功能 | 状态 | 说明 |
|------|------|------|
| WebSocket 长连接（原生 API） | 完成 | 使用 Node.js 22+ 内置 WebSocket，无第三方依赖 |
| URL 参数鉴权（EXECUTOR_KEY） | 完成 | `?key=` 参数，连接时服务端验证 |
| HTTP/HTTPS 协议自动转换为 ws/wss | 完成 | 基于 SERVER_URL 协议自动推导 |
| client.hello 握手（含 capabilities 和 tasks） | 完成 | 包含完整机器能力信息和任务列表 |
| server.hello 处理（含心跳间隔下发） | 完成 | 服务端可覆盖本地 HEARTBEAT_INTERVAL_MS |
| client.heartbeat 定时心跳 | 完成 | 携带 capabilities、tasks、running_task_id |
| task.assign 接收与解析 | 完成 | 含单任务并发保护 |
| task.update 状态回报（running/completed/error） | 完成 | 含 status_info、output_json、duration_ms |
| task.log 日志上报（双阈值缓冲） | 完成 | 大小阈值 + 时间阈值，任务完成后强制刷新 |
| 断线自动重连（固定延迟） | 完成 | 固定 RECONNECT_DELAY_MS，不含指数退避 |
| 任务注册表与基类（ClientTaskBase） | 完成 | 含命名规范校验和重名防护 |
| 内置任务：client.echo | 完成 | 支持 message、repeat、sleep_ms 参数 |
| 内置任务：client.mock3s | 完成 | 延迟可配置（DEMO_TASK_DELAY_MS） |
| 内置任务：client.fail_demo | 完成 | 可配置失败步骤，用于验证异常流程 |
| server.error 消息处理 | 完成 | 打印警告日志，不中断连接 |

### 运维与部署

| 功能 | 状态 | 说明 |
|------|------|------|
| npm start 启动 | 完成 | `node client.js` |
| 环境变量全配置化 | 完成 | 所有参数均可通过环境变量覆盖 |
| macOS LaunchAgent 自启 | 未完成 | 需手动配置（见下方部署章节） |
| Docker 容器化运行 | 未完成 | 可行但无 Dockerfile，且 iOS 编译需要 macOS |
| 进程守护（PM2 等） | 未完成 | 建议使用 PM2 或 LaunchAgent |
| 本地日志持久化 | 未完成 | 当前仅输出到 stdout |

---

## Mac Mini 部署配置

### 前置要求

- macOS 12+ （Monterey 或更高，确保 Node.js 22 可用）
- Node.js 22+（建议通过 [nvm](https://github.com/nvm-sh/nvm) 或 [Homebrew](https://brew.sh/) 安装）
- 能够访问服务端地址（内网或公网均可）

### 基础启动

```bash
cd /path/to/juma-web/mac-mini-client

# 设置环境变量并启动
SERVER_URL=http://your-server:3001 \
EXECUTOR_KEY=your_secret_key \
CLIENT_ID=macmini-office-01 \
CLIENT_NAME="办公室Mac Mini" \
CLIENT_TAGS=xcode,ios,arm64 \
WORK_DIR=/Users/builder/juma-work \
npm start
```

### macOS LaunchAgent 自启配置

LaunchAgent 是 macOS 的标准守护进程方案，支持开机自启、崩溃自动重启。

**步骤 1：创建 plist 配置文件**

创建 `~/Library/LaunchAgents/com.juma.mac-mini-client.plist`：

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.juma.mac-mini-client</string>

  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/node</string>
    <string>/Users/builder/juma-web/mac-mini-client/client.js</string>
  </array>

  <key>EnvironmentVariables</key>
  <dict>
    <key>SERVER_URL</key>
    <string>https://your-server.example.com</string>
    <key>EXECUTOR_KEY</key>
    <string>your_secret_executor_key</string>
    <key>CLIENT_ID</key>
    <string>macmini-office-01</string>
    <key>CLIENT_NAME</key>
    <string>办公室Mac Mini</string>
    <key>CLIENT_TAGS</key>
    <string>xcode,ios,arm64</string>
    <key>WORK_DIR</key>
    <string>/Users/builder/juma-work</string>
    <key>CLIENT_VERSION</key>
    <string>1.0.0</string>
  </dict>

  <key>WorkingDirectory</key>
  <string>/Users/builder/juma-web/mac-mini-client</string>

  <key>StandardOutPath</key>
  <string>/Users/builder/logs/juma-client.log</string>

  <key>StandardErrorPath</key>
  <string>/Users/builder/logs/juma-client-error.log</string>

  <key>KeepAlive</key>
  <true/>

  <key>RunAtLoad</key>
  <true/>

  <key>ThrottleInterval</key>
  <integer>10</integer>
</dict>
</plist>
```

**步骤 2：创建日志目录**

```bash
mkdir -p /Users/builder/logs
```

**步骤 3：加载 LaunchAgent**

```bash
launchctl load ~/Library/LaunchAgents/com.juma.mac-mini-client.plist
```

**步骤 4：验证运行状态**

```bash
# 检查是否在运行
launchctl list | grep juma

# 查看实时日志
tail -f /Users/builder/logs/juma-client.log

# 停止服务
launchctl unload ~/Library/LaunchAgents/com.juma.mac-mini-client.plist

# 重新加载（配置变更后）
launchctl unload ~/Library/LaunchAgents/com.juma.mac-mini-client.plist
launchctl load ~/Library/LaunchAgents/com.juma.mac-mini-client.plist
```

**关键配置说明：**

| 配置项 | 说明 |
|--------|------|
| `KeepAlive: true` | 进程退出后 LaunchAgent 自动重启 |
| `RunAtLoad: true` | 系统启动时自动运行 |
| `ThrottleInterval: 10` | 崩溃后至少等待 10 秒再重启，防止崩溃风暴 |
| `StandardOutPath` | stdout 重定向到日志文件（client.js 的 console.log） |

### 日志路径与轮转

当前 client.js 所有日志输出到 stdout（`console.log` / `console.warn`），由 LaunchAgent 重定向到文件。日志格式示例：

```
[2026-03-21T10:00:00.000Z] mac-mini ws client starting
[2026-03-21T10:00:00.001Z] ws=ws://your-server:3001/ws/executor?key=... client_id=macmini-office-01
[2026-03-21T10:00:00.200Z] ws connected: ws://your-server:3001/ws/executor?key=...
[2026-03-21T10:00:00.350Z] registered via ws, heartbeat=10000ms, accepted_tasks=client.echo,client.mock3s
[2026-03-21T10:01:05.000Z] received task T-abc123, task_name=client.mock3s
```

**日志轮转建议（使用 newsyslog）：**

创建 `/etc/newsyslog.d/juma-client.conf`：

```
/Users/builder/logs/juma-client.log       644  7  10240  *  JN
/Users/builder/logs/juma-client-error.log 644  7  10240  *  JN
```

含义：保留 7 份，每份最大 10MB，超出后轮转（`J` = 压缩，`N` = 不发信号）。

---

## 已知限制

### 1. 单任务并发（不支持并行执行）

当前客户端一次只能执行一个任务。收到新的 `task.assign` 时，若有任务正在运行，新任务会被静默丢弃。

**影响：** 高频任务分发时，服务端可能将同一机器的多个任务排队，但客户端无法并行处理，吞吐量受限。

**临时方案：** 在同一台机器上部署多个客户端实例（不同 CLIENT_ID），见下方"多执行器部署"章节。

### 2. 无本地任务状态缓存

若任务执行中途 WebSocket 断开，任务继续在本地执行，但完成时的 `task.update` 和 `task.log` 消息无法发送（连接已断开）。重连后这些消息也**不会重发**，导致服务端看到的任务状态停留在 `running`，需要手动处理或等待超时清理。

### 3. 固定重连延迟（无指数退避）

断线后始终等待固定的 `RECONNECT_DELAY_MS`（3秒）重连。若服务端长时间不可用，客户端会以固定频率持续重连，造成一定的无效请求。

### 4. JavaScript 而非 TypeScript

客户端使用纯 JavaScript 编写，无静态类型检查。添加新任务时，类型错误（如 payload 字段类型不对）只能在运行时发现。

### 5. 无任务取消机制

服务端无法中途取消正在执行的任务。一旦 `task.assign` 被客户端接受并开始执行，只能等待任务自然完成或抛出异常。

### 6. 日志缓冲丢失场景

任务异常时，`logBuffer` 中未刷新的日志可能丢失（`catch` 块未调用 `flushLogs(true)`），仅 `error.stack` 被发送。

---

## 待开发功能建议

### 优先级高

**多任务并发执行**
- 改造 `runningTaskId`（单值）为 `runningTasks`（Map）
- 在 `client.hello` 中增加 `max_concurrent` 字段，服务端据此控制分发频率
- 注意：iOS 编译通常独占 CPU，并发数建议限制为 2-3

**任务取消支持**
- 新增消息类型 `task.cancel`，服务端可发送给客户端
- 客户端维护 `AbortController`，在任务 context 中提供 `signal`
- 任务代码使用 `signal.aborted` 检查是否需要退出

**断线后状态重传**
- 重连成功后，将本地缓存的未发送 `task.update` 和 `task.log` 消息补发给服务端
- 需要客户端本地维护一个轻量的消息队列（可用内存队列，不需要持久化）

### 优先级中

**指数退避重连**
- 避免服务端重启时大量客户端同时涌入
- 建议：基础延迟 3s，最大延迟 120s，成功连接后重置

**TypeScript 迁移**
- 可参考 juma-web 主项目的 TypeScript 配置
- 优先迁移 `tasks/base.ts` 和 `tasks/registry.ts`，建立类型接口后再迁移各任务文件
- 建议使用 `tsconfig.json` 的 `strict: true` 模式

**本地日志持久化**
- 将 `console.log` 输出写入本地文件（或使用 `winston`、`pino` 等日志库）
- 记录任务执行历史，便于排查服务端未收到状态更新的情况
- 注意日志轮转，防止日志文件无限增大

**健康检查 HTTP 端点**
- 启动一个轻量 HTTP 服务（如 `http.createServer`），暴露 `/health` 端点
- 返回当前连接状态、运行中的任务 ID、最近心跳时间等信息
- 方便 macOS 监控脚本、Nagios 等工具检测客户端健康状态

### 优先级低

**任务结果本地持久化**
- 将任务执行结果写入本地 SQLite 或 JSON 文件
- 支持查询历史任务的执行日志和状态

**Web 管理界面（本地）**
- 提供本地 Web UI，展示当前连接状态和任务历史
- 通过浏览器访问 `http://localhost:9090`

---

## 开发调试方法

### 本地调试：连接本地服务端

在本地同时运行服务端和客户端进行联调：

```bash
# 终端 1：启动服务端
cd juma-web
npm run dev

# 终端 2：启动客户端（连接本地服务端）
cd juma-web/mac-mini-client
SERVER_URL=http://localhost:3001 \
EXECUTOR_KEY=juma_executor_2026 \
CLIENT_ID=dev-local-01 \
CLIENT_TAGS=xcode,dev \
npm start
```

### 调整日志刷新参数（加快测试反馈）

```bash
# 开发环境：更小的缓冲区，更快看到日志
LOG_FLUSH_INTERVAL_MS=200 \
LOG_FLUSH_SIZE=256 \
npm start
```

### 调整 mock3s 的执行时长

```bash
# 测试时缩短等待时间
DEMO_TASK_DELAY_MS=500 npm start
```

### 验证 client.hello 内容

启动后观察控制台第二行输出，确认配置生效：

```
[...] ws=ws://localhost:3001/ws/executor?key=juma_executor_2026 \
      client_id=dev-local-01 \
      tags=xcode,dev \
      tasks=client.echo, client.mock3s, client.fail_demo
```

### 触发内置测试任务

通过 juma-web 管理界面或 API 触发以下任务进行验证：

| 任务 | 验证目标 |
|------|----------|
| `client.echo` | WebSocket 消息收发、日志上报、completed 状态 |
| `client.mock3s` | 3秒任务、output_json 回传 |
| `client.fail_demo` | error 状态、错误堆栈日志上报 |

### 模拟断线重连

```bash
# 方法 1：临时停止服务端，观察客户端重连日志
# 方法 2：在客户端机器上断网几秒，再恢复
# 方法 3：直接 kill 服务端进程，观察客户端连接关闭和重连
```

---

## 多执行器部署

### 场景：同一台机器运行多个客户端实例

当单台机器需要并行处理多个任务时，可以启动多个 `mac-mini-client` 进程，每个进程使用不同的 `CLIENT_ID`。

### 使用 PM2 管理多实例

```bash
# 安装 PM2
npm install -g pm2

# 创建 ecosystem.config.js
```

`ecosystem.config.js` 示例：

```javascript
module.exports = {
  apps: [
    {
      name: "juma-client-01",
      script: "./client.js",
      cwd: "/Users/builder/juma-web/mac-mini-client",
      env: {
        SERVER_URL: "https://your-server.example.com",
        EXECUTOR_KEY: "your_secret_key",
        CLIENT_ID: "macmini-office-01",
        CLIENT_NAME: "办公室Mac Mini - 实例1",
        CLIENT_TAGS: "xcode,ios,arm64",
        WORK_DIR: "/Users/builder/juma-work-01",
      },
    },
    {
      name: "juma-client-02",
      script: "./client.js",
      cwd: "/Users/builder/juma-web/mac-mini-client",
      env: {
        SERVER_URL: "https://your-server.example.com",
        EXECUTOR_KEY: "your_secret_key",
        CLIENT_ID: "macmini-office-02",
        CLIENT_NAME: "办公室Mac Mini - 实例2",
        CLIENT_TAGS: "xcode,ios,arm64",
        WORK_DIR: "/Users/builder/juma-work-02",
      },
    },
  ],
};
```

```bash
# 启动所有实例
pm2 start ecosystem.config.js

# 查看状态
pm2 status

# 查看日志
pm2 logs juma-client-01

# 设置开机自启
pm2 save
pm2 startup
```

### 多实例注意事项

| 注意事项 | 说明 |
|----------|------|
| CLIENT_ID 必须唯一 | 不同实例的 CLIENT_ID 不能相同，否则服务端可能混淆状态 |
| WORK_DIR 建议分开 | 各实例使用不同工作目录，防止并发编译时文件冲突 |
| 资源竞争 | iOS 编译 CPU 密集，同时运行 2 个以上编译任务可能导致机器过热或内存不足 |
| tags 可以相同 | 多实例可以有相同的 tags，服务端按需选择其中任一空闲实例分发任务 |

### 与 LaunchAgent 结合

若需要开机自启多实例，建议使用 PM2 的 `startup` 命令生成 LaunchAgent，而非手动为每个实例创建 plist 文件：

```bash
pm2 startup
# 按照输出的指令执行（通常是一条 sudo 命令）

pm2 save
# 保存当前进程列表，开机后 PM2 会自动恢复
```
