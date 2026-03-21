# Server 模块架构文档

## 1. 模块职责概述

`server/` 是 juma-web 项目的后端核心，基于 **Node.js 22 + Express 4.21.2 + TypeScript 5.7.3** 构建。其主要职责包括：

- **Admin API**：提供管理后台所需的全套 REST 接口，含任务管理、配置管理、Executor 客户端管理、DeepRead 内容管理等。
- **App API**：面向移动端客户端，提供配置读取、任务下发、任务状态查询等接口，采用签名鉴权。
- **DeepRead API**：面向 DeepRead 阅读器客户端，提供 SMS 登录、空间/频道/文章浏览、批注、合集、AI 对话等完整功能。
- **任务执行引擎**：轮询数据库中待执行的 `server_task` 类型任务，在本地并发执行，同时负责周期性清理过期 Executor 状态和恢复超时的远程任务。
- **WebSocket 执行网关**：基于 RFC 6455 手动实现的 WebSocket 服务，管理远程 Executor 客户端（Mac Mini 等）的连接，将 `client_task` 分发给合适的客户端执行，接收并持久化执行结果和日志。
- **静态资源服务**：将 Admin UI 的构建产物（`public/`）托管为 SPA，兜底路由返回 `index.html`。

---

## 2. 目录结构

```
server/
├── package.json                  # 项目依赖与脚本
├── tsconfig.json                 # TypeScript 配置
├── prisma/
│   └── schema.prisma             # 数据库模型定义（16 个模型）
└── src/
    ├── index.ts                  # 应用入口，挂载路由、启动引擎
    ├── middleware/
    │   ├── auth.ts               # Admin JWT 鉴权中间件
    │   ├── sign.ts               # x-sign MD5 签名验证中间件
    │   └── drAuth.ts             # DeepRead JWT 鉴权中间件
    ├── routes/
    │   ├── auth.ts               # POST /api/auth/login（管理员登录）
    │   ├── admin.ts              # /api/admin/* 全套管理接口（JWT 保护）
    │   ├── app.ts                # /api/v1/app/* 移动端接口（签名保护）
    │   └── deepread.ts           # /api/v1/dr/* DeepRead 接口（签名+JWT）
    ├── services/
    │   ├── taskRegistry.ts       # 任务注册表，定义全部已知任务
    │   ├── taskEnqueue.ts        # 任务入队逻辑，生成 taskId，写入数据库
    │   ├── taskNaming.ts         # 任务命名规则（server.* / client.*）
    │   ├── serverTaskRuntime.ts  # 内置服务端任务实现（server.echo 等）
    │   └── executionEngine.ts    # 任务轮询引擎，本地并发执行与状态维护
    ├── ws/
    │   └── executorWsGateway.ts  # WebSocket 网关（RFC 6455 手动实现）
    └── prisma/
        └── seed.ts               # 数据库种子脚本
```

---

## 3. 启动流程

`src/index.ts` 按以下顺序完成初始化：

```
1. 创建 Express 实例，读取 PORT 环境变量（默认 3001）
2. 初始化 PrismaClient
3. 注册全局中间件
   ├── cors()               ← 允许跨域
   └── express.json()       ← 解析 JSON 请求体
4. 注册路由
   ├── GET  /api/health     ← 健康检查（无鉴权）
   ├── /api/auth            ← 管理员登录
   ├── /api/admin           ← 管理后台 API（JWT 保护）
   ├── /api/v1/app          ← 移动端 API（签名保护）
   ├── /api/v1/dr           ← DeepRead API（签名+JWT）
   └── express.static()     ← 托管 public/ 目录（Admin UI）
       └── GET *            ← SPA 兜底，返回 index.html
5. 创建 HTTP Server（封装 Express app）
6. createExecutorWsGateway(server, prisma)
   └── 监听 server 的 'upgrade' 事件，处理 /ws/executor 路径的 WS 握手
7. startExecutionEngine(prisma)
   ├── 立即执行：failLegacyQueuedTasks、scheduleLocalTasks、refreshExecutorStatus、recoverStaleRemoteTasks
   ├── setInterval(scheduleLocalTasks, LOCAL_EXECUTOR_POLL_MS)   ← 默认 2000ms
   └── setInterval(refreshExecutorStatus + recoverStaleRemoteTasks, EXECUTOR_SWEEP_INTERVAL_MS) ← 默认 10000ms
8. server.listen(PORT) ← 开始监听端口
```

---

## 4. 请求处理流程

### 4.1 管理员 API（/api/admin/*）

```
HTTP Request
    → cors()
    → express.json()
    → authMiddleware (验证 Authorization: Bearer <JWT>)
    → 路由处理函数
    → Prisma 操作数据库
    → JSON 响应
```

### 4.2 移动端 API（/api/v1/app/*）

```
HTTP Request
    → cors()
    → express.json()
    → signMiddleware (验证 x-timestamp + x-sign)
    → 路由处理函数
    → JSON 响应
```

### 4.3 DeepRead API（/api/v1/dr/*）

```
HTTP Request
    → cors()
    → express.json()
    → signMiddleware (全路由统一签名验证)
    ├── [公开接口] POST /sms/send, POST /login
    │       → 路由处理函数（无 JWT 要求）
    └── [受保护接口]
            → drAuthMiddleware (验证 Authorization: Bearer <DR JWT>)
            → 路由处理函数
            → JSON 响应
```

