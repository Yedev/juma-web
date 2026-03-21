# WebSocket 连接管理详解

本文档详细说明 `mac-mini-client` 中 WebSocket 连接的完整生命周期，包括连接建立、握手、心跳、断线重连、日志缓冲及错误处理。

---

## 连接建立流程

### URL 构造与协议转换

客户端读取 `SERVER_URL` 环境变量（默认 `http://localhost:3001`），自动将 HTTP 协议转换为对应的 WebSocket 协议：

```
http://your-server:3001  →  ws://your-server:3001/ws/executor?key=<EXECUTOR_KEY>
https://your-server      →  wss://your-server/ws/executor?key=<EXECUTOR_KEY>
```

具体实现：

```javascript
const HTTP_URL = new URL(SERVER_URL);
const WS_PROTOCOL = HTTP_URL.protocol === "https:" ? "wss:" : "ws:";
const WS_URL = `${WS_PROTOCOL}//${HTTP_URL.host}/ws/executor?key=${encodeURIComponent(EXECUTOR_KEY)}`;
```

`EXECUTOR_KEY` 经过 `encodeURIComponent` 编码，确保特殊字符不会破坏 URL 格式。

### 鉴权机制

鉴权密钥通过 URL 查询参数 `?key=` 传递。服务端在 WebSocket 握手阶段（HTTP Upgrade 请求时）从 URL 中提取 `key` 参数进行校验：

- 密钥匹配：允许升级为 WebSocket 连接
- 密钥不匹配：服务端拒绝连接，返回 HTTP 401 或直接关闭连接

这种鉴权方式简单可靠，不依赖 Cookie 或自定义 HTTP 头，与标准 WebSocket 完全兼容。

> **安全提示：** 生产环境中 `EXECUTOR_KEY` 应设置为随机强密钥，并通过 `wss://`（TLS）传输防止中间人窃取。

### 使用原生 WebSocket API

客户端使用 Node.js 22+ 内置的原生 `WebSocket` 全局对象，无需安装 `ws` 等第三方库：

```javascript
ws = new WebSocket(WS_URL);
ws.addEventListener("open", ...);
ws.addEventListener("message", ...);
ws.addEventListener("close", ...);
ws.addEventListener("error", ...);
```

---

## client.hello 握手消息

### 发送时机

WebSocket 连接建立（`open` 事件触发）后**立即**发送 `client.hello`，同时也启动一次初始心跳定时器。

### 完整 payload 格式

```json
{
  "type": "client.hello",
  "payload": {
    "client_id": "macmini-MyMac-a1b2c3d4",
    "name": "MyMac",
    "platform": "darwin",
    "app_version": "1.0.0",
    "tags": ["xcode", "ios", "arm64"],
    "capabilities": {
      "cpus": 8,
      "platform": "darwin",
      "arch": "arm64",
      "memory_total_mb": 16384,
      "memory_free_mb": 4096,
      "loadavg": [1.2, 1.5, 1.8],
      "uptime_sec": 86400,
      "work_dir": "/Users/builder/juma-work",
      "task_count": 3
    },
    "tasks": [
      {
        "name": "client.echo",
        "version": "1.0.0",
        "description": "客户端回显示例任务"
      },
      {
        "name": "client.mock3s",
        "version": "1.0.0",
        "description": "示例任务：模拟处理约3秒并返回JSON"
      },
      {
        "name": "client.fail_demo",
        "version": "1.0.0",
        "description": "示例异常任务：用于验证客户端异常处理、日志上报与 error 状态回传"
      }
    ]
  },
  "ts": 1711000000000
}
```

