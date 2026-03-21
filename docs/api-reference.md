# API 完整参考文档

## 目录

- [通用说明](#通用说明)
- [认证接口](#认证接口)
- [移动端 API（/api/v1/app）](#移动端-apiapiV1app)
- [管理后台 API（/api/admin）](#管理后台-apiadmins)
- [DeepRead 客户端 API（/api/v1/dr）](#deepread-客户端-api)
- [健康检查](#健康检查)
- [错误码说明](#错误码说明)

---

## 通用说明

### 响应格式

所有接口均返回 JSON，标准格式如下：

```json
{
  "code": 200,
  "message": "操作成功",
  "data": { ... }
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `code` | number | 业务状态码（200=成功，非 200=失败） |
| `message` | string | 状态描述 |
| `data` | any | 响应数据（失败时可能为 null） |

### 签名计算（x-sign）

所有 `/api/v1/*` 接口需要以下请求头：

```
x-timestamp: 1709000000000        # 13位毫秒时间戳
x-sign: a3f2c1d4e5b6...          # MD5(APP_SECRET + x-timestamp)，32位小写十六进制
```

**计算方式（Shell）：**
```bash
APP_SECRET="juma2026_secret"
TS=$(date +%s%3N)
SIGN=$(printf "%s" "${APP_SECRET}${TS}" | md5sum | awk '{print $1}')
```

**计算方式（JavaScript）：**
```javascript
import CryptoJS from 'crypto-js'
const ts = Date.now().toString()
const sign = CryptoJS.MD5(APP_SECRET + ts).toString()
```

---

## 认证接口

### POST /api/auth/login

管理员登录，获取 JWT Token。

**请求体：**
```json
{
  "username": "juma",
  "password": "juma2026"
}
```

**响应示例：**
```json
{
  "code": 200,
  "message": "登录成功",
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
}
```

**错误情况：**
```json
{ "code": 401, "message": "用户名或密码错误" }
```

---

## 移动端 API（/api/v1/app）

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

---

## 管理后台 API（/api/admin）

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

---

## DeepRead 客户端 API

所有接口需携带 `x-timestamp` 和 `x-sign` 请求头。
保护接口还需携带 `Authorization: Bearer <dr_token>`。

---

### POST /api/v1/dr/sms/send

发送短信验证码。

**请求体：**
```json
{ "phone": "13800138000" }
```

**响应示例：**
```json
{ "code": 200, "message": "验证码已发送" }
```

> **开发模式**：验证码固定为 `888888`，不发送真实短信。

---

### POST /api/v1/dr/login

验证码登录（不存在则自动注册）。

**请求体：**
```json
{
  "phone": "13800138000",
  "code": "888888"
}
```

**响应示例：**
```json
{
  "code": 200,
  "message": "登录成功",
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "user": {
      "id": 1,
      "phone": "13800138000",
      "nickname": "用户8000",
      "avatar": ""
    }
  }
}
```

---

### POST /api/v1/dr/space/join

通过邀请码加入空间。需要用户 JWT。

**请求体：**
```json
{ "invite_code": "DEEP2026" }
```

**响应示例：**
```json
{
  "code": 200,
  "message": "加入成功",
  "data": {
    "space_id": "S1000001",
    "space_name": "DeepRead 精选"
  }
}
```

**错误情况：**
```json
{ "code": 400, "message": "邀请码无效或已过期" }
{ "code": 400, "message": "已加入该空间" }
```

---

### GET /api/v1/dr/articles

获取文章列表。需要用户 JWT。

**查询参数：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `space_id` | string | 是 | 空间 ID |
| `channel_id` | string | 否 | 频道 ID 筛选 |
| `page` | number | 否 | 页码（默认 1） |
| `page_size` | number | 否 | 每页数量（默认 20） |

**响应示例：**
```json
{
  "code": 200,
  "data": {
    "articles": [
      {
        "articleId": "A1000001",
        "title": "AI 时代的教育变革",
        "summary": "探讨人工智能对教育的深远影响",
        "coverUrl": "https://example.com/cover.jpg",
        "author": "李四",
        "readCount": 128,
        "publishedAt": "2026-03-01T08:00:00.000Z",
        "isBookmarked": true,
        "readProgress": 75
      }
    ],
    "total": 24,
    "page": 1,
    "page_size": 20
  }
}
```

---

### GET /api/v1/dr/articles/:articleId

获取文章详情（自动增加阅读数）。需要用户 JWT。

**响应示例：**
```json
{
  "code": 200,
  "data": {
    "articleId": "A1000001",
    "spaceId": "S1000001",
    "channelId": "C1000001",
    "title": "AI 时代的教育变革",
    "summary": "探讨人工智能对教育的深远影响",
    "coverUrl": "https://example.com/cover.jpg",
    "contentHtml": "<h1>AI 时代的教育变革</h1><p>...</p>",
    "author": "李四",
    "readCount": 129,
    "publishedAt": "2026-03-01T08:00:00.000Z",
    "isBookmarked": true,
    "readProgress": 75,
    "highlights": [
      {
        "highlightId": "H1000001",
        "text": "AI 技术正在重新定义教育",
        "color": "#FFEB3B",
        "positionData": { "paragraph": 1, "offset": 10, "length": 12 },
        "note": "核心观点"
      }
    ]
  }
}
```

---

### PUT /api/v1/dr/articles/:articleId/bookmark

收藏/取消收藏文章。需要用户 JWT。

**请求体：**
```json
{ "bookmarked": true }
```

**响应示例：**
```json
{ "code": 200, "message": "已收藏", "data": { "bookmarked": true } }
```

---

### PUT /api/v1/dr/articles/:articleId/read

标记文章已读/更新阅读进度。需要用户 JWT。

**请求体：**
```json
{ "progress": 80 }
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `progress` | number | 阅读进度百分比（0-100） |

---

### POST /api/v1/dr/highlights

创建高亮批注。需要用户 JWT。

**请求体：**
```json
{
  "article_id": "A1000001",
  "text": "AI 技术正在重新定义我们对教育的理解",
  "color": "#FFEB3B",
  "position_data": {
    "paragraph": 1,
    "offset": 10,
    "length": 20
  },
  "note": "这个观点很有启发"
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `article_id` | string | 是 | 文章 ID |
| `text` | string | 是 | 高亮的文字内容 |
| `color` | string | 否 | 高亮颜色（十六进制，如 `#FFEB3B`） |
| `position_data` | object | 否 | 文字位置信息（自定义结构，原样存储） |
| `note` | string | 否 | 批注笔记 |

**响应示例：**
```json
{
  "code": 200,
  "data": {
    "highlightId": "H1000002",
    "text": "AI 技术正在重新定义我们对教育的理解",
    "color": "#FFEB3B",
    "createdAt": "2026-03-01T12:30:00.000Z"
  }
}
```

---

### PUT /api/v1/dr/highlights/:highlightId

更新批注（颜色或笔记）。需要用户 JWT（只能更新自己的批注）。

**请求体：**
```json
{
  "color": "#FF5722",
  "note": "修改后的笔记内容"
}
```

---

### DELETE /api/v1/dr/highlights/:highlightId

删除批注。需要用户 JWT（只能删除自己的批注）。

---

### GET /api/v1/dr/highlights

获取文章批注列表。需要用户 JWT。

**查询参数：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `article_id` | string | 是 | 文章 ID |

---

### POST /api/v1/dr/collections

创建合集。需要用户 JWT。

**请求体：**
```json
{ "name": "AI 专题精选" }
```

**响应示例：**
```json
{
  "code": 200,
  "data": {
    "collectionId": "COL1000001",
    "name": "AI 专题精选",
    "createdAt": "2026-03-01T12:00:00.000Z"
  }
}
```

---

### PUT /api/v1/dr/collections/:collectionId/articles

向合集添加或移除文章。需要用户 JWT。

**请求体：**
```json
{
  "article_id": "A1000001",
  "action": "add"
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `article_id` | string | 文章 ID |
| `action` | string | `add`（添加）或 `remove`（移除） |

---

### GET /api/v1/dr/collections

获取用户的合集列表（含文章数）。需要用户 JWT。

**响应示例：**
```json
{
  "code": 200,
  "data": {
    "collections": [
      {
        "collectionId": "COL1000001",
        "name": "AI 专题精选",
        "articleCount": 8,
        "createdAt": "2026-03-01T12:00:00.000Z"
      }
    ]
  }
}
```

---

### POST /api/v1/dr/ai/chat

基于文章内容与 AI 对话（需配置 `GEMINI_API_KEY`）。需要用户 JWT。

**请求体：**
```json
{
  "article_id": "A1000001",
  "message": "这篇文章的核心观点是什么？"
}
```

**响应示例：**
```json
{
  "code": 200,
  "data": {
    "reply": "这篇文章的核心观点是：AI 技术将从三个维度重塑教育体系——个性化学习路径、实时反馈机制和跨语言教学壁垒消除。作者认为..."
  }
}
```

**错误情况（未配置 API Key）：**
```json
{ "code": 500, "message": "AI 服务未配置" }
```

---

## 健康检查

### GET /api/health

```bash
curl "http://localhost:3001/api/health"
```

**响应：**
```json
{
  "code": 200,
  "message": "OK",
  "timestamp": "2026-03-01T12:00:00.000Z"
}
```

---

## 错误码说明

| HTTP 状态码 | 业务 code | 说明 |
|------------|----------|------|
| 200 | 200 | 成功 |
| 400 | 400 | 请求参数错误 |
| 401 | 401 | 未认证（缺少 Token 或 Token 无效，或 x-sign 错误） |
| 403 | 403 | 禁止访问（时间戳过期，防重放） |
| 404 | 404 | 资源不存在 |
| 500 | 500 | 服务器内部错误 |

### 签名错误示例

```json
// x-timestamp 缺失或格式错误
HTTP 403
{ "code": 403, "message": "时间戳无效" }

// 时间戳超出 ±5 分钟
HTTP 403
{ "code": 403, "message": "请求已过期" }

// x-sign 不匹配
HTTP 401
{ "code": 401, "message": "签名错误" }
```

### JWT 错误示例

```json
// Bearer Token 缺失
HTTP 401
{ "code": 401, "message": "未授权" }

// Token 过期或无效
HTTP 401
{ "code": 401, "message": "Token 无效或已过期" }
```
