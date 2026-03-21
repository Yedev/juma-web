# WebSocket 执行器网关文档

`server/src/ws/executorWsGateway.ts` 实现了一个自定义的 WebSocket 服务器，用于与远程执行器客户端（如 `mac-mini-client`）建立持久连接，并通过消息协议分发 `client_task` 任务。

---

## 1. 整体架构

```
HTTP Server（port: 3001）
        │
        │  server.on('upgrade', handler)
        ▼
  路径校验：仅 /ws/executor
        │
  密钥校验：x-executor-key header 或 ?key=... 查询参数
        │
  RFC 6455 握手升级
        │
        ▼
   WsConnection 实例
   （手动帧解析，事件驱动）
        │
        ├─ onMessage → 消息类型路由
        │   ├─ client.hello    → handleHello()
        │   ├─ client.heartbeat → 更新心跳
        │   ├─ task.update     → handleTaskUpdate()
        │   └─ task.log        → handleTaskLog()
        │
        └─ onClose → 清理 session，标记客户端 offline

  sessions Map<clientId, ExecutorSession>
        │
        └─ setInterval(dispatch, 1500ms)
               ↓
          轮询 DB queued client_tasks
          匹配在线执行器，发送 task.assign
```

---

## 2. 为什么不使用 ws 库

服务器选择手动实现 RFC 6455 WebSocket 协议，而非使用 `ws` npm 包，原因如下：

1. **零依赖**：避免引入额外的运行时依赖，减小部署包体积
2. **完全控制**：直接操作 TCP 流，可以精确控制帧格式、掩码处理、Ping/Pong 响应
3. **轻量场景**：执行器网关仅处理少量长连接（通常 1–10 个客户端），不需要 `ws` 库的完整功能
4. **教育价值**：代码本身展示了 RFC 6455 的核心实现细节

---

## 3. WsConnection 类

### 构造函数

```typescript
class WsConnection {
  private buffer = Buffer.alloc(0);   // 接收缓冲区（粘包处理）
  private closed = false;

  constructor(private readonly socket: Duplex)
}
```

监听 socket 的 `data`、`close`、`error` 事件。

### RFC 6455 帧解析（handleData）

WebSocket 帧格式：
```
 0                   1                   2                   3
 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
+-+-+-+-+-------+-+-------------+-------------------------------+
|F|R|R|R| opcode|M| Payload len |    Extended payload length    |
|I|S|S|S|  (4)  |A|     (7)    |             (16/64)           |
|N|V|V|V|       |S|             |   (if payload len==126/127)   |
| |1|2|3|       |K|             |                               |
+-+-+-+-+-------+-+-------------+-------------------------------+
|     Masking-key (32 bits, if MASK set)                       |
+-------------------------------+-------------------------------+
|                    Payload Data                              |
+---------------------------------------------------------------+
```

解析逻辑：
```
1. 累积数据到 buffer（处理 TCP 粘包）
2. 循环解析直到 buffer 不足一帧：
   a. 读取 first byte：FIN 位（0x80）和 opcode（0x0F）
   b. 读取 second byte：MASK 位（0x80）和基础 payload 长度（0x7F）
   c. 扩展长度：
      - payloadLen 126 → 读取后续 2 字节（UInt16BE）
      - payloadLen 127 → 读取后续 8 字节（UInt32BE × 2）
   d. 强制要求客户端发送帧必须掩码（MASK=1），否则关闭连接（code 1002）
   e. 读取 4 字节 masking key
   f. 解码 payload：payload[i] ^= mask[i % 4]
   g. 根据 opcode 处理：
      - 0x1（Text）→ 解析为 UTF-8 字符串，调用 messageHandlers
      - 0x8（Close）→ 关闭连接
      - 0x9（Ping）→ 自动回复 Pong（opcode 0xA）
3. 从 buffer 移除已处理的帧
```

### 发送帧（sendFrame）

服务端发送的帧**不需要**掩码（RFC 6455 规定服务端到客户端无需掩码）：

```
payload 长度 < 126    → 2字节 header：[FIN|opcode, len]
payload 长度 < 65536  → 4字节 header：[FIN|opcode, 126, len_hi, len_lo]
payload 长度 >= 65536 → 10字节 header：[FIN|opcode, 127, 8字节大端长度]
```

### 公开接口

```typescript
// 发送 JSON 消息（type + payload + ts 三元组）
sendJson(type: string, payload: JsonObj): void

// 关闭连接（发送 Close 帧 + socket.end）
close(code = 1000, reason = ""): void

// 注册消息回调
onMessage(handler: (message: string) => void): void

// 注册关闭回调
onClose(handler: () => void): void
```

---

## 4. 连接建立与认证

### WebSocket 升级握手

