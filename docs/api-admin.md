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

**频道数据字段：**

| 字段 | 类型 | 说明 |
|------|------|------|
| `channelId` | string | 频道 ID |
| `spaceId` | string | 所属空间 ID |
| `name` | string | 频道名称 |
| `coverUrl` | string | 封面图片 URL |
| `sortOrder` | number | 排序值 |
| `articleCount` | number | 文章数量 |
| `createdAt` | string | 创建时间 |

**创建/编辑频道请求体：**
```json
{
  "space_id": "S1000002",
  "name": "AI 前沿",
  "cover_url": "https://example.com/cover.jpg",
  "sort_order": 1
}
```

---

#### 空间集合（Space Collections）

集合是空间内对文章的分组聚合，可作为首页资源展示。

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/admin/dr/spaces/:spaceId/collections` | 集合列表（含文章数统计） |
| POST | `/api/admin/dr/spaces/:spaceId/collections` | 创建集合 |
| PUT | `/api/admin/dr/collections/:collectionId` | 编辑集合 |
| DELETE | `/api/admin/dr/collections/:collectionId` | 删除集合（级联移除文章关联） |
| GET | `/api/admin/dr/collections/:collectionId/articles` | 集合内文章列表 |
| POST | `/api/admin/dr/collections/:collectionId/articles` | 向集合添加文章 |
| DELETE | `/api/admin/dr/collections/:collectionId/articles/:articleId` | 从集合移除文章 |

**集合数据字段：**

| 字段 | 类型 | 说明 |
|------|------|------|
| `collectionId` | string | 集合 ID（SC 开头） |
| `spaceId` | string | 所属空间 ID |
| `name` | string | 集合名称 |
| `description` | string | 集合描述 |
| `coverUrl` | string | 封面图片 URL |
| `sortOrder` | number | 排序值 |
| `articleCount` | number | 文章数量（列表接口返回） |
| `createdAt` | string | 创建时间 |
| `updatedAt` | string | 更新时间 |

**创建集合示例：**
```bash
curl -X POST "http://localhost:3001/api/admin/dr/spaces/S1000002/collections" \
  -H "Authorization: Bearer ${ADMIN_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "入门必读",
    "description": "适合新手的基础文章合集",
    "coverUrl": "https://example.com/collection-cover.jpg"
  }'
```

**响应示例：**
```json
{
  "code": 200,
  "message": "集合已创建",
  "data": {
    "collectionId": "SC1709001234567",
    "spaceId": "S1000002",
    "name": "入门必读",
    "description": "适合新手的基础文章合集",
    "coverUrl": "https://example.com/collection-cover.jpg",
    "sortOrder": 0,
    "createdAt": "2026-03-01T12:00:00.000Z",
    "updatedAt": "2026-03-01T12:00:00.000Z"
  }
}
```

**向集合添加文章：**
```bash
curl -X POST "http://localhost:3001/api/admin/dr/collections/SC1709001234567/articles" \
  -H "Authorization: Bearer ${ADMIN_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{ "articleId": "A1000001" }'
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

#### 首页模块（Homepage Modules）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/admin/dr/spaces/:spaceId/homepage-modules` | 模块列表（含资源详情） |
| POST | `/api/admin/dr/spaces/:spaceId/homepage-modules` | 创建模块 |
| PUT | `/api/admin/dr/homepage-modules/:moduleId` | 编辑模块 |
| DELETE | `/api/admin/dr/homepage-modules/:moduleId` | 删除模块（级联删除资源绑定） |
| PUT | `/api/admin/dr/spaces/:spaceId/homepage-modules/reorder` | 模块排序 |
| POST | `/api/admin/dr/homepage-modules/:moduleId/resources` | 绑定资源到模块 |
| DELETE | `/api/admin/dr/homepage-modules/:moduleId/resources/:resourceId` | 移除模块资源 |

**模块数据字段：**

| 字段 | 类型 | 说明 |
|------|------|------|
| `moduleId` | string | 模块 ID（HM 开头） |
| `spaceId` | string | 所属空间 ID |
| `title` | string | 模块标题 |
| `subtitle` | string | 模块副标题 |
| `layoutType` | string | 布局类型（见下） |
| `sortOrder` | number | 排序值 |
| `resources` | array | 绑定的资源列表 |

**布局类型（layoutType）：**

| 值 | 说明 |
|----|------|
| `large_horizontal` | 大图横向（默认） |
| `small_horizontal` | 小图横向 |
| `large_vertical` | 大图纵向 |
| `small_vertical` | 小图纵向 |
| `plain_text` | 纯文本 |

**资源类型（resourceType）：**

