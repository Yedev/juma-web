# juma-web

> 移动端应用后台管理系统 + DeepRead 深度阅读平台
>
> **技术栈**：Express · TypeScript · Prisma · SQLite · Vite · React · Ant Design

---

## 目录

- [项目简介](#项目简介)
- [系统架构](#系统架构)
- [技术栈](#技术栈)
- [快速启动](#快速启动)
- [目录结构](#目录结构)
- [功能模块](#功能模块)
- [环境变量](#环境变量)
- [API 文档](#api-文档)
- [任务执行系统](#任务执行系统)
- [WebSocket 协议](#websocket-协议)
- [DeepRead 平台](#deepread-平台)
- [数据库模型](#数据库模型)
- [部署指南](#部署指南)

---

## 项目简介

juma-web 是一个全栈管理系统，包含两个核心模块：

1. **移动端应用管理后台**：提供任务管理、远程执行器调度、应用配置管理等能力，支持分布式任务执行（如 Mac Mini iOS 构建机）。
2. **DeepRead 深度阅读平台**：完整的内容阅读平台，支持空间/频道/文章管理、用户认证、批注、合集和 AI 对话。

---

## 系统架构

```
┌─────────────────────────────────────────────────────────────────┐
│                         客户端层                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │  Admin UI    │  │  移动端 App  │  │  Mac Mini 执行器      │  │
│  │ (React/Vite) │  │ (iOS/Android)│  │ (mac-mini-client)    │  │
│  └──────┬───────┘  └──────┬───────┘  └──────────┬───────────┘  │
└─────────┼─────────────────┼───────────────────────┼─────────────┘
          │ HTTP (JWT)       │ HTTP (x-sign)         │ WebSocket
          ▼                  ▼                       ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Express 服务器 (端口 3001)                   │
│                                                                   │
│  ┌───────────────┐  ┌────────────────┐  ┌──────────────────┐   │
│  │  /api/admin   │  │ /api/v1/app    │  │  /ws/executor    │   │
│  │  (管理后台)    │  │ (移动端 API)   │  │  (WebSocket 网关) │   │
│  └───────────────┘  └────────────────┘  └──────────────────┘   │
│                                                                   │
│  ┌───────────────┐  ┌────────────────┐  ┌──────────────────┐   │
│  │  /api/v1/dr   │  │  执行引擎       │  │  任务注册中心     │   │
│  │ (DeepRead API)│  │ (本地任务调度)  │  │  (taskRegistry)  │   │
│  └───────────────┘  └────────────────┘  └──────────────────┘   │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                   Prisma ORM (SQLite)                    │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
```

### 任务分发流程

```
移动端/管理后台
      │
      │ POST /api/v1/app/task/execute
      ▼
  任务入队 (queued)
      │
      ├─── server_task ──► 本地执行引擎 (executionEngine) ──► 执行完成
      │
      └─── client_task ──► WebSocket 网关 ──► Mac Mini 客户端执行
                                                      │
                                          task.update / task.log
                                                      │
                                              状态回写数据库
```

---

## 技术栈

### 后端 (server/)

| 技术 | 版本 | 用途 |
|------|------|------|
| Node.js | 22+ | 运行时 |
| Express | 4.21.2 | Web 框架 |
| TypeScript | 5.7.3 | 类型系统 |
| Prisma | 6.19.2 | ORM |
| SQLite | - | 数据库 |
| jsonwebtoken | 9.0.2 | JWT 认证 |
| bcryptjs | 2.4.3 | 密码哈希 |
| cors | 2.8.5 | 跨域处理 |

### 前端 (admin-ui/)

| 技术 | 版本 | 用途 |
|------|------|------|
| React | 19.2.0 | UI 框架 |
| Vite | 7.3.1 | 构建工具 |
| TypeScript | 5.9.3 | 类型系统 |
| Ant Design | 6.3.1 | UI 组件库 |
| react-router-dom | 7.13.1 | 路由 |
| axios | 1.13.5 | HTTP 客户端 |
| Monaco Editor | 4.7.0 | 代码编辑器 |
| crypto-js | 4.2.0 | MD5 签名 |

### 执行器客户端 (mac-mini-client/)

| 技术 | 版本 | 用途 |
|------|------|------|
| Node.js | 22+ | 运行时 |
| WebSocket (原生) | - | 与服务器通信 |

---

## 快速启动

### 前提条件

- Node.js 22+
- npm 10+

### 1. 启动后端

```bash
cd server
npm install
npx prisma generate
npx prisma db push
npm run db:seed       # 初始化种子数据
npm run dev           # 启动开发服务器（端口 3001）
```

### 2. 启动前端

```bash
cd admin-ui
npm install
npm run dev           # 启动开发服务器（端口 5173）
```

### 3. 启动执行器客户端（可选）

```bash
cd mac-mini-client
npm install
SERVER_URL="http://localhost:3001" \
EXECUTOR_KEY="juma_executor_2026" \
CLIENT_ID="macmini-local-01" \
CLIENT_TAGS="xcode,ios" \
npm start
```

### 默认账号

| 系统 | 账号 | 密码/验证码 |
|------|------|------------|
| 管理后台 | `juma` | `juma2026` |
| DeepRead 测试用户 | `13800138000` | `888888`（开发模式固定） |

---

## 目录结构

```
juma-web/
├── server/                        # 后端服务
│   ├── src/
│   │   ├── index.ts               # 服务入口
│   │   ├── middleware/
│   │   │   ├── auth.ts            # 管理员 JWT 认证
│   │   │   ├── drAuth.ts          # DeepRead JWT 认证
│   │   │   └── sign.ts            # x-sign 签名验证（MD5）
│   │   ├── routes/
│   │   │   ├── auth.ts            # 登录接口
│   │   │   ├── app.ts             # 移动端 API
│   │   │   ├── admin.ts           # 管理后台 API
│   │   │   └── deepread.ts        # DeepRead 客户端 API
│   │   ├── services/
│   │   │   ├── taskRegistry.ts    # 任务定义与注册中心
│   │   │   ├── taskEnqueue.ts     # 任务入队
│   │   │   ├── taskNaming.ts      # 任务命名规则
│   │   │   ├── serverTaskRuntime.ts  # 服务端任务执行
│   │   │   └── executionEngine.ts    # 本地任务轮询引擎
│   │   ├── ws/
│   │   │   └── executorWsGateway.ts  # WebSocket 执行器网关
│   │   └── prisma/
│   │       └── seed.ts            # 数据库种子脚本
│   ├── prisma/
│   │   └── schema.prisma          # 数据库 Schema（SQLite）
│   ├── package.json
│   └── tsconfig.json
│
├── admin-ui/                      # 管理后台前端（React）
│   ├── src/
│   │   ├── main.tsx
│   │   ├── App.tsx                # 路由与布局配置
│   │   ├── layouts/
│   │   │   └── AdminLayout.tsx    # 侧边栏 + 主内容布局
│   │   ├── pages/
│   │   │   ├── Login.tsx
│   │   │   ├── TaskManagement.tsx
│   │   │   ├── ConfigManagement.tsx
│   │   │   ├── ApiPlayground.tsx
│   │   │   ├── DrSpaceManagement.tsx
│   │   │   ├── DrChannelManagement.tsx
│   │   │   ├── DrArticleManagement.tsx
│   │   │   └── DrUserManagement.tsx
│   │   ├── api/
│   │   │   └── client.ts          # Axios 实例（自动注入 Bearer Token）
│   │   └── utils/
│   │       └── sign.ts            # x-sign 生成工具
│   └── package.json
│
├── mac-mini-client/               # 远程执行器客户端
│   ├── client.js                  # WebSocket 客户端主程序
│   ├── tasks/                     # 任务实现（client.* 系列）
│   └── package.json
│
├── docs/                          # 详细文档
│   ├── architecture.md            # 系统架构详解
│   ├── api-reference.md           # 完整 API 参考
│   ├── development.md             # 开发指南
│   └── deployment.md              # 部署指南
│
├── Dockerfile                     # 多阶段构建（前端 + 后端）
├── deploy.sh                      # 部署脚本
├── PRD.md                         # 产品需求文档
└── AGENTS.md                      # AI Agent 开发规范
```

---

## 功能模块

### 管理后台（Web UI）

| 页面 | 路径 | 功能描述 |
|------|------|----------|
| 登录 | `/login` | 用户名/密码登录 |
| 任务管理 | `/tasks` | 任务 CRUD、一键触发、执行日志查看、执行器客户端状态 |
| 配置管理 | `/config` | JSON 配置管理，Monaco 编辑器（语法高亮/格式化/校验） |
| API 接口文档 | `/api-playground` | 交互式 API 文档，内置测试面板，自动签名注入 |
| 空间管理 | `/dr/spaces` | DeepRead 空间 CRUD、邀请码生成与复制、成员查看 |
| 频道管理 | `/dr/channels` | DeepRead 频道 CRUD、按空间筛选 |
| 文章管理 | `/dr/articles` | DeepRead 文章 CRUD、Monaco HTML 编辑器 |
| 用户管理 | `/dr/users` | DeepRead 用户列表（只读），展开查看加入的空间 |

### 移动端 API（`/api/v1/app/`）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/config` | 获取 JSON 配置（默认 key: `global_json`） |
| GET | `/task/catalog` | 查询已注册任务目录（含参数说明与示例） |
| POST | `/task/execute` | 提交任务执行 |
| PUT | `/task/status` | 更新任务状态/进度 |
| GET | `/task/status` | 查询任务详情（含日志/结果/耗时） |

### 管理后台 API（`/api/admin/`）

- **任务管理**：任务列表（分页）、按名称执行、创建、更新状态、删除、查看任务定义
- **执行器客户端**：在线/离线列表、删除
- **配置管理**：多 key JSON 配置的增删改查
- **DeepRead 管理**：空间/频道/文章/用户的完整 CRUD

### DeepRead 客户端 API（`/api/v1/dr/`）

- **认证**：验证码登录，30 天 JWT
- **空间**：通过邀请码加入
- **文章**：列表、详情、收藏、阅读进度追踪
- **批注**：创建/编辑/删除高亮批注，支持颜色与笔记
- **合集**：创建合集，批量管理文章

---

## 环境变量

### 服务端（`server/.env`）

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `DATABASE_URL` | `file:./prisma/dev.db` | SQLite 数据库路径 |
| `PORT` | `3001` | 服务器监听端口 |
| `NODE_ENV` | `development` | 运行环境 |
| `JWT_SECRET` | `juma_jwt_secret_2026` | 管理员 JWT 密钥 |
| `APP_SECRET` | `juma2026_secret` | 移动端签名密钥 |
| `DR_JWT_SECRET` | `deepread_jwt_secret_2026` | DeepRead 用户 JWT 密钥 |
| `EXECUTOR_SHARED_KEY` | `juma_executor_2026` | WebSocket 执行器共享密钥 |
| `EXECUTOR_OFFLINE_TIMEOUT_MS` | `60000` | 执行器离线判定超时（毫秒） |
| `EXECUTOR_SWEEP_INTERVAL_MS` | `10000` | 执行器状态扫描间隔 |
| `EXECUTOR_HEARTBEAT_INTERVAL_MS` | `10000` | 心跳间隔 |
| `EXECUTOR_DISPATCH_INTERVAL_MS` | `1500` | 任务分发轮询间隔 |
| `LOCAL_EXECUTOR_POLL_MS` | `2000` | 本地任务轮询间隔 |
| `LOCAL_EXECUTOR_CONCURRENCY` | `1` | 本地并发执行任务数 |
| `REMOTE_TASK_STALE_TIMEOUT_MS` | `300000` | 远程任务超时（5分钟） |
| `TASK_LOG_MAX_BYTES` | `65536` | 单任务日志最大字节数（64KB） |

### 前端（`admin-ui/.env.local`）

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `VITE_API_BASE_URL` | `http://localhost:3001` | 后端 API 地址 |

### 执行器客户端（环境变量）

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `SERVER_URL` | `http://localhost:3001` | 服务器地址 |
| `EXECUTOR_KEY` | `juma_executor_2026` | 共享密钥 |
| `CLIENT_ID` | `macmini-{hostname}-{uuid}` | 客户端唯一标识 |
| `CLIENT_NAME` | `{hostname}` | 客户端显示名称 |
| `CLIENT_TAGS` | `xcode,ios` | 客户端标签（逗号分隔） |
| `CLIENT_VERSION` | `1.0.0` | 客户端版本 |
| `WORK_DIR` | `{cwd}` | 任务工作目录 |
| `HEARTBEAT_INTERVAL_MS` | `10000` | 心跳发送间隔 |
| `RECONNECT_DELAY_MS` | `3000` | 断线重连延迟 |
| `LOG_FLUSH_INTERVAL_MS` | `2000` | 日志缓冲刷新间隔 |
| `LOG_FLUSH_SIZE` | `2048` | 日志缓冲大小（字节） |

---

## API 文档

> 详细 API 参考请见 [docs/api-reference.md](docs/api-reference.md)

### 认证方式

#### 1. 管理员 JWT（管理后台 API）

```
Authorization: Bearer <token>
```

通过 `POST /api/auth/login` 获取，有效期 **24 小时**。

#### 2. x-sign 签名（移动端 API / DeepRead API）

所有 `/api/v1/*` 接口均需携带：

| 请求头 | 说明 |
|--------|------|
| `x-timestamp` | 13 位毫秒时间戳 |
| `x-sign` | `MD5(APP_SECRET + x-timestamp)` 的 32 位小写十六进制 |

服务端校验：时间戳误差超过 **±5 分钟** 返回 `403`（防重放攻击）。

**签名生成（Shell）：**

```bash
APP_SECRET="juma2026_secret"
TS=$(date +%s%3N)
SIGN=$(printf "%s" "${APP_SECRET}${TS}" | md5sum | awk '{print $1}')
```

#### 3. DeepRead 用户 JWT

DeepRead 保护接口还需在 `Authorization: Bearer <dr_token>` 中携带通过登录接口获取的 Token，有效期 **30 天**。

---

### 核心接口示例

#### 管理员登录

```bash
curl -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"juma","password":"juma2026"}'
```

```json
{
  "code": 200,
  "message": "登录成功",
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
}
```

#### 触发任务执行

```bash
APP_SECRET="juma2026_secret"
TS=$(date +%s%3N)
SIGN=$(printf "%s" "${APP_SECRET}${TS}" | md5sum | awk '{print $1}')

curl -X POST http://localhost:3001/api/v1/app/task/execute \
  -H "Content-Type: application/json" \
  -H "x-timestamp: ${TS}" \
  -H "x-sign: ${SIGN}" \
  -d '{
    "task_name": "server.echo",
    "task_payload": {
      "message": "Hello from juma",
      "repeat": 3,
      "sleep_ms": 500
    },
    "execution_name": "my-echo-task-001"
  }'
```

```json
{
  "code": 200,
  "message": "任务已提交",
  "data": {
    "task_id": "T1709001234567"
  }
}
```

#### 查询任务状态

```bash
curl -G http://localhost:3001/api/v1/app/task/status \
  -H "x-timestamp: ${TS}" \
  -H "x-sign: ${SIGN}" \
  --data-urlencode "task_id=T1709001234567"
```

```json
{
  "code": 200,
  "data": {
    "task_id": "T1709001234567",
    "task_name": "server.echo",
    "task_type": "server_task",
    "status": "completed",
    "execution_log": "[2026-03-01T12:00:00] Echo: Hello from juma\n...",
    "result_code": 0,
    "started_at": "2026-03-01T12:00:00.000Z",
    "finished_at": "2026-03-01T12:00:01.500Z"
  }
}
```

---

## 任务执行系统

> 详细说明请见 [docs/architecture.md](docs/architecture.md)

### 任务类型

| 类型 | 命名前缀 | 执行位置 |
|------|----------|----------|
| 服务端任务 | `server.*` | Express 服务器本地执行 |
| 客户端任务 | `client.*` | 通过 WebSocket 推送至远程执行器 |

### 内置任务

| 任务名 | 类型 | 说明 |
|--------|------|------|
| `server.echo` | server_task | 在服务端重复打印消息 |
| `client.echo` | client_task | 在客户端重复打印消息 |
| `client.mock3s` | client_task | 模拟 3 秒耗时任务 |
| `client.fail_demo` | client_task | 模拟失败场景（故障演练） |

### 任务生命周期

```
queued → running → completed
                 → error (可重试，最多10次)
```

### 注册自定义任务

在 `server/src/services/taskRegistry.ts` 中添加：

```typescript
// 服务端任务
{
  taskName: "server.my_task",
  taskType: "server_task",
  description: "我的自定义任务",
  paramsSchema: {
    input: { type: "string", description: "输入参数", example: "hello" }
  },
  examplePayload: { input: "hello" }
}

// 客户端任务
{
  taskName: "client.my_task",
  taskType: "client_task",
  description: "在 Mac Mini 上执行的任务",
  paramsSchema: {
    script: { type: "string", description: "脚本路径" }
  },
  examplePayload: { script: "/path/to/build.sh" }
}
```

---

## WebSocket 协议

连接地址：`ws://<host>/ws/executor?key=<EXECUTOR_SHARED_KEY>`

### 消息格式

```json
{
  "type": "<消息类型>",
  "payload": { }
}
```

### 消息类型

| 方向 | 类型 | 说明 |
|------|------|------|
| 客户端 → 服务端 | `client.hello` | 注册客户端，声明能力 |
| 服务端 → 客户端 | `server.hello` | 确认注册成功 |
| 客户端 → 服务端 | `client.heartbeat` | 保活心跳 |
| 服务端 → 客户端 | `task.assign` | 推送任务 |
| 客户端 → 服务端 | `task.update` | 回传任务状态 |
| 客户端 → 服务端 | `task.log` | 回传执行日志 |

### client.hello 示例

```json
{
  "type": "client.hello",
  "payload": {
    "client_id": "macmini-build-01",
    "client_name": "MacMini Build 01",
    "platform": "darwin",
    "app_version": "1.0.0",
    "tasks": ["client.echo", "client.mock3s", "client.fail_demo"],
    "tags": ["xcode", "ios"],
    "capabilities": {}
  }
}
```

### task.assign 示例（服务端推送）

```json
{
  "type": "task.assign",
  "payload": {
    "task_id": "T1709001234567",
    "task_name": "client.mock3s",
    "task_payload": { "payload": { "build_id": "build-20260302-001" } },
    "execution_name": "iOS Build #42",
    "max_retries": 3
  }
}
```

### task.update 示例（客户端回传）

```json
{
  "type": "task.update",
  "payload": {
    "task_id": "T1709001234567",
    "status": "completed",
    "result_code": 0,
    "status_info": { "output_json": { "build_url": "https://..." } }
  }
}
```

---

## DeepRead 平台

### 核心概念

```
Space（空间）
  └── Channel（频道）
        └── Article（文章）
              ├── Bookmark（收藏）
              ├── ReadStatus（阅读进度）
              ├── Highlight（批注）
              └── AI Chat（AI 对话）

User（用户）
  ├── Collections（合集）
  │     └── CollectionArticle（合集文章）
  └── SpaceMember（空间成员）
```

### 功能特性

| 功能 | 说明 |
|------|------|
| 无密码登录 | 短信验证码，自动注册新用户 |
| 邀请码加入 | 空间支持邀请码，可设过期时间和使用次数上限 |
| 阅读进度 | 支持 0-100% 的精确进度追踪 |
| 高亮批注 | 文本高亮+颜色+位置信息+笔记，完整 CRUD |
| 合集 | 用户自定义文章合集，增删文章 |
| AI 对话 | 支持普通回复和 SSE 流式回复，两者共用模型与配额配置 |

### 认证流程

```
1. POST /api/v1/dr/sms/send  →  发送验证码（开发环境固定 888888）
2. POST /api/v1/dr/login     →  验证码登录，返回 JWT（30天有效）
3. 携带 JWT 访问保护接口
```

---

## 数据库模型

使用 Prisma + SQLite，包含 **16 个数据模型**：

| 模型 | 说明 |
|------|------|
| `AdminUser` | 管理员账号（用户名 + bcrypt 密码） |
| `AppConfig` | 应用配置（JSON 键值对） |
| `Task` | 任务记录（含状态、日志、重试信息） |
| `ExecutorClient` | 注册的执行器客户端（在线状态、心跳、统计） |
| `DrUser` | DeepRead 用户（手机号、昵称、头像） |
| `DrSmsCode` | 短信验证码（含过期时间、使用状态） |
| `DrSpace` | DeepRead 空间 |
| `DrSpaceMember` | 空间成员关系 |
| `DrInviteCode` | 邀请码（支持最大使用次数、过期时间） |
| `DrChannel` | 频道（所属空间、排序） |
| `DrArticle` | 文章（HTML 正文、阅读数） |
| `DrBookmark` | 文章收藏 |
| `DrReadStatus` | 阅读进度（百分比） |
| `DrHighlight` | 高亮批注（文本、颜色、位置、笔记） |
| `DrCollection` | 用户合集 |
| `DrCollectionArticle` | 合集-文章关联 |

---

## 部署指南

> 详细部署说明请见 [docs/deployment.md](docs/deployment.md)

### Docker 部署（推荐）

```bash
# 构建镜像
docker build -t juma-web .

# 运行容器
docker run -d \
  -p 3001:3001 \
  -v /data/juma:/app/data \
  -e JWT_SECRET="your_strong_secret" \
  -e APP_SECRET="your_app_secret" \
  -e DR_JWT_SECRET="your_dr_secret" \
  -e EXECUTOR_SHARED_KEY="your_executor_key" \
  --name juma-web \
  juma-web
```

### 生产部署注意事项

1. **修改所有默认密钥**（JWT_SECRET、APP_SECRET、EXECUTOR_SHARED_KEY 等）
2. **持久化 SQLite 数据库**（挂载 `/app/data` 目录）
3. **配置 HTTPS 反向代理**（推荐 Nginx）
4. **WebSocket 需配置代理升级**（`proxy_set_header Upgrade $http_upgrade`）

---

## 更多文档

| 文档 | 说明 |
|------|------|
| [docs/architecture.md](docs/architecture.md) | 系统架构详解、模块关系、数据流 |
| [docs/api-reference.md](docs/api-reference.md) | 完整 API 参考（所有接口、参数、响应格式） |
| [docs/development.md](docs/development.md) | 开发指南（本地调试、添加任务、测试） |
| [docs/deployment.md](docs/deployment.md) | 生产部署（Docker、Nginx、HTTPS 配置） |
| [PRD.md](PRD.md) | 产品需求文档 |
| [AGENTS.md](AGENTS.md) | AI Agent 开发规范 |
modify by android
