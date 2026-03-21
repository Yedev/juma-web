# juma-web

移动端应用后台管理系统（Express + TypeScript + Prisma + SQLite，前端为 Vite + React + TypeScript + Ant Design）。

## 功能概览

### 认证与安全
- **后台登录**：用户名/密码认证，JWT 令牌（24小时有效期），bcrypt 密码加密
- **移动端 API 鉴权**：MD5 签名 + 13位毫秒时间戳，防重放（±5分钟容差）
- **WebSocket 鉴权**：共享密钥（`EXECUTOR_SHARED_KEY`）认证

### 任务管理系统
- **两种任务类型**：
  - `server_task` — 后端服务器本地执行
  - `client_task` — 通过 WebSocket 分发至远程执行器
- **任务生命周期**：`queued → running → completed / error`
- **任务能力**：创建、查看、编辑状态、删除、进度追踪、执行日志（64KB上限）、可配置重试（0-10次）
- **任务分发**：支持 `target_client_id` 指定客户端、`required_tags` 标签筛选
- **已注册任务**：`server.echo`、`client.echo`、`client.mock3s`、`client.fail_demo`

### 远程执行器系统（WebSocket）
- WebSocket 长连接网关（`/ws/executor`），客户端主动连接（无需公网 IP）
- 心跳检测与离线自动标记（默认60秒超时）
- 基于能力声明的任务推送（`client.hello` 上报 tasks/tags/capabilities）
- 执行状态与日志实时回传（`task.update` / `task.log`）
- Mac Mini 客户端（`mac-mini-client/`）：自动重连、标签配置、日志缓冲

### Web 管理后台（7个页面）
| 页面 | 路径 | 功能 |
|------|------|------|
| 任务管理 | `/tasks` | 任务 CRUD、一键触发示例任务、执行日志弹窗、客户端状态面板 |
| 配置管理 | `/config` | 多键 JSON 配置、Monaco 编辑器（语法高亮/格式化/校验） |
| API 接口说明 | `/api-playground` | 交互式 API 文档、在线测试、自动签名注入 |
| 空间管理 | `/dr/spaces` | DeepRead 空间 CRUD、邀请码复制、成员查看 |
| 频道管理 | `/dr/channels` | DeepRead 频道 CRUD、空间筛选 |
| 文章管理 | `/dr/articles` | DeepRead 文章 CRUD、Monaco HTML 编辑器、空间/频道联动筛选 |
| 用户管理 | `/dr/users` | DeepRead 用户列表（只读）、展开查看加入的空间 |

### 移动端 API（`/api/v1/app/`）
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/config` | 获取 JSON 配置（默认 key: `global_json`） |
| GET | `/task/catalog` | 查询已注册任务目录（含参数说明与示例） |
| POST | `/task/execute` | 提交任务执行 |
| PUT | `/task/status` | 更新任务状态 |
| GET | `/task/status` | 查询任务详情（含日志/结果/耗时） |

### DeepRead 客户端 API（`/api/v1/dr/`）

鉴权方式：外层 x-sign 签名 + 内层 Bearer JWT（部分接口免登录）。

| 方法 | 路径 | 鉴权 | 说明 |
|------|------|------|------|
| POST | `/sms/send` | sign | 发送短信验证码（开发模式固定 `888888`） |
| POST | `/login` | sign | 验证码登录（自动注册新用户），返回 JWT |
| POST | `/space/join` | sign + JWT | 通过邀请码加入空间 |
| GET | `/articles` | sign + JWT | 文章列表（`space_id` 必填，`channel_id`/分页可选） |
| GET | `/articles/:articleId` | sign + JWT | 文章详情（含 HTML 正文，阅读数 +1） |
| PUT | `/articles/:articleId/bookmark` | sign + JWT | 收藏/取消收藏 |
| PUT | `/articles/:articleId/read` | sign + JWT | 标记已读（支持进度百分比） |
| POST | `/highlights` | sign + JWT | 创建高亮批注 |
| PUT | `/highlights/:highlightId` | sign + JWT | 更新批注（颜色/笔记） |
| DELETE | `/highlights/:highlightId` | sign + JWT | 删除批注（仅自己的） |
| GET | `/highlights` | sign + JWT | 获取文章批注列表 |
| POST | `/collections` | sign + JWT | 创建合集 |
| PUT | `/collections/:collectionId/articles` | sign + JWT | 合集添加/移除文章 |
| GET | `/collections` | sign + JWT | 获取合集列表（含文章数） |
| POST | `/ai/chat` | sign + JWT | AI 对话（基于文章内容，Gemini 2.0 Flash） |

### 后台管理 API（`/api/admin/`）

通用管理（JWT 后台鉴权）：
- 任务管理：列表（分页）、创建、按名称执行、更新状态、删除
- 执行器客户端：列表、删除
- 配置管理：列表、读取、创建/更新、删除

DeepRead 管理（`/api/admin/dr/`）：

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/dr/spaces` | 空间列表（含成员数/频道数/文章数统计） |
| POST | `/dr/spaces` | 创建空间（自动生成 spaceId + 6位邀请码） |
| PUT | `/dr/spaces/:spaceId` | 编辑空间 |
| DELETE | `/dr/spaces/:spaceId` | 删除空间（级联删除成员/频道/文章） |
| GET | `/dr/spaces/:spaceId/members` | 空间成员列表 |
| GET | `/dr/channels` | 频道列表（`space_id` 可选筛选，含文章数统计） |
| POST | `/dr/channels` | 创建频道 |
| PUT | `/dr/channels/:channelId` | 编辑频道 |
| DELETE | `/dr/channels/:channelId` | 删除频道 |
| GET | `/dr/articles` | 文章列表（分页，`space_id`/`channel_id` 可选筛选） |
| POST | `/dr/articles` | 创建文章 |
| PUT | `/dr/articles/:articleId` | 编辑文章 |
| DELETE | `/dr/articles/:articleId` | 删除文章（级联删除收藏/已读/批注） |
| GET | `/dr/users` | 用户列表（分页，含空间数/批注数统计） |
| GET | `/dr/users/:userId` | 用户详情（含加入的空间列表） |