### 各字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| `client_id` | string | 客户端唯一标识，由 `CLIENT_ID` 环境变量控制 |
| `name` | string | 客户端显示名称，默认为主机名 |
| `platform` | string | 操作系统平台，来自 `process.platform`（`darwin` / `linux` / `win32`） |
| `app_version` | string | 客户端版本号 |
| `tags` | string[] | 客户端能力标签数组，用于任务分发筛选 |
| `capabilities` | object | 机器硬件与运行状态快照 |
| `capabilities.cpus` | number | CPU 核心数 |
| `capabilities.platform` | string | 同 `process.platform` |
| `capabilities.arch` | string | CPU 架构，来自 `process.arch`（`arm64` / `x64`） |
| `capabilities.memory_total_mb` | number | 系统总内存（MB） |
| `capabilities.memory_free_mb` | number | 当前空闲内存（MB） |
| `capabilities.loadavg` | number[3] | 1/5/15 分钟平均负载（来自 `os.loadavg()`） |
| `capabilities.uptime_sec` | number | 系统运行时间（秒） |
| `capabilities.work_dir` | string | 任务工作目录 |
| `capabilities.task_count` | number | 本客户端注册的任务数量 |
| `tasks` | object[] | 客户端支持的任务定义列表，每项含 `name`、`version`、`description` |

### 外层消息封装

所有发出的消息均通过 `sendWs(type, payload)` 函数统一封装：

```json
{
  "type": "client.hello",
  "payload": { ... },
  "ts": 1711000000000
}
```

`ts` 字段为发送时的 Unix 时间戳（毫秒），便于服务端做时序分析和延迟监控。

---

## server.hello 响应处理

### 接收格式

```json
{
  "type": "server.hello",
  "payload": {
    "heartbeat_interval_ms": 15000,
    "accepted_tasks": [
      { "name": "client.echo" },
      { "name": "client.mock3s" }
    ]
  }
}
```

### 处理逻辑

客户端收到 `server.hello` 后执行以下操作：

1. **更新心跳间隔**：若 `payload.heartbeat_interval_ms` 是大于 3000 的有限数字，则用此值覆盖本地的 `HEARTBEAT_INTERVAL_MS` 配置。这允许服务端统一管理所有客户端的心跳节奏。

2. **打印注册确认日志**：输出当前生效的心跳间隔，以及服务端接受的任务名称列表。

3. **（重新）启动心跳定时器**：用最新的 `heartbeatIntervalMs` 值启动定时器。

```javascript
if (type === "server.hello") {
  const remoteHeartbeat = Number(payload.heartbeat_interval_ms);
  if (Number.isFinite(remoteHeartbeat) && remoteHeartbeat > 3000) {
    heartbeatIntervalMs = remoteHeartbeat;
  }
  startHeartbeat();
}
```

> **为何有 3000ms 下限？** 防止服务端误配过小的间隔，导致客户端心跳风暴影响服务端性能。

---

## 心跳机制

### 心跳的作用

1. **保活长连接**：部分网络设备（NAT 路由器、负载均衡器）会在空闲连接上设置超时，心跳包可防止连接被静默关闭
2. **上报实时状态**：每次心跳携带当前的 capabilities（内存、负载等），服务端可据此监控机器健康状况
3. **离线检测依据**：服务端通过检测心跳超时来判断客户端是否已断线

### client.heartbeat 消息格式

```json
{
  "type": "client.heartbeat",
  "payload": {
    "client_id": "macmini-MyMac-a1b2c3d4",
    "capabilities": {
      "cpus": 8,
      "platform": "darwin",
      "arch": "arm64",
      "memory_total_mb": 16384,
      "memory_free_mb": 3800,
      "loadavg": [2.1, 1.8, 1.6],
      "uptime_sec": 86450,
      "work_dir": "/Users/builder/juma-work",
      "task_count": 3
    },
    "tasks": [
      { "name": "client.echo", "version": "1.0.0", "description": "..." },
      { "name": "client.mock3s", "version": "1.0.0", "description": "..." },
      { "name": "client.fail_demo", "version": "1.0.0", "description": "..." }
    ],
    "running_task_id": null
  },
  "ts": 1711000010000
}
```

注意 `running_task_id` 字段：若当前有任务正在执行，此处会填入对应的 `task_id`，服务端可据此判断客户端当前是否繁忙。

### 与服务端 OFFLINE_TIMEOUT_MS 的对应关系