```
1. HTTP Upgrade 请求到达 server 的 'upgrade' 事件
2. 路径检查：parsedUrl.pathname !== "/ws/executor" → 404 并销毁 socket
3. 密钥校验 validateExecutorKey()：
   a. 检查 req.headers["x-executor-key"] === EXECUTOR_SHARED_KEY
   b. 或检查 URL 查询参数 ?key=EXECUTOR_SHARED_KEY
   → 失败：返回 HTTP 401 并销毁 socket
4. RFC 6455 握手 upgradeToWs()：
   a. 读取 Sec-WebSocket-Key 请求头
   b. 计算 accept = base64(SHA1(key + WS_GUID))
      WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
   c. 写入 HTTP 101 响应：
      HTTP/1.1 101 Switching Protocols
      Upgrade: websocket
      Connection: Upgrade
      Sec-WebSocket-Accept: {accept}
5. 创建 WsConnection 实例，绑定消息和关闭处理器
```

连接 URL 示例：
```
ws://localhost:3001/ws/executor?key=juma_executor_2026
# 或
ws://localhost:3001/ws/executor
# 并设置 Header: x-executor-key: juma_executor_2026
```

---

## 5. 消息协议

所有消息均为 JSON 格式，包含三个顶层字段：

```json
{
  "type": "消息类型",
  "payload": { ... },
  "ts": 1711234567890
}
```

`ts` 字段由服务端发送时自动添加（`Date.now()`）。

### 5.1 client.hello（客户端 → 服务端）

客户端连接后第一条消息，完成注册。

**payload**：
```json
{
  "client_id": "mac-mini-01",          // 必填，唯一客户端 ID
  "name": "Mac Mini 开发机",            // 必填，显示名称
  "platform": "darwin",                 // 可选，默认 "darwin"
  "app_version": "1.2.0",              // 可选，默认 "unknown"
  "tags": ["production", "mac", "x86"], // 可选，字符串数组
  "capabilities": {                     // 可选，能力描述对象
    "max_concurrency": 3               // 最大并发任务数（1-20，默认1）
  },
  "tasks": [                           // 声明支持的任务列表
    { "name": "client.echo", "version": "1.0.0", "description": "回显任务" },
    { "name": "client.mock3s" }
  ]
}
```

- `tasks` 也可以是字符串数组：`["client.echo", "client.mock3s"]`
- 任务名称必须以 `client.` 开头（通过 `inferTaskTypeFromName` 验证）
- 如果同一 `client_id` 已有连接，旧连接会被关闭（发送 Close frame，code 1012）

**处理逻辑**：
1. 解析 payload，验证 client_id 和 name 非空
2. upsert `ExecutorClient` 记录（更新名称、标签、能力、IP、心跳时间、状态=online）
3. 更新内存中的 sessions Map
4. 回复 server.hello
5. 立即触发一次任务分发

### 5.2 server.hello（服务端 → 客户端）

响应 client.hello 的确认消息。

**payload**：
```json
{
  "client_id": "mac-mini-01",
  "heartbeat_interval_ms": 10000,       // 建议心跳间隔（由 EXECUTOR_HEARTBEAT_INTERVAL_MS 决定）
  "accepted_tasks": [                   // 服务端确认接受的任务定义
    { "name": "client.echo", "version": "1.0.0" }
  ],
  "max_concurrency": 3,
  "server_time": "2026-03-01T10:00:00.000Z"
}
```

### 5.3 client.heartbeat（客户端 → 服务端）

客户端定期发送，防止连接被标记为 offline。

**payload**：`{}` 或任意内容（服务端忽略）

**处理逻辑**：
1. 更新 `ExecutorClient.lastHeartbeat = now`，`status = "online"`
2. 回复 `server.heartbeat.ack`

**响应**：
```json
{ "type": "server.heartbeat.ack", "payload": { "ok": true }, "ts": 1711234567890 }
```

### 5.4 task.assign（服务端 → 客户端）

服务端分发任务给执行器客户端。

**payload**：
```json
{
  "task_id": "T17111234567890042",
  "task_name": "client.echo",
  "task_payload": { "message": "hello", "repeat": 3, "sleep_ms": 500 },
  "execution_name": "测试回显任务"
}
```

客户端接收后应立即开始执行，并通过 `task.update` 报告状态变化。

### 5.5 task.update（客户端 → 服务端）

客户端报告任务状态变化。

**payload**：
```json
{
  "task_id": "T17111234567890042",
  "status": "running",                // "running" | "completed" | "error"
  "result_code": 0,                   // 可选，完成/错误时的结果码
  "status_info": {                    // 可选，附加信息
    "step": "2/5",
    "message": "处理中"
  }
}
```

**处理逻辑**：
1. 验证 clientId 已注册（必须先发送 client.hello）
2. 验证 status 合法（running/completed/error）
3. 从数据库查找任务，验证 taskType="client_task" 且 claimedByClientId=本客户端
4. 合并 statusInfo（保留旧 statusInfo，追加新字段，附加 executor/client_id/reported_at）
5. 更新数据库：
   - status=running 且未设 startedAt → 设置 startedAt=now
   - status=completed/error → 设置 finishedAt=now，记录 resultCode