### 开发与部署
- **前端**：Vite + React + TypeScript + Ant Design（端口 5173）
- **后端**：Express + TypeScript + Prisma + SQLite（端口 3001）
- **开发体验**：热重载（tsx watch + Vite HMR）、数据库自动种子数据
- **部署**：Docker 支持、丰富的环境变量配置

---

## 快速启动

```bash
cd server
npm install
npx prisma generate
npx prisma db push
npm run db:seed
npm run dev

cd ../admin-ui
npm install
npm run dev
```

- 后端默认端口：`3001`
- 前端默认端口：`5173`
- 默认后台账号：`juma / juma2026`

---

## 任务执行系统（Task 模式）

已支持两种 Task 类型：

1. `server_task`：在服务端执行已注册 `server.name` 任务
2. `client_task`：分发给客户端执行已注册 `client.name` 任务

### 架构说明

- **任务创建与管理**：在后台「任务管理」页面创建任务、查看状态、手工更新、删除任务
- **服务端本地执行引擎**：`server/src/services/executionEngine.ts`
  - 定时扫描 `queued + server_task` 任务
  - 通过 `ServerTask` 基类注册器执行任务逻辑
- **远程执行器网关（WebSocket）**：`server/src/ws/executorWsGateway.ts`
  - 客户端通过 `ws://host/ws/executor` 建立长连接
  - 客户端发送 `client.hello` / `client.heartbeat`，服务端推送 `task.assign`
  - 客户端通过 `task.update` 回传状态，通过 `task.log` 回传日志
  - 通过共享密钥 `EXECUTOR_KEY` 做鉴权
- **客户端状态可视化**：任务管理页下方可查看执行客户端在线/离线、心跳、统计信息

### 远程执行（无公网 IP）的关键点

Mac Mini 不需要被外网访问，采用“**客户端主动连接服务端**”方式：

1. 客户端主动建立 WS 长连接并上报能力
2. 服务端按能力实时推送任务（无轮询）
3. 客户端执行后通过 WS 回传日志/结果

推荐配置的服务端环境变量：

```bash
EXECUTOR_SHARED_KEY="juma_executor_2026"
EXECUTOR_OFFLINE_TIMEOUT_MS=60000
REMOTE_TASK_STALE_TIMEOUT_MS=300000
LOCAL_EXECUTOR_CONCURRENCY=1
```

### 任务协商协议（WebSocket）

客户端连接 `ws://<host>/ws/executor?key=<EXECUTOR_KEY>` 后：

- 发送 `client.hello`，上报 `tasks/capabilities/tags`
- 定时发送 `client.heartbeat` 刷新在线状态
- 服务端推送 `task.assign`（`task_name + task_payload + execution_name`）
- 客户端通过 `task.update` 回传 `running/completed/error`，通过 `task.log` 回传执行日志

任务分发规则：

