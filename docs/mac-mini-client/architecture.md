# mac-mini-client 架构说明

## 模块职责概述

`mac-mini-client` 是 juma-web 系统的**远程任务执行器客户端**。它运行在 Mac Mini（或任意具备 Node.js 环境的机器）上，通过 WebSocket 长连接主动连接到 juma-web 服务端，接收服务端下发的任务指令，在本地执行后将状态和日志实时回传。

核心职责：

1. **建立并维护 WebSocket 长连接**：主动连接服务端，断线后自动重连。
2. **身份注册与能力声明**：连接建立后发送 `client.hello`，向服务端声明自身标识、平台信息、标签和支持的任务类型。
3. **定期心跳**：周期性发送 `client.heartbeat`，让服务端感知客户端存活状态。
4. **任务调度与执行**：接收服务端的 `task.assign` 消息，路由到对应任务模块并执行。
5. **状态与日志回传**：执行过程中通过 `task.update` 上报任务状态，通过 `task.log` 分批上报执行日志。

---

## 使用场景

### 典型场景：Mac Mini iOS 构建机

Mac Mini 通常部署在内网环境，无公网 IP，无法被服务端主动访问。`mac-mini-client` 采用**客户端主动发起连接**的架构，彻底解决了这一问题：

- Mac Mini 启动后运行 `npm start`，主动连接公网（或内网）服务端的 WebSocket 端点。
- 服务端收到连接后记录该执行器，可以向其下发 iOS 构建、测试、签名等任务。
- Mac Mini 执行完任务后将结果和日志回传，服务端展示在管理面板中。

### 其他适用场景

- **多平台构建节点**：不同操作系统的构建机（Linux/Windows/macOS）同时连接同一服务端，按 `tags` 分配对应平台的构建任务。
- **边缘计算节点**：在受限网络环境中运行数据处理任务，无需开放防火墙端口。
- **持续集成代理**：作为 CI 系统的执行节点，替代传统需要服务端主动 SSH 连接的方式。

---

## 目录结构说明

```
mac-mini-client/
├── client.js           # 主程序入口。WebSocket 连接管理、消息收发、任务调度
├── package.json        # 项目配置（main: client.js, scripts.start: node client.js）
└── tasks/              # 任务实现目录
    ├── index.js        # 任务注册入口，对外暴露 getRegisteredTaskDefinitions / getRegisteredTask
    ├── registry.js     # ClientTaskRegistry：任务注册表，管理任务名称到实例的映射
    ├── base.js         # ClientTaskBase：所有任务的基类，定义 taskName/version/description/run()
    ├── clientEchoTask.js      # 内置任务：client.echo（回显消息，支持重复次数与延迟）
    ├── clientMock3sTask.js    # 内置任务：client.mock3s（模拟耗时约3秒的任务）
    └── clientFailDemoTask.js  # 内置任务：client.fail_demo（人工触发异常，用于测试错误处理）
```

各文件职责说明：

| 文件 | 职责 |
|------|------|
| `client.js` | 程序主逻辑：WebSocket 连接、心跳、重连、消息路由、任务执行调度、日志缓冲 |
| `tasks/index.js` | 统一注册所有内置任务，提供查询接口给 `client.js` 使用 |
| `tasks/registry.js` | `ClientTaskRegistry` 类：用 Map 维护任务名称到实例的映射，防止重复注册 |
| `tasks/base.js` | `ClientTaskBase` 类：定义任务接口规范，校验任务名格式（必须为 `client.xxx`） |
| `tasks/clientEchoTask.js` | `client.echo` 任务实现 |
| `tasks/clientMock3sTask.js` | `client.mock3s` 任务实现（延迟可通过 `DEMO_TASK_DELAY_MS` 环境变量配置） |
| `tasks/clientFailDemoTask.js` | `client.fail_demo` 任务实现 |

---

## 连接与任务执行整体流程图