6. 更新执行器统计（tasksSuccess 或 tasksFailed）
7. 更新心跳时间
8. 回复 `task.update.ack`，触发下一次任务分发

**响应**：
```json
{ "type": "task.update.ack", "payload": { "task_id": "T...", "status": "completed" }, "ts": ... }
```

### 5.6 task.log（客户端 → 服务端）

客户端追加任务执行日志（实时上报，不等待任务结束）。

**payload**：
```json
{
  "task_id": "T17111234567890042",
  "append_log": "Step 2/5: 编译源码...\n"
}
```

**处理逻辑**：
1. 验证 clientId 已注册
2. 从数据库查找任务，验证 taskType 和 claimedByClientId
3. 追加日志：`executionLog = trimLog(existing + "\n" + appendLog)`
4. 回复 `task.log.ack`

**响应**：
```json
{ "type": "task.log.ack", "payload": { "task_id": "T..." }, "ts": ... }
```

### 5.7 server.error（服务端 → 客户端）

任何处理出错时的通用错误响应。

```json
{
  "type": "server.error",
  "payload": { "code": 400, "message": "invalid task.update payload" },
  "ts": ...
}
```

---

## 6. 任务分发逻辑（dispatch）

dispatch 函数每 `DISPATCH_INTERVAL_MS`（默认 1500ms）执行一次，也在 client.hello 和 task.update 后立即触发。

### 分发算法

```
1. 检查 sessions.size === 0 → 直接返回
2. 查询每个在线客户端当前 running 的任务数（groupBy claimedByClientId）
3. 查询 status="queued" AND taskType="client_task" 的任务（最多100条，按 createdAt ASC）
4. 对每个待分发任务：
   a. 验证 taskName 格式合法（必须 client.*）
   b. 从 taskParams 解析 requiredTags 和 executionName
   c. 遍历所有 session，找到第一个满足条件的执行器：
      - 如果任务有 targetClientId：session.clientId 必须匹配
      - session.tasks（Set）必须包含 task.taskName
      - 如果 requiredTags 非空：session.tags 必须包含所有 requiredTags（AND 语义）
      - 该 session 的当前 running 数 < session.maxConcurrency
   d. 如果找到合适的执行器：
      - 乐观锁更新：updateMany({ where: { id, status: "queued" } })
      - 如果 claimed.count === 0（已被抢占）→ 跳过
      - 更新 ExecutorClient.tasksClaimed++
      - 更新内存 runningMap（防止同一个执行器在本次 dispatch 中被过度分配）
      - 发送 task.assign 消息
```

### required_tags AND 匹配

```typescript
const matched = envelope.requiredTags.every((tag) => session.tags.includes(tag));
```

要求客户端的 tags 数组包含任务所有的 requiredTags，是严格的"全包含"语义。

**示例**：
- 任务 `required_tags: ["production", "mac"]`
- 客户端 A tags: `["production", "mac", "arm64"]` → 匹配
- 客户端 B tags: `["production", "linux"]` → 不匹配（缺少 "mac"）

---

## 7. 客户端超时检测

### SWEEP_INTERVAL_MS（10秒）

`executionEngine.ts` 中的扫描定时器每 10 秒：
1. 调用 `refreshExecutorStatus()`：根据 `lastHeartbeat` 更新客户端在线状态
2. 调用 `recoverStaleRemoteTasks()`：恢复因客户端离线而卡住的任务

### OFFLINE_TIMEOUT_MS（60秒）

如果客户端 `lastHeartbeat < now - 60s`，则标记为 offline。

推荐的客户端心跳间隔：`10秒`（由 server.hello 中的 `heartbeat_interval_ms` 字段告知）。这样有约 6 次心跳失败的容忍度。

### WebSocket 断开时的即时处理

当 socket 发生 `close` 或 `error` 事件：
```typescript
conn.onClose(() => {
  sessions.delete(conn.clientId);   // 从内存会话中移除
  prisma.executorClient.update({ status: "offline" });  // 立即标记离线
});
```

---

## 8. 远程任务超时（REMOTE_TASK_STALE_TIMEOUT_MS = 300秒）

对于 `status="running"` 且 `claimedAt < now - 5分钟` 的 client_task：
- 若关联客户端已离线（offline 或 lastHeartbeat > 60秒前）：
  - `retryCount < maxRetries` → 重置为 queued，retryCount+1
  - 否则 → 标记为 error（`"客户端离线且超过最大重试次数"`）
- 若关联客户端仍在线 → 跳过（任务可能仍在执行中）

---

## 9. ExecutorSession 内存结构

```typescript
interface ExecutorSession {
  clientId: string;          // 客户端唯一 ID
  conn: WsConnection;        // 对应的 WebSocket 连接
  tasks: Set<string>;        // 支持的任务名集合（快速查找）
  tags: string[];            // 客户端标签列表
  maxConcurrency: number;    // 最大并发任务数（1-20）
}
```

`sessions` 是一个 `Map<string, ExecutorSession>`，key 为 clientId。同一 clientId 重连时旧会话被替换。
