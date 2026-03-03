# juma-web

移动端应用后台管理系统（Express + TypeScript + Prisma + SQLite，前端为 Vite + React + TypeScript + Ant Design）。

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