- 只有声明支持该 `task_name` 的客户端会被分配
- 支持 `required_tags` 与 `target_client_id` 筛选
- 客户端执行后结果 JSON 写入 `status_info.output_json`

---

## Mac Mini 客户端

目录：`mac-mini-client/`

```bash
cd mac-mini-client
npm start
```

常用环境变量：

```bash
SERVER_URL="http://your-server:3001"
EXECUTOR_KEY="juma_executor_2026"
CLIENT_ID="macmini-build-01"
CLIENT_NAME="MacMini Build 01"
CLIENT_TAGS="xcode,ios"
WORK_DIR="/Users/runner/workspace"
npm start
```

---

## 移动端 API 鉴权说明（x-sign）

所有移动端接口都在 `/api/v1/app/*` 下，必须携带以下请求头：

- `x-timestamp`: 13 位毫秒时间戳（例如 `1709000000000`）
- `x-sign`: 签名，计算公式：

```text
MD5(APP_SECRET + x-timestamp)
```

默认 `APP_SECRET`：

```text
juma2026_secret
```

服务端校验逻辑（`server/src/middleware/sign.ts`）：

1. 缺失或非法 `x-timestamp`：返回 `403`
2. 时间戳与服务器时间误差超过 ±5 分钟：返回 `403`（防重放）
3. 缺失或错误 `x-sign`：返回 `401`

### 签名生成脚本（Linux）

```bash
APP_SECRET="juma2026_secret"
BASE_URL="http://localhost:3001"
TS=$(date +%s%3N)
SIGN=$(printf "%s" "${APP_SECRET}${TS}" | md5sum | awk '{print $1}')
```

---

## API 列表与 curl 示例

### 1) 获取应用配置

- **Method**: `GET`
- **URL**: `/api/v1/app/config`
- **Query**: `key`（可选，默认 `global_json`）

```bash
APP_SECRET="juma2026_secret"
BASE_URL="http://localhost:3001"
TS=$(date +%s%3N)
SIGN=$(printf "%s" "${APP_SECRET}${TS}" | md5sum | awk '{print $1}')

curl --request GET "${BASE_URL}/api/v1/app/config?key=global_json" \
  --header "x-timestamp: ${TS}" \
  --header "x-sign: ${SIGN}"
```

### 2) 查询支持任务列表

- **Method**: `GET`
- **URL**: `/api/v1/app/task/catalog`
- **说明**：返回服务端已注册的所有 task 定义（含执行类型、参数说明、示例参数）

```bash
APP_SECRET="juma2026_secret"
BASE_URL="http://localhost:3001"
TS=$(date +%s%3N)
SIGN=$(printf "%s" "${APP_SECRET}${TS}" | md5sum | awk '{print $1}')

curl --request GET "${BASE_URL}/api/v1/app/task/catalog" \
  --header "x-timestamp: ${TS}" \
  --header "x-sign: ${SIGN}"
```

### 3) 触发任务执行

- **Method**: `POST`
- **URL**: `/api/v1/app/task/execute`
- **Body**:
  - `task_name`: string（必填，必须为已注册 task）
  - `task_payload`: object（可选，不同 task 的 payload 结构不同）
  - `execution_name`: string（可选，用于标识任务实例）
- **未注册 task**：返回 `404`，`message` 为“任务不存在”
- **当前内置示例 task**：
  - `server.echo`（服务端执行）
  - `client.echo`（客户端执行）
  - `client.mock3s`（客户端执行）
  - `client.fail_demo`（客户端执行，故障演练）

#### 3.1 服务端执行示例（server.echo）

```bash
APP_SECRET="juma2026_secret"
BASE_URL="http://localhost:3001"
TS=$(date +%s%3N)
SIGN=$(printf "%s" "${APP_SECRET}${TS}" | md5sum | awk '{print $1}')

curl --request POST "${BASE_URL}/api/v1/app/task/execute" \
  --header "Content-Type: application/json" \
  --header "x-timestamp: ${TS}" \
  --header "x-sign: ${SIGN}" \
  --data '{
    "task_name":"server.echo",
    "task_payload":{
      "message":"同步商品索引",
      "repeat":3,
      "sleep_ms":400
    },
    "execution_name":"sync-product-index-001"
  }'
```

#### 3.2 客户端执行示例（client.mock3s）

