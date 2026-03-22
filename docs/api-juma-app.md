# 移动端 API（/api/v1/app）

所有接口需携带 `x-timestamp` 和 `x-sign` 请求头。

---

### GET /api/v1/app/config

获取应用 JSON 配置。

**查询参数：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `key` | string | 否 | 配置键名，默认 `global_json` |

**请求示例：**
```bash
curl -G "http://localhost:3001/api/v1/app/config" \
  -H "x-timestamp: ${TS}" \
  -H "x-sign: ${SIGN}" \
  --data-urlencode "key=global_json"
```

**响应示例：**
```json
{
  "code": 200,
  "data": {
    "key": "global_json",
    "value": {
      "version": "1.0.0",
      "features": { "darkMode": false }
    }
  }
}
```

**错误情况：**
```json
{ "code": 404, "message": "配置不存在" }
```

---

### GET /api/v1/app/task/catalog

获取所有已注册的任务定义（含参数说明和示例）。

**请求示例：**
```bash
curl "http://localhost:3001/api/v1/app/task/catalog" \
  -H "x-timestamp: ${TS}" \
  -H "x-sign: ${SIGN}"
```

**响应示例：**
```json
{
  "code": 200,
  "data": {
    "tasks": [
      {
        "taskName": "server.echo",
        "taskType": "server_task",
        "description": "服务端 echo 任务",
        "paramsSchema": {
          "message": { "type": "string", "description": "要打印的消息", "example": "hello" },
          "repeat": { "type": "number", "description": "重复次数", "example": 3 },
          "sleep_ms": { "type": "number", "description": "每次间隔毫秒数", "example": 500 }
        },
        "examplePayload": { "message": "hello", "repeat": 3, "sleep_ms": 500 }
      },
      {
        "taskName": "client.echo",
        "taskType": "client_task",
        "description": "客户端 echo 任务",
        "paramsSchema": { ... },
        "examplePayload": { ... }
      }
    ]
  }
}
```

---

### POST /api/v1/app/task/execute

提交任务执行请求，任务进入 queued 状态。

**请求体：**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `task_name` | string | 是 | 已注册的任务名（如 `server.echo`） |
| `task_payload` | object | 否 | 任务参数（格式由任务定义决定） |
| `execution_name` | string | 否 | 本次执行的标识名称 |
| `max_retries` | number | 否 | 最大重试次数（0-10，默认 0） |

**client_task 专有字段（嵌套在 task_payload 中）：**

| 字段 | 类型 | 说明 |
|------|------|------|
| `required_tags` | string[] | 执行器必须满足的标签（AND 关系） |
| `target_client_id` | string | 指定执行的客户端 ID |

**请求示例（server_task）：**
```bash
curl -X POST "http://localhost:3001/api/v1/app/task/execute" \
  -H "Content-Type: application/json" \
  -H "x-timestamp: ${TS}" \
  -H "x-sign: ${SIGN}" \
  -d '{
    "task_name": "server.echo",
    "task_payload": {
      "message": "同步商品索引",
      "repeat": 5,
      "sleep_ms": 300
    },
    "execution_name": "sync-index-20260301",
    "max_retries": 2
  }'
```

**请求示例（client_task，指定标签）：**
```bash
curl -X POST "http://localhost:3001/api/v1/app/task/execute" \
  -H "Content-Type: application/json" \
  -H "x-timestamp: ${TS}" \
  -H "x-sign: ${SIGN}" \
  -d '{
    "task_name": "client.mock3s",
    "task_payload": {
      "payload": { "build_id": "build-001", "branch": "main" },
      "required_tags": ["xcode", "ios"]
    },
    "execution_name": "iOS-Build-#42"
  }'
```

**响应示例：**
```json
{
  "code": 200,
  "message": "任务已提交",
  "data": {
    "task_id": "T1709001234567"
  }
}
```

**错误情况：**
```json
{ "code": 404, "message": "任务不存在: client.not-exists" }
```

---

### PUT /api/v1/app/task/status

更新任务状态（通常由执行端或外部系统调用）。

**请求体：**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `task_id` | string | 是 | 任务 ID（由 execute 接口返回） |
| `status` | string | 是 | 新状态：`queued`/`running`/`completed`/`error` |
| `status_info` | object | 否 | 附加状态信息（任意 JSON 对象） |

**请求示例：**
```bash
curl -X PUT "http://localhost:3001/api/v1/app/task/status" \
  -H "Content-Type: application/json" \
  -H "x-timestamp: ${TS}" \
  -H "x-sign: ${SIGN}" \
  -d '{
    "task_id": "T1709001234567",
    "status": "running",
    "status_info": {
      "current_step": "3/5 处理数据",
      "progress": 60
    }
  }'
```

**响应示例：**
```json
{
  "code": 200,
  "message": "任务状态已更新",
  "data": { "task_id": "T1709001234567" }
}
```

---

### GET /api/v1/app/task/status

查询任务详情（含完整日志和执行统计）。

**查询参数：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `task_id` | string | 是 | 任务 ID |

**请求示例：**
```bash
curl -G "http://localhost:3001/api/v1/app/task/status" \
  -H "x-timestamp: ${TS}" \
  -H "x-sign: ${SIGN}" \
  --data-urlencode "task_id=T1709001234567"
```

**响应示例：**
```json
{
  "code": 200,
  "data": {
    "task_id": "T1709001234567",
    "task_name": "server.echo",
    "task_type": "server_task",
    "execution_name": "sync-index-20260301",
    "task_payload": { "message": "同步商品索引", "repeat": 5 },
    "status": "completed",
    "status_info": { "current_step": "完成", "progress": 100 },
    "execution_log": "[2026-03-01T12:00:00.000Z] Echo #1: 同步商品索引\n...",
    "result_code": 0,
    "max_retries": 2,
    "retry_count": 0,
    "created_at": "2026-03-01T12:00:00.000Z",
    "started_at": "2026-03-01T12:00:00.100Z",
    "finished_at": "2026-03-01T12:00:02.600Z"
  }
}
```
