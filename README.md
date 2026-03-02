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

- 新建任务（任务名 + JSON 参数）
- 更新任务状态和 `status_info`
- 删除任务
- 分页和刷新列表