```bash
APP_SECRET="juma2026_secret"
BASE_URL="http://localhost:3001"
TS=$(date +%s%3N)
SIGN=$(printf "%s" "${APP_SECRET}${TS}" | md5sum | awk '{print $1}')

curl --request POST "${BASE_URL}/api/v1/app/task/execute" \
  --header "Content-Type: application/json" \
  --header "x-timestamp: ${TS}" \
  --header "x-sign: ${SIGN}" \
  --data '{
    "task_name":"client.mock3s",
    "task_payload":{
      "payload":{
        "build_id":"build-20260302-001",
        "branch":"main",
        "notify":true
      },
      "required_tags":["xcode"]
    }
  }'
```

#### 3.3 未注册任务示例（返回任务不存在）

```bash
APP_SECRET="juma2026_secret"
BASE_URL="http://localhost:3001"
TS=$(date +%s%3N)
SIGN=$(printf "%s" "${APP_SECRET}${TS}" | md5sum | awk '{print $1}')

curl --request POST "${BASE_URL}/api/v1/app/task/execute" \
  --header "Content-Type: application/json" \
  --header "x-timestamp: ${TS}" \
  --header "x-sign: ${SIGN}" \
  --data '{"task_name":"client.not-exists","task_payload":{}}'
```

### 4) 更新任务状态

- **Method**: `PUT`
- **URL**: `/api/v1/app/task/status`
- **Body**:
  - `task_id`: string（必填）
  - `status`: `queued` / `running` / `error` / `completed`
  - `status_info`: object（可选）

```bash
APP_SECRET="juma2026_secret"
BASE_URL="http://localhost:3001"
TS=$(date +%s%3N)
SIGN=$(printf "%s" "${APP_SECRET}${TS}" | md5sum | awk '{print $1}')

curl --request PUT "${BASE_URL}/api/v1/app/task/status" \
  --header "Content-Type: application/json" \
  --header "x-timestamp: ${TS}" \
  --header "x-sign: ${SIGN}" \
  --data '{"task_id":"T1709001234","status":"running","status_info":{"current_step":"2/5 处理数据","progress":40}}'
```

### 5) 查询任务状态

- **Method**: `GET`
- **URL**: `/api/v1/app/task/status`
- **Query**: `task_id`（必填）
- **返回增强**：包含 `task_name`、`task_type`、`task_payload`、`execution_name`、`status_info`、`execution_log`、`result_code`、执行时间等详细字段

```bash
APP_SECRET="juma2026_secret"
BASE_URL="http://localhost:3001"
TS=$(date +%s%3N)
SIGN=$(printf "%s" "${APP_SECRET}${TS}" | md5sum | awk '{print $1}')

curl --request GET "${BASE_URL}/api/v1/app/task/status?task_id=T1709001234" \
  --header "x-timestamp: ${TS}" \
  --header "x-sign: ${SIGN}"
```

---

## 后台任务管理（UI）

“任务管理”页面支持直接管理任务：

- 新建任务（任务名称、任务类型、脚本、超时、env、重试策略）
- 新建任务（任务名称、任务类型、task_payload、execution_name、重试策略）
- 已注册任务面板（展示所有支持 task、参数说明、示例参数、一键触发示例任务）
- `client_task` 支持指定目标客户端/required_tags
- 查看任务状态、详情、执行日志（日志详情弹窗含 task_payload/status_info/execution_log）
- 更新任务状态与 `status_info`
- 删除任务
- 分页刷新、客户端状态刷新
- 客户端状态表（在线/离线、最近心跳、任务统计、支持服务）

---

## DeepRead API

DeepRead 是一个深度阅读平台模块，提供空间/频道/文章管理、用户认证、批注、合集和 AI 对话功能。

### 鉴权说明

DeepRead 客户端 API 使用双层鉴权：

1. **外层 x-sign 签名**：所有 `/api/v1/dr/*` 请求都需要（与移动端 API 相同）
2. **内层 JWT Bearer Token**：除 `POST /sms/send` 和 `POST /login` 外，其余接口都需要

JWT Token 通过登录接口获取，有效期 30 天。请求头格式：`Authorization: Bearer <token>`

### 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `DR_JWT_SECRET` | `deepread_jwt_secret_2026` | DeepRead 用户 JWT 密钥 |
| `GEMINI_API_KEY` | 无 | Google Gemini API Key（AI 对话功能必需） |

### curl 示例

#### 1) 发送验证码

```bash
APP_SECRET="juma2026_secret"
BASE_URL="http://localhost:3001"
TS=$(date +%s%3N)
SIGN=$(printf "%s" "${APP_SECRET}${TS}" | md5sum | awk '{print $1}')

curl --request POST "${BASE_URL}/api/v1/dr/sms/send" \
  --header "Content-Type: application/json" \
  --header "x-timestamp: ${TS}" \
  --header "x-sign: ${SIGN}" \
  --data '{"phone":"13800138000"}'
```

