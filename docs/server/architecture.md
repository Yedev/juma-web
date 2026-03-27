# Server 模块架构文档

## 1. 模块职责概述

`server/` 是 juma-web 项目的后端核心，基于 **Node.js 22 + Express 4.21.2 + TypeScript 5.7.3** 构建，承担以下职责：

- **HTTP API 服务**：为管理后台、移动 App、DeepRead 客户端分别提供独立的 REST API 路由
- **身份认证**：管理员使用 JWT（24 小时有效期），DeepRead 用户使用 SMS + JWT（30 天），移动 App 使用 MD5 签名
- **任务调度系统**：支持服务端任务（本地执行）和客户端任务（分发到远程执行器），包含完整的入队、调度、重试、日志机制
- **WebSocket 执行器网关**：自行实现 RFC 6455 协议，接受远程执行器客户端连接，分发 `client_task` 并接收执行结果
- **静态文件托管**：将 admin-ui 构建产物作为 SPA 托管，所有未匹配路由回退到 `index.html`
- **数据持久化**：通过 Prisma 6.19.2 + SQLite 管理 16 个数据模型

---

## 2. 目录结构

```
server/
├── prisma/
│   └── schema.prisma              # Prisma 数据库 Schema（16 个模型）
├── src/
│   ├── index.ts                   # 应用入口：Express 初始化、路由挂载、WS 网关、执行引擎启动
│   ├── middleware/
│   │   ├── auth.ts                # 管理员 JWT 验证中间件（扩展 AuthRequest）
│   │   ├── drAuth.ts              # DeepRead 用户 JWT 验证中间件（扩展 DrAuthRequest）
│   │   └── sign.ts                # x-sign MD5 签名验证中间件（防重放攻击）
│   ├── routes/
│   │   ├── auth.ts                # POST /api/auth/login（bcrypt + JWT）
│   │   ├── admin.ts               # /api/admin/* 全部管理接口（JWT 保护，约 1100 行）
│   │   ├── app.ts                 # /api/v1/app/* 移动 App 接口（x-sign 保护）
│   │   └── deepread.ts            # /api/v1/dr/* DeepRead 接口（x-sign + JWT）
│   ├── services/
│   │   ├── taskRegistry.ts        # 注册任务定义，提供 listRegisteredTasks / prepareRegisteredTask
│   │   ├── taskEnqueue.ts         # 封装任务入队逻辑，生成 taskId，写入数据库
│   │   ├── taskNaming.ts          # 任务命名规则校验（server.* / client.*）
│   │   ├── serverTaskRuntime.ts   # 服务端任务实现（ServerTaskBase 抽象类，server.echo）
│   │   └── executionEngine.ts     # 执行引擎：轮询、并发控制、重试、客户端状态刷新
│   ├── ws/
│   │   └── executorWsGateway.ts   # WebSocket 网关：RFC 6455 手动实现，任务分发协议
│   └── prisma/
│       └── seed.ts                # 数据库种子：默认管理员、配置、DeepRead 测试数据
├── package.json
└── tsconfig.json
```

---

## 3. 启动流程

`src/index.ts` 按以下顺序完成初始化：

```
Step 1: 创建 Express 应用
  └─ const app = express()
  └─ const prisma = new PrismaClient()

Step 2: 注册全局中间件
  ├─ app.use(cors())         — 允许跨域（开发阶段无限制）
  └─ app.use(express.json()) — 解析 JSON 请求体

Step 3: 挂载路由
  ├─ GET  /api/health                   — 健康检查（无鉴权）
  ├─ /api/auth        → authRoutes
  ├─ /api/admin       → adminRoutes    （router 内部 router.use(authMiddleware)）
  ├─ /api/v1/app      → appRoutes      （router 内部 router.use(signMiddleware)）
  ├─ /api/v1/dr       → deepreadRoutes （router 内部双层中间件）
  └─ express.static(public/) + SPA 回退 *

Step 4: 创建 HTTP Server
  └─ const server = createServer(app)

Step 5: 创建 WebSocket 网关
  └─ createExecutorWsGateway(server, prisma)
     — 监听 server 的 'upgrade' 事件
     — 仅处理路径 /ws/executor 且通过密钥验证的连接
     — 启动分发定时器（DISPATCH_INTERVAL_MS = 1500ms）

Step 6: 启动执行引擎
  └─ startExecutionEngine(prisma)
     — 立即执行一次任务调度和状态刷新
     — 本地任务轮询：setInterval(scheduleLocalTasks, LOCAL_POLL_MS)
     — 状态扫描：setInterval(refreshExecutorStatus + recoverStaleRemoteTasks, SWEEP_INTERVAL_MS)

Step 7: 开始监听
  └─ server.listen(PORT)
```

> `*` SPA 回退：`app.get("*", ...)` 将所有未匹配路由指向 `public/index.html`，需确保静态资源已构建到 `public/` 目录。

---

## 4. 请求处理流程

### 4.1 各路由的中间件链

| 路由前缀 | 中间件链 | 说明 |
|----------|----------|------|
| `GET /api/health` | 无 | 公开健康检查 |
| `POST /api/auth/login` | `express.json()` | 不需要预认证 |
| `/api/admin/*` | `express.json()` → `authMiddleware` | 需要 Admin JWT |
| `/api/v1/app/*` | `express.json()` → `signMiddleware` | 需要 x-sign 签名 |
| `POST /api/v1/dr/sms/send` | `express.json()` → `signMiddleware` | 仅需签名，无需登录 |
| `POST /api/v1/dr/login` | `express.json()` → `signMiddleware` | 仅需签名，无需登录 |
| `/api/v1/dr/*`（其余） | `express.json()` → `signMiddleware` → `drAuthMiddleware` | 签名 + DR JWT |