```
Mac Mini (client.js)                         juma-web 服务端
       │                                            │
       │  启动，读取环境变量                          │
       │  构造 WS_URL + EXECUTOR_KEY                │
       │                                            │
       │──── WebSocket 连接请求 ──────────────────→ │
       │     ws://SERVER_URL/ws/executor            │
       │     ?key=EXECUTOR_KEY                      │
       │                                            │
       │ ←──── 连接建立（HTTP 101 Upgrade）────────  │
       │                                            │
       │──── client.hello ──────────────────────→  │  服务端验证 key，注册执行器
       │     {client_id, name, platform,           │
       │      app_version, tags,                   │
       │      capabilities, tasks}                 │
       │                                            │
       │ ←──── server.hello ────────────────────── │  返回 heartbeat_interval_ms
       │       {heartbeat_interval_ms,             │  和 accepted_tasks 列表
       │        accepted_tasks}                    │
       │                                            │
       │  ┌─────────────────────────────┐          │
       │  │  每隔 heartbeat_interval_ms  │          │
       │  │──── client.heartbeat ──────→│          │  服务端更新执行器在线状态
       │  │     {client_id,             │          │
       │  │      capabilities,          │          │
       │  │      tasks,                 │          │
       │  │      running_task_id}       │          │
       │  └─────────────────────────────┘          │
       │                                            │
       │                          (服务端收到任务请求)│
       │ ←──── task.assign ─────────────────────── │
       │       {task_id, task_name,                │
       │        task_payload,                      │
       │        execution_name}                    │
       │                                            │
       │  查找任务实现（registry.get）               │
       │  找到 → 执行                                │
       │──── task.update (running) ──────────────→ │  服务端更新任务状态为运行中
       │     {task_id, status:"running",           │
       │      status_info:{progress:5,...}}        │
       │                                            │
       │  ┌─────────────────────────────┐          │
       │  │  任务执行过程中（异步）       │          │
       │  │  context.log("...")         │          │
       │  │  → logBuffer 积累           │          │
       │  │  → 满足大小或时间阈值时刷新  │          │
       │  │──── task.log ─────────────→│          │  服务端存储日志
       │  │     {task_id, append_log}  │          │
       │  └─────────────────────────────┘          │
       │                                            │
       │  任务完成（run() resolve）                  │
       │  flushLogs(force=true) 强制刷新            │
       │──── task.log (最后一批) ────────────────→ │
       │──── task.update (completed) ───────────→ │  服务端标记任务完成
       │     {task_id, status:"completed",        │
       │      status_info:{progress:100,          │
       │                   output_json,...}}       │
       │                                            │
       │  任务抛出异常时：                           │
       │──── task.log (错误堆栈) ────────────────→ │
       │──── task.update (error) ───────────────→ │  服务端标记任务失败
       │     {task_id, status:"error",            │
       │      result_code:-1, ...}                │
       │                                            │
       │  连接断开时：                              │
       │  clearTimers()                            │
       │  setTimeout(connect, RECONNECT_DELAY_MS)  │
       │──── 重新执行连接流程 ──────────────────→   │
```

---

## 环境变量完整说明

所有环境变量均为可选，程序内置默认值，开箱即用。

| 环境变量 | 默认值 | 类型 | 说明 |
|----------|--------|------|------|
| `SERVER_URL` | `http://localhost:3001` | string | 服务端 HTTP/HTTPS 地址，程序会自动将其转换为对应的 `ws://` 或 `wss://` 地址 |
| `EXECUTOR_KEY` | `juma_executor_2026` | string | 执行器鉴权密钥，附加在 WebSocket URL 的 `key` 查询参数中 |
| `CLIENT_ID` | `macmini-{hostname}-{uuid8}` | string | 执行器唯一标识符。若不设置，每次启动会自动生成（含8位随机UUID），建议在生产环境显式设置以保持稳定 |
| `CLIENT_NAME` | `os.hostname()` | string | 执行器显示名称，在服务端管理面板中展示 |
| `CLIENT_TAGS` | `""` | string | 逗号分隔的标签列表，如 `xcode,ios,arm64`，用于服务端任务分发筛选 |
| `CLIENT_VERSION` | `1.0.0` | string | 客户端应用版本号，随 `client.hello` 上报 |
| `WORK_DIR` | `process.cwd()` | string | 任务执行的工作目录，随 `capabilities` 上报，任务实现可读取此值 |
| `HEARTBEAT_INTERVAL_MS` | `10000` | number | 心跳发送间隔（毫秒）。实际间隔以 `server.hello` 返回值为准，此处为初始默认值 |
| `RECONNECT_DELAY_MS` | `3000` | number | 断线后等待重连的时间（毫秒） |
| `LOG_FLUSH_INTERVAL_MS` | `2000` | number | 日志缓冲刷新的最大时间间隔（毫秒）。日志积累超过此时间会被强制发送 |
| `LOG_FLUSH_SIZE` | `2048` | number | 日志缓冲触发刷新的大小阈值（字节）。缓冲区超过此大小会立即发送 |
| `DEMO_TASK_DELAY_MS` | `3000` | number | 仅用于 `client.mock3s` 任务，控制模拟延迟时长（毫秒） |