### 4.4 WebSocket 执行网关（ws://host/ws/executor）

```
HTTP Upgrade Request
    → server 'upgrade' 事件
    → 路径检查（必须是 /ws/executor）
    → validateExecutorKey（检查 x-executor-key header 或 ?key= 参数）
    → upgradeToWs（RFC 6455 握手，计算 Sec-WebSocket-Accept）
    → WsConnection 实例（帧解析循环）
    → 消息分发：client.hello / client.heartbeat / task.update / task.log
```

---

## 5. 模块依赖关系图

```
┌─────────────────────────────────────────────────────────┐
│                      src/index.ts                        │
│  Express App + HTTP Server + Prisma 初始化               │
└──────┬──────────────┬─────────────────┬─────────────────┘
       │              │                 │
       ▼              ▼                 ▼
┌──────────┐  ┌──────────────┐  ┌──────────────────────┐
│ routes/  │  │ ws/executor  │  │ services/execution   │
│ auth.ts  │  │ WsGateway.ts │  │ Engine.ts            │
│ admin.ts │  └──────┬───────┘  └──────────┬───────────┘
│ app.ts   │         │                     │
│ deepread │         │                     │
└────┬─────┘         │                     │
     │               │                     │
     ▼               ▼                     ▼
┌──────────────────────────────────────────────────────┐
│                  middleware/                          │
│   auth.ts     sign.ts     drAuth.ts                  │
└──────────────────────────────────────────────────────┘
     │               │                     │
     ▼               ▼                     ▼
┌──────────────────────────────────────────────────────┐
│                  services/                           │
│  taskRegistry.ts   taskEnqueue.ts   taskNaming.ts    │
│  serverTaskRuntime.ts                                │
└──────────────────────────────┬───────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────┐
│              PrismaClient (@prisma/client)            │
│              SQLite 数据库（DATABASE_URL）             │
└──────────────────────────────────────────────────────┘
```

> 注意：每个路由文件各自实例化一个 `PrismaClient`，`executionEngine` 和 `executorWsGateway` 共用 `index.ts` 传入的同一个实例。

---

## 6. 环境变量一览

| 变量名 | 默认值 | 说明 |
|--------|--------|------|
| `PORT` | `3001` | HTTP 服务监听端口 |
| `DATABASE_URL` | 无默认（必填） | Prisma SQLite 数据库路径，如 `file:./dev.db` |
| `JWT_SECRET` | `juma_jwt_secret_2026` | Admin JWT 签名密钥（auth.ts、admin.ts） |
| `APP_SECRET` | `juma2026_secret` | x-sign MD5 签名密钥（app.ts、deepread.ts） |
| `DR_JWT_SECRET` | `deepread_jwt_secret_2026` | DeepRead JWT 签名密钥，token 有效期 30 天 |
| `EXECUTOR_SHARED_KEY` | `juma_executor_2026` | WebSocket 执行器客户端接入密钥（header 或 query） |
| `EXECUTOR_OFFLINE_TIMEOUT_MS` | `60000` | Executor 心跳超时时间（毫秒），超时后标记为 offline |
| `EXECUTOR_SWEEP_INTERVAL_MS` | `10000` | 执行引擎巡检周期（毫秒），用于刷新在线状态和恢复超时任务 |
| `EXECUTOR_DISPATCH_INTERVAL_MS` | `1500` | WS 网关轮询分发 client_task 的间隔（毫秒） |
| `EXECUTOR_HEARTBEAT_INTERVAL_MS` | `10000` | 通知客户端的推荐心跳间隔（毫秒，写入 server.hello 响应） |
| `LOCAL_EXECUTOR_CONCURRENCY` | `1` | 本地 server_task 最大并发数（最小值为 1） |
| `LOCAL_EXECUTOR_POLL_MS` | `2000` | 本地执行引擎轮询数据库的间隔（毫秒） |
| `REMOTE_TASK_STALE_TIMEOUT_MS` | `300000` | client_task 超时判定时长（毫秒），超时且客户端离线则触发重试或失败 |
| `TASK_LOG_MAX_BYTES` | `65536` | 任务日志最大字节数（64KB），超出则截断保留尾部 |
| `GEMINI_API_KEY` | 无默认（可选） | Google Gemini API 密钥，用于 DeepRead AI 对话功能；未配置时 `/ai/chat` 返回 500 |

### 生产环境配置建议

所有带有 `_SECRET` / `_KEY` 后缀的变量在生产环境中**必须**替换为强随机值。推荐通过 `.env` 文件或部署平台的 Secret 管理机制注入，不要提交到版本库。

```bash
# 最小生产环境配置示例
DATABASE_URL="file:/data/juma.db"
JWT_SECRET="<随机64字符>"
APP_SECRET="<随机64字符>"
DR_JWT_SECRET="<随机64字符>"
EXECUTOR_SHARED_KEY="<随机64字符>"
GEMINI_API_KEY="AIza..."
PORT=3001
```

---

## 7. 脚本命令

```bash
# 开发模式（tsx watch 热重载）
npm run dev

# 编译 TypeScript
npm run build

# 生产启动（编译后）
npm run start

# 数据库结构同步（开发用，不生成 migration）
npm run db:push

# 生成 Prisma Client
npm run db:generate

# 初始化种子数据
npm run db:seed

# ESLint 检查
npm run lint
```