```
客户端心跳间隔：HEARTBEAT_INTERVAL_MS（默认 10000ms）
服务端离线超时：OFFLINE_TIMEOUT_MS（服务端配置，建议 >= 3 × HEARTBEAT_INTERVAL_MS）

正常情况：
  T+0s    client.heartbeat
  T+10s   client.heartbeat
  T+20s   client.heartbeat
  ...

若客户端断线（无心跳）：
  T+0s    最后一次 client.heartbeat
  T+30s   服务端判断客户端 OFFLINE（OFFLINE_TIMEOUT_MS=30000）
```

建议将服务端的 `OFFLINE_TIMEOUT_MS` 设置为心跳间隔的 3 倍以上，以容忍网络抖动导致的偶发心跳丢失。

---

## 断线自动重连

### 触发条件

以下任一事件触发重连逻辑：

- `ws.close` 事件（连接被正常关闭或服务端主动断开）
- `ws.error` 事件后通常也会紧跟 `close` 事件（WebSocket 标准行为）

### 重连流程

```javascript
ws.addEventListener("close", () => {
  clearTimers();        // 清除心跳定时器和已有的重连定时器
  scheduleReconnect();  // 安排一次重连
});

function scheduleReconnect() {
  if (reconnectTimer) return;  // 防止重复安排
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();  // 重新建立 WebSocket 连接
  }, RECONNECT_DELAY_MS);
}
```

重连调用 `connect()` 函数，与首次连接路径完全相同：建立新的 `WebSocket` 对象，注册事件监听，发送 `client.hello`。

### 当前实现：固定延迟

目前的重连策略是**固定延迟**：每次断线后等待 `RECONNECT_DELAY_MS`（默认 3000ms）后重连。

```
断线 → 等待 3s → 重连尝试
失败 → 等待 3s → 重连尝试
失败 → 等待 3s → 重连尝试
...
```

### 指数退避的优化建议

对于生产环境，建议改用**指数退避**策略，避免服务端重启时大量客户端同时涌入：

```
第 1 次重连：等待 3s
第 2 次重连：等待 6s
第 3 次重连：等待 12s
第 4 次重连：等待 24s
...最大等待：120s（上限），之后保持最大值
成功连接后：重置计数器为 0
```

实现思路（供参考）：

```javascript
let reconnectAttempts = 0;
const BASE_DELAY = 3000;
const MAX_DELAY = 120000;

function getReconnectDelay() {
  const delay = Math.min(BASE_DELAY * Math.pow(2, reconnectAttempts), MAX_DELAY);
  reconnectAttempts++;
  return delay;
}

// 成功连接后（在 open 事件中）重置
reconnectAttempts = 0;
```

---

## 日志缓冲刷新机制

### 为什么需要缓冲而不是实时发送

任务执行过程中，日志可能以极高频率产生（例如编译输出、循环打印），如果每调用一次 `context.log()` 就立即发送一个 WebSocket 消息，会导致：

1. **大量小包**：WebSocket 消息本身有帧头开销，频繁发送小消息效率低
2. **服务端压力**：每条日志都触发一次数据库写入或广播，服务端处理负担重
3. **网络带宽浪费**：协议开销占比过高

缓冲机制将多条日志合并为一个批次统一发送，在实时性和效率之间取得平衡。

### 双阈值触发策略

日志缓冲采用"**大小阈值**"和"**时间阈值**"双重触发，满足任一条件即发送：

```
┌─────────────────────────────────────────────────────┐
│  日志缓冲区 logBuffer (string)                        │
│                                                     │
│  触发条件 1：Buffer.byteLength(logBuffer) >= 2048   │  ← LOG_FLUSH_SIZE
│  触发条件 2：当前时间 - lastFlushTs >= 2000ms        │  ← LOG_FLUSH_INTERVAL_MS
│  触发条件 3：任务执行完成（force=true）               │  ← 强制刷新
└─────────────────────────────────────────────────────┘
```

### 实现细节