### 生产环境推荐配置示例（`.env` 或 LaunchAgent plist）

```bash
SERVER_URL=https://juma.example.com
EXECUTOR_KEY=your_secret_executor_key
CLIENT_ID=macmini-build-01
CLIENT_NAME=Mac Mini Build 01
CLIENT_TAGS=xcode,ios,arm64,macos
CLIENT_VERSION=1.0.0
WORK_DIR=/Users/builder/workspace
HEARTBEAT_INTERVAL_MS=10000
RECONNECT_DELAY_MS=3000
```

---

## 客户端标签（tags）机制

### 标签的作用

`CLIENT_TAGS` 是一个逗号分隔的字符串，在程序启动时被解析为字符串数组：

```javascript
const CLIENT_TAGS = (process.env.CLIENT_TAGS || "")
  .split(",")
  .map((x) => x.trim())
  .filter(Boolean);
```

标签随 `client.hello` 和 `client.heartbeat` 消息上报给服务端。服务端可以根据标签将特定任务路由到满足条件的执行器。

### 常见标签约定

| 标签 | 含义 |
|------|------|
| `xcode` | 该机器安装了 Xcode，可执行 iOS/macOS 构建 |
| `ios` | 专用于 iOS 构建任务 |
| `arm64` | Apple Silicon 架构（M1/M2/M3 芯片） |
| `x86_64` | Intel 架构 |
| `macos` | macOS 平台 |
| `linux` | Linux 平台 |
| `fast` | 高性能机器，优先分配耗时任务 |
| `staging` | 预发布环境专用节点 |

### 标签在任务分发中的应用

服务端的任务定义可以声明 `required_tags`，只有当执行器的标签集合包含所有必需标签时，才会将任务分配给该执行器。例如：

- 执行器标签：`["xcode", "ios", "arm64"]`
- 任务 `ios.build` 要求：`required_tags: ["xcode", "ios"]`
- 匹配成功 → 任务被分配到此执行器

### 多执行器标签规划建议

在同一台机器上运行多个客户端实例时（不同 `CLIENT_ID`），可以为每个实例设置不同的标签，实现精细化分工。详见[开发进度与部署说明](./development-progress.md)中的多执行器部署章节。

---

## 与服务端的通信架构

### 整体架构特点

```
┌─────────────────────────────────────────────────────────────┐
│                        内网 / 无公网IP                        │
│                                                             │
│   Mac Mini A          Mac Mini B          Linux Builder     │
│   [client.js]         [client.js]         [client.js]       │
│   tags: xcode,ios     tags: xcode,ios     tags: linux       │
│        │                   │                   │            │
└────────┼───────────────────┼───────────────────┼────────────┘
         │                   │                   │
         │ WebSocket (主动发起) │ WebSocket         │ WebSocket
         │                   │                   │
         ▼                   ▼                   ▼
┌─────────────────────────────────────────────────────────────┐
│                   juma-web 服务端（公网）                     │
│                                                             │
│   WebSocket Endpoint: /ws/executor?key=...                  │
│   ┌─────────────────────────────────────────────────┐       │
│   │  ExecutorRegistry（内存）                        │       │
│   │  ├── macmini-build-01  [ONLINE]  ws: conn1      │       │
│   │  ├── macmini-build-02  [ONLINE]  ws: conn2      │       │
│   │  └── linux-builder-01  [ONLINE]  ws: conn3      │       │
│   └─────────────────────────────────────────────────┘       │
│                          │                                  │
│   任务调度器 → 选择执行器 → 发送 task.assign                  │
└─────────────────────────────────────────────────────────────┘
```

### 关键架构决策

1. **客户端主动连接，服务端无需主动访问客户端**
   - 客户端穿透 NAT/防火墙，无需在路由器上做端口转发
   - 服务端只需开放一个 WebSocket 端口（通常复用 HTTP 443 或 3001）

2. **WebSocket 长连接，状态实时同步**
   - 任务状态和日志通过已建立的连接推送，低延迟
   - 无需轮询，服务端主动推送 `task.assign`

3. **单连接单任务（当前实现）**
   - 每个客户端进程同时只处理一个任务（`runningTaskId` 变量保护）
   - 新任务到达时若有正在运行的任务，会被丢弃并打印警告
   - 需要并行处理任务时，可在同一台机器启动多个客户端进程（不同 `CLIENT_ID`）

4. **无状态重连**
   - 断线重连后不会恢复中断的任务状态（当前实现）
   - 服务端可设置任务超时或重试策略来应对客户端掉线场景