| 值 | detail 字段说明 |
|----|----------------|
| `channel` | 返回 DrChannel 对象（含 coverUrl） |
| `article` | 返回 DrArticle 概要（含 coverUrl、author、readCount 等） |
| `collection` | 返回 DrSpaceCollection 对象（含 coverUrl、description） |

**绑定资源示例：**
```bash
curl -X POST "http://localhost:3001/api/admin/dr/homepage-modules/HM1709001234567/resources" \
  -H "Authorization: Bearer ${ADMIN_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{ "resourceType": "collection", "resourceId": "SC1709001234567" }'
```

**模块排序示例：**
```bash
curl -X PUT "http://localhost:3001/api/admin/dr/spaces/S1000002/homepage-modules/reorder" \
  -H "Authorization: Bearer ${ADMIN_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{ "moduleIds": ["HM001", "HM003", "HM002"] }'
```

---

#### 用户（Users）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/admin/dr/users` | 用户列表（分页，含空间数/批注数统计） |
| GET | `/api/admin/dr/users/:userId` | 用户详情（含加入的空间列表） |

---

#### 每日精选（Daily Picks）

每日精选是按空间区分的精选文章轮换系统，管理员将文章加入精选池后，系统基于日期自动轮换展示。

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/admin/dr/spaces/:spaceId/daily-picks` | 精选文章池列表（含文章详情和高亮数统计） |
| POST | `/api/admin/dr/spaces/:spaceId/daily-picks` | 添加文章到精选池 |
| DELETE | `/api/admin/dr/daily-picks/:pickId` | 从精选池移除文章 |
| PUT | `/api/admin/dr/daily-picks/:pickId/toggle` | 启用/禁用精选文章 |

**精选文章数据字段：**

| 字段 | 类型 | 说明 |
|------|------|------|
| `pickId` | string | 精选记录 ID（DP 开头） |
| `spaceId` | string | 所属空间 ID |
| `articleId` | string | 关联文章 ID |
| `sortOrder` | number | 在轮换池中的排序 |
| `enabled` | boolean | 是否启用（禁用后不参与轮换） |
| `article` | object | 关联的文章详情 |
| `highlightCount` | number | 编辑高亮数量 |
| `createdAt` | string | 创建时间 |
| `updatedAt` | string | 更新时间 |

**添加文章到精选池：**
```bash
curl -X POST "http://localhost:3001/api/admin/dr/spaces/S1000002/daily-picks" \
  -H "Authorization: Bearer ${ADMIN_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{ "articleId": "A1000001" }'
```

**响应示例：**
```json
{
  "code": 200,
  "message": "文章已加入精选池",
  "data": {
    "pickId": "DP1709001234567",
    "spaceId": "S1000002",
    "articleId": "A1000001",
    "sortOrder": 0,
    "enabled": true,
    "createdAt": "2026-03-25T08:00:00.000Z"
  }
}
```

---

#### 编辑高亮（Editor Highlights）

编辑高亮是管理员为文章预先标注的重点文本，用于引导读者阅读。

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/admin/dr/articles/:articleId/editor-highlights` | 获取文章的编辑高亮列表 |
| POST | `/api/admin/dr/articles/:articleId/editor-highlights` | 创建编辑高亮 |
| PUT | `/api/admin/dr/editor-highlights/:highlightId` | 更新编辑高亮 |
| DELETE | `/api/admin/dr/editor-highlights/:highlightId` | 删除编辑高亮 |

**编辑高亮数据字段：**

| 字段 | 类型 | 说明 |
|------|------|------|
| `highlightId` | string | 高亮 ID（EH 开头） |
| `articleId` | string | 关联文章 ID |
| `text` | string | 高亮文本内容 |
| `color` | string | 高亮颜色（十六进制，默认 `#FFD700`） |
| `positionData` | string | 位置信息 JSON（原样存储） |
| `note` | string | 编辑备注/推荐理由 |
| `sortOrder` | number | 显示排序 |
| `createdAt` | string | 创建时间 |
| `updatedAt` | string | 更新时间 |

**创建编辑高亮：**
```bash
curl -X POST "http://localhost:3001/api/admin/dr/articles/A1000001/editor-highlights" \
  -H "Authorization: Bearer ${ADMIN_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "text": "这是文章中最关键的观点...",
    "color": "#FFD700",
    "note": "核心论点，推荐阅读"
  }'
```

**响应示例：**
```json
{
  "code": 200,
  "message": "高亮已创建",
  "data": {
    "highlightId": "EH1709001234567",
    "articleId": "A1000001",
    "text": "这是文章中最关键的观点...",
    "color": "#FFD700",
    "positionData": "{}",
    "note": "核心论点，推荐阅读",
    "sortOrder": 0,
    "createdAt": "2026-03-25T08:00:00.000Z"
  }
}
```