```javascript
const flushLogs = async (force = false) => {
  if (!logBuffer) return;
  const enoughBySize = Buffer.byteLength(logBuffer, "utf8") >= LOG_FLUSH_SIZE;
  const enoughByTime = Date.now() - lastFlushTs >= LOG_FLUSH_INTERVAL_MS;
  if (!force && !enoughBySize && !enoughByTime) return;
  const payload = logBuffer;
  logBuffer = "";
  lastFlushTs = Date.now();
  appendTaskLog(taskId, payload);
};
```

关键细节：

- 使用 `Buffer.byteLength(logBuffer, "utf8")` 计算字节数而非字符数，正确处理 CJK 等多字节字符
- `logBuffer` 清空在 `appendTaskLog` 调用之前，若发送失败也不会无限积累（静默丢弃）
- 任务完成后调用 `await flushLogs(true)` 强制刷新，确保最后一批日志不丢失

### task.log 消息格式

```json
{
  "type": "task.log",
  "payload": {
    "task_id": "T-abc123",
    "append_log": "step 1/3\nstep 2/3\nstep 3/3\ndone\n"
  },
  "ts": 1711000005000
}
```

> **注意：** 实际代码中字段名为 `append_log`（非 `log`），表示追加式日志。服务端应将多次 `task.log` 的内容拼接存储。

---

## 错误处理

### 网络错误场景

**场景 1：服务端未启动或网络不通**

```
ws.error 事件触发，message 通常为 "connect ECONNREFUSED ..."
ws.close 事件随即触发
→ clearTimers() 清除所有定时器
→ scheduleReconnect() 安排 3s 后重连
→ 重复直到服务端恢复
```

控制台输出示例：
```
[2026-03-21T10:00:00.000Z] ws error: connect ECONNREFUSED 127.0.0.1:3001
[2026-03-21T10:00:00.001Z] ws disconnected, reconnect in 3000ms
```

**场景 2：服务端主动关闭连接（重启、维护）**

```
ws.close 事件触发（code 可能为 1001 Going Away 或 1006 Abnormal Closure）
→ 与场景 1 相同的重连逻辑
→ 服务端重启完成后，客户端会自动重新连接并重新握手
```

**场景 3：连接中途网络中断**

TCP 连接中断不会立即触发 WebSocket `close` 事件（取决于 TCP keepalive 配置），可能存在几十秒的延迟感知窗口。这段时间内：

- 心跳包发送会失败（`sendWs` 返回 false，打印警告）
- 服务端会因心跳超时将客户端标记为 OFFLINE
- 待 TCP 层感知到断连后，`close` 事件触发，客户端启动重连

### 服务端鉴权失败

若 `EXECUTOR_KEY` 配置错误，服务端会在 WebSocket 握手时拒绝连接（通常返回 HTTP 401 或直接关闭），`close` 事件会触发，客户端进入重连循环。由于密钥不变，重连后仍会被拒绝，形成无限循环。

**建议：** 服务端在鉴权失败时，应在 `close` 消息中携带错误码，客户端收到特定错误码后应停止重连。当前版本尚未实现此优化。

### 消息解析错误

收到无效 JSON 时，`handleMessage` 函数捕获解析异常并静默忽略：

```javascript
try {
  envelope = JSON.parse(String(raw));
} catch {
  return;  // 忽略无效消息
}
```

这防止了单条错误消息导致整个连接崩溃。

### 任务执行期间连接断开

若任务正在执行期间 WebSocket 断开：

1. 心跳定时器被清除（`clearTimers()`）
2. 任务继续在本地执行（`executeTask` 是一个独立的 async 函数，不依赖连接存活）
3. 任务完成时尝试发送 `task.update`，但此时 `ws.readyState !== WebSocket.OPEN`，`sendWs` 返回 `false` 并打印警告
4. 状态更新丢失，服务端不会收到最终结果

**当前限制：** 断线期间的任务状态更新无本地缓存，重连后也不会重发。这是一个已知的功能缺口，详见 `development-progress.md`。
