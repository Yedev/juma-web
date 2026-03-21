# mac-mini-client 架构概览

## 模块职责概述

`mac-mini-client` 是 juma-web 系统中的**远程任务执行器客户端**。它运行在构建机器（如 Mac Mini）上，通过 WebSocket 长连接主动连接服务端，接收服务端推送的任务指令，在本地执行任务，并将执行状态和日志实时回传给服务端。

该客户端的核心设计目标是：

- **无需公网 IP**：构建机器无需暴露任何端口，只需能访问服务端地址即可
- **主动发起连接**：由客户端主动连接服务端，服务端不需要反向 SSH 或端口转发
- **任务驱动**：客户端声明自己能执行哪些任务，服务端据此分配对应任务
- **自动恢复**：网络断开后自动重连，无需人工干预

---

## 使用场景

### 典型场景：Mac Mini iOS 构建机

在 iOS 开发团队中，编译 iOS 应用必须在 macOS 上运行 Xcode，而构建机（Mac Mini）通常位于内网，没有公网 IP。juma-web 的解决方案是：

```
┌─────────────────────┐            ┌──────────────────────┐
│   Mac Mini 构建机     │            │   juma-web 服务端      │
│   (内网，无公网IP)     │  WebSocket │   (有公网IP)           │
│                     │  ────────> │                      │
│  mac-mini-client    │  主动连接    │  ws/executor 端点     │
│  node client.js     │            │  任务分发、状态管理      │
└─────────────────────┘            └──────────────────────┘
```

客户端主动连到服务端，告知自己支持哪些任务（如 `client.echo`、`client.mock3s` 等）。当用户在管理界面触发一个 `client_task` 类型的任务时，服务端将任务推送给连接中的客户端执行。

---

## 目录结构说明

```
mac-mini-client/
├── client.js          # 主程序入口：WebSocket连接管理、消息收发、任务调度
├── package.json       # 项目描述，入口为 client.js，启动命令 npm start
├── README.md          # 快速上手文档
└── tasks/
    ├── base.js             # 任务基类 ClientTaskBase，定义任务接口规范
    ├── registry.js         # 任务注册表 ClientTaskRegistry
    ├── index.js            # 注册所有内置任务，导出 getRegisteredTask / getRegisteredTaskDefinitions
    ├── clientEchoTask.js   # 内置任务：client.echo（回显示例）
    ├── clientMock3sTask.js # 内置任务：client.mock3s（3秒模拟任务）
    └── clientFailDemoTask.js # 内置任务：client.fail_demo（异常演练）
```

**职责划分：**

| 文件 | 职责 |
|------|------|
| `client.js` | 程序主入口，管理 WebSocket 连接生命周期，收发所有协议消息，调用任务执行逻辑 |
| `tasks/base.js` | 定义 `ClientTaskBase` 抽象基类，规范 `taskName`、`getDefinition()`、`run()` 接口 |
| `tasks/registry.js` | 维护 `taskName → taskInstance` 的 Map，防止重名注册，提供查询接口 |
| `tasks/index.js` | 初始化注册表，将所有内置任务注册进去，对外暴露查询函数 |
| `tasks/client*.js` | 各任务的具体实现，继承 `ClientTaskBase`，实现 `run()` 方法 |

---

## 连接与任务执行整体流程图

```
客户端启动
    │
    ▼
读取环境变量配置
(SERVER_URL, EXECUTOR_KEY, CLIENT_ID, CLIENT_TAGS, ...)
    │
    ▼
构造 WebSocket URL
ws(s)://<host>/ws/executor?key=<EXECUTOR_KEY>
    │
    ▼
new WebSocket(WS_URL)
    │
    ├─── 连接失败/断开 ──────────────────────────────────────┐
    │                                                        │
    ▼                                                        │
ws.open 事件触发                                              │
    │                                                        │
    ▼                                                        │
发送 client.hello                                            │
(client_id, name, platform, app_version,                     │
 tags, capabilities, tasks)                                  │
    │                                                        │
    ▼                                                        │
接收 server.hello                                            │
(可能含 heartbeat_interval_ms)                                │
    │                                                        │
    ▼                                                        │
启动心跳定时器                                                 │
每隔 HEARTBEAT_INTERVAL_MS 发送 client.heartbeat             │
    │                                                        │
    │◄─────────── 等待服务端推送 task.assign ─────────────────│
    │                                                        │
    ▼  (收到 task.assign)                                    │
检查是否有正在运行的任务                                         │
    │                                                        │
    ├── 有运行中任务 → 丢弃本次 task.assign（打印警告）          │
    │                                                        │
    └── 无运行中任务                                           │
            │                                                │
            ▼                                                │
        根据 task_name 查找注册的任务实现                       │
            │                                                │
            ├── 未找到 → 发送 task.update(error)             │
            │                                                │
            └── 找到任务实现                                  │
                    │                                        │
                    ▼                                        │
                发送 task.update(running)                    │
                    │                                        │
                    ▼                                        │
                调用 taskInstance.run(payload, context)      │
                    │                                        │
                    │ (context.log() 收集日志)               │
                    │ (日志缓冲达到阈值时批量发送 task.log)    │
                    │                                        │
                    ├── 正常完成 → 发送 task.update(completed)│
                    │                                        │
                    └── 抛出异常 → 发送 task.log(错误堆栈)   │
                                    发送 task.update(error)  │
                                                             │
ws.close / ws.error 事件                                     │
    │                                                        │
    ▼                                                        │
清除所有定时器                                                 │
    │                                                        │
    ▼                                                        │
等待 RECONNECT_DELAY_MS 毫秒 ────────────────────────────────┘
重新执行 connect()
```

---

