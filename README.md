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

## 任务执行系统（双执行模式）

已支持两种任务类型：

1. `server_script`：在服务端本机执行脚本
2. `remote_mac`：分发给 Mac Mini 客户端执行（适合无公网 IP 机器）

### 架构说明

- **任务创建与管理**：在后台「任务管理」页面创建任务、查看状态、手工更新、删除任务
- **服务端本地执行引擎**：`server/src/services/executionEngine.ts`
  - 定时扫描 `queued + server_script` 任务
  - 领取后执行 shell 脚本，写入日志、结果码、状态
- **远程执行器网关**：`server/src/routes/executor.ts`
  - 客户端注册、心跳、拉任务、回传结果
  - 通过共享密钥 `EXECUTOR_KEY` 做鉴权
- **客户端状态可视化**：任务管理页下方可查看执行客户端在线/离线、心跳、统计信息

### 远程执行（无公网 IP）的关键点

Mac Mini 不需要被外网访问，采用“**客户端主动连接服务端**”方式：

1. 客户端定时心跳（服务端据此判断在线/离线）
2. 客户端主动轮询拉取任务
3. 客户端本地执行并回传日志/结果

推荐配置的服务端环境变量：

```bash
EXECUTOR_SHARED_KEY="juma_executor_2026"
EXECUTOR_OFFLINE_TIMEOUT_MS=60000
REMOTE_TASK_STALE_TIMEOUT_MS=300000
LOCAL_EXECUTOR_CONCURRENCY=1
```

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

### 2) 触发任务执行

- **Method**: `POST`
- **URL**: `/api/v1/app/task/execute`
- **Body**:
  - `task_name`: string（必填）
  - `task_params`: object（可选）

```bash
APP_SECRET="juma2026_secret"
BASE_URL="http://localhost:3001"
TS=$(date +%s%3N)
SIGN=$(printf "%s" "${APP_SECRET}${TS}" | md5sum | awk '{print $1}')

curl --request POST "${BASE_URL}/api/v1/app/task/execute" \
  --header "Content-Type: application/json" \
  --header "x-timestamp: ${TS}" \
  --header "x-sign: ${SIGN}" \
  --data '{"task_name":"数据分析任务","task_params":{"target":"user_data"}}'
```

### 3) 更新任务状态

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

### 4) 查询任务状态

- **Method**: `GET`
- **URL**: `/api/v1/app/task/status`
- **Query**: `task_id`（必填）

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
- `remote_mac` 任务支持指定目标客户端/required_tags
- 查看任务状态、详情、执行日志
- 更新任务状态与 `status_info`
- 删除任务
- 分页刷新、客户端状态刷新
- 客户端状态表（在线/离线、最近心跳、任务统计）
