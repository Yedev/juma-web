# 管理后台 API（/api/admin）

所有接口需携带 `Authorization: Bearer <token>` 请求头。

---

### 任务管理

#### GET /api/admin/task-definitions

获取所有已注册的任务定义。

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
        "paramsSchema": { ... },
        "examplePayload": { ... }
      }
    ]
  }
}
```

---

#### GET /api/admin/tasks

获取任务列表（分页）。

**查询参数：**

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `page` | number | `1` | 页码 |
| `page_size` | number | `20` | 每页数量 |
| `status` | string | - | 按状态筛选 |

**请求示例：**
```bash
curl "http://localhost:3001/api/admin/tasks?page=1&page_size=10&status=running" \
  -H "Authorization: Bearer ${ADMIN_TOKEN}"
```

**响应示例：**
```json
{
  "code": 200,
  "data": {
    "tasks": [
      {
        "id": 1,
        "taskId": "T1709001234567",
        "taskName": "server.echo",
        "taskType": "server_task",
        "status": "completed",
        "executionName": "sync-index-20260301",
        "retryCount": 0,
        "maxRetries": 2,
        "createdAt": "2026-03-01T12:00:00.000Z",
        "finishedAt": "2026-03-01T12:00:02.600Z"
      }
    ],
    "total": 42,
    "page": 1,
    "page_size": 10
  }
}
```

---

#### POST /api/admin/tasks

手动创建任务。

**请求体：**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `task_name` | string | 是 | 任务名（必须是已注册的） |
| `task_payload` | object | 否 | 任务参数 |
| `execution_name` | string | 否 | 执行实例名 |
| `max_retries` | number | 否 | 最大重试次数（0-10） |

---

#### POST /api/admin/tasks/execute-by-name

按任务名快速执行（触发一次执行）。

**请求体：**
```json
{
  "task_name": "server.echo",
  "task_payload": { "message": "test", "repeat": 1 }
}
```

---

#### PUT /api/admin/tasks/:taskId/status

更新指定任务状态。

**路径参数：**
- `taskId`：任务 ID（如 `T1709001234567`）

**请求体：**
```json
{
  "status": "queued",
  "status_info": { "note": "手动重置" }
}
```

---

#### DELETE /api/admin/tasks/:taskId

删除指定任务记录。

---

### 执行器客户端管理

#### GET /api/admin/executor/clients

获取所有注册的执行器客户端列表。

**响应示例：**
```json
{
  "code": 200,
  "data": {
    "clients": [
      {
        "clientId": "macmini-build-01",
        "name": "MacMini Build 01",
        "platform": "darwin",
        "appVersion": "1.0.0",
        "tags": ["xcode", "ios"],
        "status": "online",
        "ip": "192.168.1.100",
        "lastHeartbeat": "2026-03-01T12:05:00.000Z",
        "totalTasks": 156,
        "completedTasks": 150,
        "failedTasks": 6,
        "runningTasks": 0
      }
    ]
  }
}
```

---

#### DELETE /api/admin/executor/clients/:clientId

删除执行器客户端记录。

---

### 配置管理

#### GET /api/admin/configs

获取所有配置键值对列表。

**响应示例：**
```json
{
  "code": 200,
  "data": {
    "configs": [
      {
        "id": 1,
        "configKey": "global_json",
        "configValue": "{\"version\":\"1.0.0\"}",
        "updatedAt": "2026-03-01T12:00:00.000Z"
      }
    ]
  }
}
```

---

#### GET /api/admin/config/:key

获取指定配置。

---

#### PUT /api/admin/config/:key

创建或更新配置（upsert）。

**请求体：**
```json
{
  "value": {
    "version": "1.0.1",
    "features": { "darkMode": true }
  }
}
```

---

#### DELETE /api/admin/config/:key

删除配置。

---

### DeepRead 管理

#### 空间（Spaces）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/admin/dr/spaces` | 空间列表（含成员数/频道数/文章数统计） |
| POST | `/api/admin/dr/spaces` | 创建空间 |
| PUT | `/api/admin/dr/spaces/:spaceId` | 编辑空间 |
| DELETE | `/api/admin/dr/spaces/:spaceId` | 删除空间（级联删除子数据） |
| GET | `/api/admin/dr/spaces/:spaceId/members` | 空间成员列表 |
| GET | `/api/admin/dr/spaces/:spaceId/invite-codes` | 邀请码列表 |
| POST | `/api/admin/dr/spaces/:spaceId/invite-codes` | 生成邀请码 |
| DELETE | `/api/admin/dr/invite-codes/:codeId` | 删除邀请码 |

**创建空间示例：**
```bash
curl -X POST "http://localhost:3001/api/admin/dr/spaces" \
  -H "Authorization: Bearer ${ADMIN_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "技术精选",
    "description": "精选技术文章"
  }'
```

**响应示例：**
```json
{
  "code": 200,
  "data": {
    "spaceId": "S1000002",
    "name": "技术精选",
    "description": "精选技术文章",
    "inviteCode": "TECH26",
    "createdAt": "2026-03-01T12:00:00.000Z"
  }
}
```

**生成邀请码示例：**
```bash
curl -X POST "http://localhost:3001/api/admin/dr/spaces/S1000002/invite-codes" \
  -H "Authorization: Bearer ${ADMIN_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "label": "内测邀请码",
    "max_uses": 100,
    "expires_at": "2026-12-31T23:59:59Z"
  }'
```

---

#### 频道（Channels）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/admin/dr/channels` | 频道列表（`space_id` 可选筛选） |
| POST | `/api/admin/dr/channels` | 创建频道 |
| PUT | `/api/admin/dr/channels/:channelId` | 编辑频道 |
| DELETE | `/api/admin/dr/channels/:channelId` | 删除频道 |

**创建频道示例：**
```json
{
  "space_id": "S1000002",
  "name": "AI 前沿",
  "sort_order": 1
}
```

---

#### 文章（Articles）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/admin/dr/articles` | 文章列表（分页，可按 space_id/channel_id 筛选） |
| POST | `/api/admin/dr/articles` | 创建文章 |
| PUT | `/api/admin/dr/articles/:articleId` | 编辑文章 |
| DELETE | `/api/admin/dr/articles/:articleId` | 删除文章（级联删除收藏/已读/批注） |

**创建文章请求体：**
```json
{
  "space_id": "S1000002",
  "channel_id": "C1000001",
  "title": "大语言模型的未来",
  "summary": "探讨 LLM 技术发展趋势",
  "cover_url": "https://example.com/cover.jpg",
  "layout_type": "article",
  "content_html": "<h1>大语言模型的未来</h1><p>...</p>",
  "author": "张三",
  "published_at": "2026-03-01T08:00:00Z"
}
```

---

#### 用户（Users）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/admin/dr/users` | 用户列表（分页，含空间数/批注数统计） |
| GET | `/api/admin/dr/users/:userId` | 用户详情（含加入的空间列表） |