## 环境变量完整说明

| 变量名 | 默认值 | 说明 |
|--------|--------|------|
| `SERVER_URL` | `http://localhost:3001` | 服务端 HTTP 地址。客户端会自动将协议转换为 WebSocket（`http` → `ws`，`https` → `wss`） |
| `EXECUTOR_KEY` | `juma_executor_2026` | 执行器鉴权密钥。通过 URL 参数 `?key=` 传递，服务端用于验证连接合法性。生产环境务必修改 |
| `CLIENT_ID` | `macmini-<hostname>-<uuid前8位>` | 客户端唯一标识符。同一台机器重启后 uuid 部分会变化，如需固定 ID 应通过此变量显式设置 |
| `CLIENT_NAME` | 系统主机名（`os.hostname()`） | 客户端的显示名称，在管理界面中展示 |
| `CLIENT_TAGS` | `""` (空) | 客户端标签，逗号分隔字符串，如 `xcode,ios,arm64`。用于任务分发筛选，详见下方说明 |
| `CLIENT_VERSION` | `1.0.0` | 客户端应用版本号，上报到服务端供运维参考 |
| `WORK_DIR` | `process.cwd()` | 任务的工作目录，上报到服务端作为 `capabilities.work_dir`。任务脚本可参考此路径 |
| `HEARTBEAT_INTERVAL_MS` | `10000` (10秒) | 心跳发送间隔。服务端在收到 `server.hello` 时可下发覆盖此值 |
| `RECONNECT_DELAY_MS` | `3000` (3秒) | 断线后等待多久重连。固定延迟，不含指数退避（当前实现） |
| `LOG_FLUSH_INTERVAL_MS` | `2000` (2秒) | 日志缓冲的最大时间窗口。即使日志量少，超时也会强制上报 |
| `LOG_FLUSH_SIZE` | `2048` (字节) | 日志缓冲的字节阈值。缓冲区达到此大小时立即上报，不等超时 |
| `DEMO_TASK_DELAY_MS` | `3000` (3秒) | 内置示例任务 `client.mock3s` 的模拟处理时长，便于测试调整 |

> **注意：** `HEARTBEAT_INTERVAL_MS` 的最终生效值以服务端 `server.hello` 响应中的 `heartbeat_interval_ms` 字段为准（需大于 3000ms 才会生效覆盖）。若服务端未下发，则使用本地环境变量值。

---

## 客户端标签（tags）机制

### 什么是 tags

`CLIENT_TAGS` 是一个逗号分隔的字符串，启动时被解析为字符串数组：

```
CLIENT_TAGS=xcode,ios,arm64
→ ["xcode", "ios", "arm64"]
```

这个数组会在以下消息中上报给服务端：

- `client.hello`（建立连接时）
- `client.heartbeat`（每次心跳时，通过 `capabilities` 字段）

### tags 如何用于任务分发筛选

服务端在收到 `task.assign` 请求时，可以根据执行器的 tags 过滤目标客户端。例如：

- 标记了 `xcode` 的客户端才能接收 iOS 编译任务
- 标记了 `android` 的客户端才能接收 Android 打包任务
- 多台 Mac Mini 同时在线时，服务端可以按 tag 选择具备所需能力的机器

### 配置建议

```bash
# iOS 构建机
CLIENT_TAGS=xcode,ios,arm64

# Android 构建机
CLIENT_TAGS=android,gradle

# 通用任务机（无特殊限制）
CLIENT_TAGS=general
```

tags 应当描述机器的**能力特征**，而非机器的物理位置（位置信息应放在 `CLIENT_NAME` 中）。

---

## 与服务端的通信架构

### 核心原则：客户端主动发起，服务端被动接受

```
传统模式（SSH / 主动推送）：
  服务端 ──SSH/HTTP──► 构建机     ← 需要构建机有公网IP或做端口转发

juma-web 模式（WebSocket 长连接）：
  构建机 ──WebSocket──► 服务端    ← 构建机只需能访问服务端，无需暴露自身
```

### 连接特点

| 特性 | 说明 |
|------|------|
| 协议 | WebSocket（基于 TCP，全双工） |
| 连接方向 | 客户端主动发起，服务端被动监听 |
| 连接持久性 | 长连接，通过心跳保活 |
| 鉴权方式 | URL 参数 `?key=<EXECUTOR_KEY>`，连接时服务端验证 |
| 断线处理 | 客户端自动重连，服务端通过 `OFFLINE_TIMEOUT_MS` 判断客户端离线 |
| 消息格式 | JSON，统一封装为 `{ type, payload, ts }` |

### 消息流向汇总

```
客户端 → 服务端：
  client.hello       连接建立后握手
  client.heartbeat   定期心跳保活
  task.update        任务状态回报（running / completed / error）
  task.log           任务日志上报（批量缓冲后发送）

服务端 → 客户端：
  server.hello       握手响应，可含心跳间隔配置
  task.assign        任务分配指令
  server.error       服务端错误通知
```

### 为什么使用 WebSocket 而非 HTTP 轮询

| 对比维度 | HTTP 轮询 | WebSocket 长连接 |
|----------|-----------|------------------|
| 任务推送延迟 | 取决于轮询间隔（秒级） | 实时（毫秒级） |
| 服务端资源 | 每次轮询建立新连接 | 单连接持续复用 |
| 客户端网络要求 | 仅需出站 HTTP | 仅需出站 TCP（同样无需公网IP） |
| 日志实时性 | 较差（批量拉取） | 良好（流式推送） |
| 实现复杂度 | 低 | 中等 |

WebSocket 长连接在任务推送实时性和资源利用率上均优于轮询方案，是构建任务调度系统的理想选择。