#### 2) 登录

```bash
TS=$(date +%s%3N)
SIGN=$(printf "%s" "${APP_SECRET}${TS}" | md5sum | awk '{print $1}')

curl --request POST "${BASE_URL}/api/v1/dr/login" \
  --header "Content-Type: application/json" \
  --header "x-timestamp: ${TS}" \
  --header "x-sign: ${SIGN}" \
  --data '{"phone":"13800138000","code":"888888"}'
```

返回示例：
```json
{
  "code": 200,
  "message": "登录成功",
  "data": {
    "token": "eyJhbGciOi...",
    "user": { "id": 1, "phone": "13800138000", "nickname": "用户8000", "avatar": "" }
  }
}
```

#### 3) 加入空间

```bash
TOKEN="<从登录接口获取>"
TS=$(date +%s%3N)
SIGN=$(printf "%s" "${APP_SECRET}${TS}" | md5sum | awk '{print $1}')

curl --request POST "${BASE_URL}/api/v1/dr/space/join" \
  --header "Content-Type: application/json" \
  --header "x-timestamp: ${TS}" \
  --header "x-sign: ${SIGN}" \
  --header "Authorization: Bearer ${TOKEN}" \
  --data '{"invite_code":"DEEP2026"}'
```

#### 4) 获取文章列表

```bash
TS=$(date +%s%3N)
SIGN=$(printf "%s" "${APP_SECRET}${TS}" | md5sum | awk '{print $1}')

curl --request GET "${BASE_URL}/api/v1/dr/articles?space_id=S1000001&page=1&page_size=20" \
  --header "x-timestamp: ${TS}" \
  --header "x-sign: ${SIGN}" \
  --header "Authorization: Bearer ${TOKEN}"
```

#### 5) 获取文章详情

```bash
TS=$(date +%s%3N)
SIGN=$(printf "%s" "${APP_SECRET}${TS}" | md5sum | awk '{print $1}')

curl --request GET "${BASE_URL}/api/v1/dr/articles/A1000001" \
  --header "x-timestamp: ${TS}" \
  --header "x-sign: ${SIGN}" \
  --header "Authorization: Bearer ${TOKEN}"
```

#### 6) 收藏文章

```bash
TS=$(date +%s%3N)
SIGN=$(printf "%s" "${APP_SECRET}${TS}" | md5sum | awk '{print $1}')

curl --request PUT "${BASE_URL}/api/v1/dr/articles/A1000001/bookmark" \
  --header "Content-Type: application/json" \
  --header "x-timestamp: ${TS}" \
  --header "x-sign: ${SIGN}" \
  --header "Authorization: Bearer ${TOKEN}" \
  --data '{"bookmarked":true}'
```

#### 7) 创建批注

```bash
TS=$(date +%s%3N)
SIGN=$(printf "%s" "${APP_SECRET}${TS}" | md5sum | awk '{print $1}')

curl --request POST "${BASE_URL}/api/v1/dr/highlights" \
  --header "Content-Type: application/json" \
  --header "x-timestamp: ${TS}" \
  --header "x-sign: ${SIGN}" \
  --header "Authorization: Bearer ${TOKEN}" \
  --data '{
    "article_id":"A1000001",
    "text":"AI 技术正在重新定义我们对教育的理解",
    "color":"#FFEB3B",
    "position_data":{"paragraph":1,"offset":10,"length":20},
    "note":"这个观点很有启发"
  }'
```

#### 8) AI 对话

```bash
TS=$(date +%s%3N)
SIGN=$(printf "%s" "${APP_SECRET}${TS}" | md5sum | awk '{print $1}')

curl --request POST "${BASE_URL}/api/v1/dr/ai/chat" \
  --header "Content-Type: application/json" \
  --header "x-timestamp: ${TS}" \
  --header "x-sign: ${SIGN}" \
  --header "Authorization: Bearer ${TOKEN}" \
  --data '{"article_id":"A1000001","message":"这篇文章的核心观点是什么？"}'
```

### 种子数据

运行 `npm run db:seed` 后自动创建：

| 数据 | 内容 |
|------|------|
| 测试用户 | 手机号 `13800138000`，昵称"测试用户" |
| 示例空间 | "DeepRead 精选"，邀请码 `DEEP2026` |
| 频道 | "科技前沿"、"深度评论" |
| 文章 | 4 篇示例文章（含完整 HTML 正文） |