### 4.2 响应格式规范

所有接口统一使用以下 JSON 格式：

```json
// 成功响应
{
  "code": 200,
  "message": "success",
  "data": { ... }
}

// 错误响应
{
  "code": 400,
  "message": "具体错误描述"
}
```

`code` 字段与 HTTP 状态码保持一致。分页响应的 `data` 对象包含 `list`、`total`、`page`、`pageSize` 字段。

---

## 5. 模块依赖关系图

```
┌─────────────────────────────────────────────────────────────┐
│                       index.ts                              │
│          Express App + HTTP Server (Node.js)                │
└──┬─────────────┬──────────────┬────────────┬───────────────┘
   │             │              │            │
   ▼             ▼              ▼            ▼
routes/       routes/        routes/      routes/
auth.ts       admin.ts       app.ts       deepread.ts
   │             │              │            │
   │       ┌─────┤         ┌────┤       ┌────┤
   ▼       ▼     ▼         ▼    ▼       ▼    ▼
middleware/     services/                middleware/
auth.ts         taskRegistry.ts          sign.ts
drAuth.ts       ├─ serverTaskRuntime.ts  drAuth.ts
sign.ts         └─ taskNaming.ts
                taskEnqueue.ts
                └─ taskRegistry.ts

┌──────────────────────────┐    ┌──────────────────────────┐
│  ws/executorWsGateway.ts │    │ services/executionEngine  │
│  (RFC 6455 手动实现)     │    │ (本地 server_task 调度)  │
│  ├─ taskNaming.ts        │    │ ├─ serverTaskRuntime.ts   │
│  └─ PrismaClient         │    │ └─ PrismaClient           │
└──────────────────────────┘    └──────────────────────────┘
              │                              │
              └──────────────┬───────────────┘
                             ▼
                   prisma/schema.prisma
                   SQLite (DATABASE_URL)
```

---

## 6. 环境变量一览表

| 变量名 | 默认值 | 来源文件 | 说明 |
|--------|--------|----------|------|
| `PORT` | `3001` | `index.ts` | HTTP 服务监听端口，同时也是 WebSocket 升级端口 |
| `DATABASE_URL` | 无（必须配置） | Prisma | SQLite 连接字符串，例如 `file:./dev.db` |
| `JWT_SECRET` | `juma_jwt_secret_2026` | `middleware/auth.ts` | 管理员 JWT 签名密钥 |
| `APP_SECRET` | `juma2026_secret` | `middleware/sign.ts` | x-sign 签名密钥，MD5(APP_SECRET + timestamp) |
| `DR_JWT_SECRET` | `deepread_jwt_secret_2026` | `middleware/drAuth.ts` | DeepRead 用户 JWT 签名密钥 |
| `EXECUTOR_SHARED_KEY` | `juma_executor_2026` | `ws/executorWsGateway.ts` | WebSocket 执行器连接认证密钥 |
| `EXECUTOR_OFFLINE_TIMEOUT_MS` | `60000` | `services/executionEngine.ts` | 执行器心跳超时阈值（60 秒） |
| `LOCAL_EXECUTOR_CONCURRENCY` | `1` | `services/executionEngine.ts` | 本地服务端任务最大并发数 |
| `LOCAL_EXECUTOR_POLL_MS` | `2000` | `services/executionEngine.ts` | 本地执行引擎轮询间隔 |
| `EXECUTOR_SWEEP_INTERVAL_MS` | `10000` | `services/executionEngine.ts` | 客户端状态扫描间隔 |
| `REMOTE_TASK_STALE_TIMEOUT_MS` | `300000` | `services/executionEngine.ts` | 远程任务超时（5 分钟），超时后重试或报错 |
| `TASK_LOG_MAX_BYTES` | `65536` | `services/executionEngine.ts` / `ws/executorWsGateway.ts` | 任务日志最大字节数（64KB） |
| `EXECUTOR_HEARTBEAT_INTERVAL_MS` | `10000` | `ws/executorWsGateway.ts` | 向客户端建议的心跳间隔，随 server.hello 下发 |
| `EXECUTOR_DISPATCH_INTERVAL_MS` | `1500` | `ws/executorWsGateway.ts` | WebSocket 任务分发轮询间隔 |

### 生产环境推荐配置

```bash
PORT=3001
DATABASE_URL="file:/data/juma.db"
JWT_SECRET="your-strong-random-secret-64chars"
APP_SECRET="your-app-secret-32chars"
DR_JWT_SECRET="your-dr-jwt-secret-64chars"
EXECUTOR_SHARED_KEY="your-executor-key-32chars"
LOCAL_EXECUTOR_CONCURRENCY=2
```

> **安全提示**：所有带 `_SECRET` 和 `_KEY` 后缀的变量在生产环境必须替换为强随机字符串，默认值仅用于本地开发。

---

## 7. 开发与构建命令

```bash
# 安装依赖
npm install

# 开发模式（tsx watch 热重载）
npm run dev

# 编译 TypeScript 到 dist/
npm run build

# 生产模式启动（需先执行 build）
npm run start

# 数据库操作
npm run db:generate   # 重新生成 Prisma Client（修改 schema 后执行）
npm run db:push       # 同步 schema 到数据库（开发用，无迁移历史）
npm run db:seed       # 运行种子脚本（初始化默认数据）

# 代码检查
npm run lint
```
