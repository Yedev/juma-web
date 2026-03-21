# 系统架构详解

## 目录

- [整体架构](#整体架构)
- [模块职责](#模块职责)
- [数据流分析](#数据流分析)
- [认证体系](#认证体系)
- [任务执行引擎](#任务执行引擎)
- [WebSocket 执行器网关](#websocket-执行器网关)
- [前端架构](#前端架构)
- [数据库设计](#数据库设计)

---

## 整体架构

juma-web 采用经典的**前后端分离**架构，后端为单体 Express 服务，前端为独立的 React SPA。

```
┌──────────────────────────────────────────────────────────────────────┐
│                           客户端层                                     │
│                                                                        │
│  ┌─────────────────┐  ┌──────────────────┐  ┌─────────────────────┐  │
│  │   Admin UI       │  │    移动端 App     │  │  Mac Mini 执行器    │  │
│  │  (React + Vite)  │  │  (iOS/Android)   │  │  (mac-mini-client)  │  │
│  │  port: 5173      │  │                  │  │  Node.js WS Client  │  │
│  └────────┬─────────┘  └────────┬─────────┘  └──────────┬──────────┘  │
└───────────┼─────────────────────┼──────────────────────-─┼─────────────┘
            │                     │                         │
            │ HTTP REST           │ HTTP REST               │ WebSocket
            │ Authorization:      │ x-timestamp             │ ?key=EXECUTOR_KEY
            │ Bearer <token>      │ x-sign: MD5(...)        │
            ▼                     ▼                         ▼
┌──────────────────────────────────────────────────────────────────────┐
│                     Express Server (port: 3001)                        │
│                                                                        │
│  ┌───────────────────────────────────────────────────────────────┐   │
│  │                         中间件层                                │   │
│  │  cors · json parser · authMiddleware · signMiddleware · drAuth │   │
│  └───────────────────────────────────────────────────────────────┘   │
│                                                                        │
│  ┌────────────┐  ┌────────────────┐  ┌──────────┐  ┌────────────┐   │
│  │ /api/auth  │  │  /api/admin    │  │/api/v1/  │  │/api/v1/dr/ │   │
│  │            │  │  管理后台接口   │  │  app/    │  │DeepRead API│   │
│  │  登录       │  │  任务/配置/DR  │  │ 移动端   │  │            │   │
│  └────────────┘  └────────────────┘  └──────────┘  └────────────┘   │
│                                                                        │
│  ┌────────────────────────────────────────────────────────────────┐   │
│  │                       服务层                                    │   │
│  │  taskRegistry · taskEnqueue · serverTaskRuntime · executionEngine│  │
│  └────────────────────────────────────────────────────────────────┘   │
│                                                                        │
│  ┌─────────────────────┐  ┌──────────────────────────────────────┐   │
│  │  WebSocket 网关       │  │          Prisma ORM                  │   │
│  │  executorWsGateway   │  │     (SQLite / file: juma.db)         │   │
│  └─────────────────────┘  └──────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 模块职责

### 后端模块

#### `src/index.ts` — 服务入口
- 初始化 Express app
- 挂载所有中间件（cors、json parser）
- 注册路由（auth、admin、app、deepread）
- 创建 HTTP Server
- 启动 WebSocket 网关（`executorWsGateway`）
- 启动本地执行引擎（`executionEngine`）

#### `src/middleware/` — 中间件

| 文件 | 功能 |
|------|------|
| `auth.ts` | 验证管理员 Bearer JWT，设置 `req.userId/username` |
| `sign.ts` | 验证 x-timestamp 和 x-sign（MD5 签名），防重放攻击 |
| `drAuth.ts` | 验证 DeepRead 用户 Bearer JWT，设置 `req.drUserId` |

#### `src/routes/` — 路由层

| 文件 | 路径前缀 | 说明 |
|------|----------|------|
| `auth.ts` | `/api/auth` | 管理员登录 |
| `admin.ts` | `/api/admin` | 管理后台全部接口（需 JWT） |
| `app.ts` | `/api/v1/app` | 移动端接口（需 x-sign） |
| `deepread.ts` | `/api/v1/dr` | DeepRead 客户端接口（需 x-sign，部分需 JWT） |

#### `src/services/` — 业务逻辑层

| 文件 | 说明 |
|------|------|
| `taskRegistry.ts` | 任务注册中心，维护所有合法任务定义（名称/类型/参数 Schema/示例） |
| `taskEnqueue.ts` | 任务入队，验证任务名，创建数据库记录，生成 taskId |
| `taskNaming.ts` | 从任务名前缀推断任务类型（`server.*` or `client.*`） |
| `serverTaskRuntime.ts` | 服务端任务的具体执行逻辑（`server.echo` 等） |
| `executionEngine.ts` | 轮询数据库中 queued 的 server_task，并发执行，写回结果 |

#### `src/ws/executorWsGateway.ts` — WebSocket 网关
- 实现 RFC 6455 WebSocket 帧的手动解析与封装
- 管理所有远程执行器连接（`WsConnection` 类）
- 处理 `client.hello`、`client.heartbeat`、`task.update`、`task.log`
- 向合适的客户端推送 `task.assign`（根据 tags 和 clientId 筛选）
- 定时扫描：标记超时客户端为 offline，分发待处理的 client_task

---

## 数据流分析

### 移动端触发任务

```
移动端 App
  │
  │ POST /api/v1/app/task/execute
  │ Headers: x-timestamp, x-sign
  │ Body: { task_name, task_payload, execution_name }
  │
  ▼
signMiddleware ──验证失败──► 403/401
  │ 验证通过
  ▼
routes/app.ts::executeTask
  │
  ├── taskRegistry.prepareRegisteredTask()  ──未注册──► 404
  │
  ├── taskEnqueue.enqueueTaskByRegisteredName()
  │   └── INSERT Task (status=queued)
  │
  └── 返回 { task_id }
```

### 本地任务执行（server_task）

```
executionEngine (轮询，每 LOCAL_EXECUTOR_POLL_MS ms)
  │
  ├── 查询 queued + server_task
  │
  ├── UPDATE status=running, started_at=now
  │
  ├── serverTaskRuntime.executeServerTaskByName()
  │   └── 具体任务逻辑（如 server.echo 循环打印）
  │       └── 写入 executionLog
  │
  └── UPDATE status=completed/error, finished_at=now, result_code
```

### 远程任务执行（client_task）

```
executorWsGateway (轮询，每 EXECUTOR_DISPATCH_INTERVAL_MS ms)
  │
  ├── 查询 queued + client_task
  │
  ├── 筛选匹配的在线客户端（required_tags、target_client_id）
  │
  ├── UPDATE status=running, claimed_by_client_id
  │
  ├── 推送 task.assign 至客户端（WebSocket）
  │
  │   ┌─── Mac Mini 客户端 ───────────────────────────────┐
  │   │ 执行任务逻辑                                        │
  │   │ → task.log (实时日志)                              │
  │   │ → task.update (running/completed/error)            │
  │   └──────────────────────────────────────────────────┘
  │
  └── 收到 task.update → UPDATE Task 状态至数据库
```

---

## 认证体系

系统包含三套独立的认证机制：

### 1. 管理员认证（JWT，24小时）

```
POST /api/auth/login
  { username, password }
  │
  ├── bcrypt.compare(password, stored_hash)
  │
  └── jwt.sign({ userId, username }, JWT_SECRET, { expiresIn: '24h' })
      → token

使用：Authorization: Bearer <token>
验证：authMiddleware → jwt.verify(token, JWT_SECRET)
```

### 2. 移动端签名认证（x-sign，MD5）

```
请求携带：
  x-timestamp: <13位毫秒时间戳>
  x-sign: MD5(APP_SECRET + x-timestamp)

验证逻辑（sign.ts）：
  1. |now - x-timestamp| > 5分钟 → 403 (时间戳过期)
  2. MD5(APP_SECRET + x-timestamp) !== x-sign → 401 (签名错误)
  3. 通过 → next()
```

### 3. DeepRead 用户认证（双层）

```
外层：x-sign（同上，所有 /api/v1/dr/* 均需要）
内层：
  POST /api/v1/dr/login  →  jwt.sign({userId}, DR_JWT_SECRET, {expiresIn: '30d'})
  使用：Authorization: Bearer <dr_token>
  验证：drAuthMiddleware → jwt.verify(token, DR_JWT_SECRET)
```

### 4. WebSocket 执行器认证（共享密钥）

```
连接：ws://host/ws/executor?key=<EXECUTOR_SHARED_KEY>
验证：URL 参数 key === process.env.EXECUTOR_SHARED_KEY
失败：HTTP 401，关闭连接
```

---

## 任务执行引擎

### 本地执行引擎（executionEngine.ts）

```
┌──────────────────────────────────────────────────┐
│  executionEngine                                   │
│                                                    │
│  配置：                                            │
│  - POLL_MS: 每次扫描间隔（默认 2000ms）            │
│  - CONCURRENCY: 最大并发数（默认 1）               │
│                                                    │
│  主循环：                                          │
│  while (true) {                                    │
│    tasks = DB.findMany({                           │
│      status: 'queued',                             │
│      taskType: 'server_task',                      │
│      limit: CONCURRENCY - running.size             │
│    })                                              │
│    for (task of tasks) {                           │
│      executeTask(task) // 异步，不等待             │
│    }                                               │
│    await sleep(POLL_MS)                            │
│  }                                                 │
│                                                    │
│  executeTask(task):                                │
│  1. UPDATE status=running                          │
│  2. serverTaskRuntime.execute(task)                │
│  3. 捕获日志，截断至 TASK_LOG_MAX_BYTES            │
│  4. UPDATE status=completed/error                  │
│  5. 失败时检查 retryCount < maxRetries → 重新排队  │
└──────────────────────────────────────────────────┘
```

### WebSocket 执行器网关（executorWsGateway.ts）

```
┌──────────────────────────────────────────────────────────────┐
│  executorWsGateway                                             │
│                                                                │
│  定时任务（每 DISPATCH_INTERVAL_MS）：                         │
│  ┌────────────────────────────────────────────────────────┐   │
│  │ dispatchClientTasks()                                  │   │
│  │                                                        │   │
│  │ 1. 查询 queued + client_task                           │   │
│  │ 2. 按任务的 required_tags/target_client_id 筛选客户端  │   │
│  │ 3. 从在线客户端中选取第一个匹配者                       │   │
│  │ 4. UPDATE task (status=running, claimed_by_client_id)  │   │
│  │ 5. 发送 task.assign WebSocket 消息                     │   │
│  └────────────────────────────────────────────────────────┘   │
│                                                                │
│  定时任务（每 SWEEP_INTERVAL_MS）：                            │
│  ┌────────────────────────────────────────────────────────┐   │
│  │ sweepOfflineClients()                                  │   │
│  │                                                        │   │
│  │ 遍历所有已注册客户端                                    │   │
│  │ lastHeartbeat + OFFLINE_TIMEOUT < now → UPDATE offline │   │
│  └────────────────────────────────────────────────────────┘   │
│                                                                │
│  任务超时处理：                                                │
│  running + client_task + startedAt + STALE_TIMEOUT < now      │
│  → UPDATE status=error (执行器离线/超时)                       │
└──────────────────────────────────────────────────────────────┘
```

---

## 前端架构

### 路由结构

```
/login                    ← 登录页（不需要认证）
/                         ← 需要认证（RequireAuth 守卫）
  ├── /tasks              ← 任务管理
  ├── /config             ← 配置管理
  ├── /api-playground     ← API 接口文档
  ├── /dr/spaces          ← 空间管理
  ├── /dr/channels        ← 频道管理
  ├── /dr/articles        ← 文章管理
  └── /dr/users           ← 用户管理
```

### 认证流程（前端）

```
1. 登录成功 → 保存 token 至 localStorage
2. api/client.ts 的 Axios 请求拦截器：
   - 自动读取 localStorage 中的 token
   - 注入 Authorization: Bearer <token>
3. 响应拦截器：
   - 401 → 清除 token → 跳转 /login
4. RequireAuth 组件：
   - 无 token → <Navigate to="/login" />
```

### 组件数据流

```
Page Component (e.g., TaskManagement)
  │
  ├── useEffect → api.get('/api/admin/tasks') → setState(data)
  │
  ├── Table → 渲染数据
  │
  ├── Modal + Form → 表单提交 → api.post/put/delete
  │
  └── 刷新数据 → fetchData()
```

---

## 数据库设计

### 核心实体关系

```
AdminUser                AppConfig
   id                       id
   username (unique)         configKey (unique)
   password                  configValue (JSON)
   createdAt                 updatedAt

Task
   id, taskId (unique)
   taskName, taskType
   targetClientId, claimedByClientId
   taskParams (JSON)
   status: queued|running|completed|error
   statusInfo (JSON), executionLog
   resultCode, maxRetries, retryCount
   claimedAt, startedAt, finishedAt, createdAt, updatedAt

ExecutorClient
   id, clientId (unique)
   name, platform, appVersion
   tags (JSON), capabilities (JSON)
   status: online|offline
   ip, lastHeartbeat
   totalTasks, completedTasks, failedTasks, runningTasks
```

### DeepRead 实体关系

```
DrUser ─────────────────────── DrSmsCode
  │ id, phone (unique)              id, phone, code, expiresAt
  │ nickname, avatar
  │
  ├──── DrSpaceMember ──────── DrSpace ─────── DrInviteCode
  │       spaceId, userId          id, spaceId (unique)
  │       role, joinedAt           name, description
  │                                inviteCode (unique)
  │
  ├──── DrBookmark ─────────── DrArticle ──── DrChannel ─── DrSpace
  │       userId, articleId         id, articleId           channelId, spaceId
  │
  ├──── DrReadStatus
  │       userId, articleId, progress
  │
  ├──── DrHighlight
  │       userId, articleId
  │       text, color, positionData (JSON), note
  │
  └──── DrCollection
           id, collectionId
           userId, name
             └── DrCollectionArticle
                   collectionId, articleId
```

### 唯一约束

| 模型 | 唯一约束 |
|------|----------|
| `AdminUser` | `username` |
| `AppConfig` | `configKey` |
| `Task` | `taskId` |
| `ExecutorClient` | `clientId` |
| `DrUser` | `phone` |
| `DrSpace` | `spaceId`, `inviteCode` |
| `DrSpaceMember` | `(spaceId, userId)` |
| `DrInviteCode` | `codeId`, `code` |
| `DrChannel` | `channelId` |
| `DrArticle` | `articleId` |
| `DrBookmark` | `(userId, articleId)` |
| `DrReadStatus` | `(userId, articleId)` |
| `DrHighlight` | `highlightId` |
| `DrCollection` | `collectionId` |
| `DrCollectionArticle` | `(collectionId, articleId)` |
