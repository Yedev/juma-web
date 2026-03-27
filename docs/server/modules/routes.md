# 路由模块文档

`server/src/routes/` 目录包含四个路由文件，各自服务于不同的客户端。所有路由均返回统一的 JSON 格式 `{ code, message, data? }`。

---

## 1. auth.ts — 管理员登录

**挂载路径**：`/api/auth`
**中间件**：无（公开接口）

### 接口列表

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/auth/login` | 管理员登录，返回 JWT Token |

### POST /api/auth/login

**请求体**：
```json
{
  "username": "juma",
  "password": "juma2026"
}
```

**成功响应**：
```json
{
  "code": 200,
  "message": "登录成功",
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "username": "juma"
  }
}
```

**错误响应**：

| 状态码 | code | 场景 |
|--------|------|------|
| 400 | 400 | username 或 password 为空 |
| 401 | 401 | 账号不存在或密码错误 |
| 500 | 500 | 服务器内部错误 |

**核心逻辑**：
1. 验证 username、password 均非空
2. 从数据库查询 `AdminUser` 记录（`findUnique({ where: { username } })`）
3. 使用 `bcrypt.compare(password, user.password)` 验证密码
4. 签发 JWT：`jwt.sign({ userId, username }, JWT_SECRET, { expiresIn: "24h" })`

**种子账号**：`juma` / `juma2026`（密码使用 bcryptjs salt=10 哈希存储）

---

## 2. admin.ts — 管理后台接口

**挂载路径**：`/api/admin`
**中间件**：`authMiddleware`（全局，所有接口均需要 JWT）

### 完整接口列表

#### 任务管理

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/admin/task-definitions` | 获取所有已注册任务定义 |
| `POST` | `/api/admin/tasks/execute-by-name` | 通过注册名入队任务（高级接口） |
| `GET` | `/api/admin/tasks` | 分页获取任务列表 |
| `POST` | `/api/admin/tasks` | 手动创建任务（低级接口，可指定全部参数） |
| `PUT` | `/api/admin/tasks/:taskId/status` | 更新任务状态 |
| `DELETE` | `/api/admin/tasks/:taskId` | 删除任务 |

#### 执行器客户端管理

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/admin/executor/clients` | 获取所有执行器客户端列表 |
| `DELETE` | `/api/admin/executor/clients/:clientId` | 删除执行器客户端记录 |

#### 应用配置管理

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/admin/configs` | 获取所有配置键列表（不含值） |
| `GET` | `/api/admin/config/:key` | 获取指定配置的键值 |
| `PUT` | `/api/admin/config/:key` | 创建或更新配置（upsert，值需为合法 JSON） |
| `DELETE` | `/api/admin/config/:key` | 删除配置 |

#### DeepRead 空间管理

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/admin/dr/spaces` | 获取所有空间（含成员数、频道数、文章数统计） |
| `POST` | `/api/admin/dr/spaces` | 创建新空间（自动生成邀请码） |
| `PUT` | `/api/admin/dr/spaces/:spaceId` | 更新空间信息 |
| `DELETE` | `/api/admin/dr/spaces/:spaceId` | 删除空间（级联删除成员、频道、文章） |
| `GET` | `/api/admin/dr/spaces/:spaceId/members` | 获取空间成员列表 |
| `GET` | `/api/admin/dr/spaces/:spaceId/invite-codes` | 获取空间邀请码列表（含使用记录） |
| `POST` | `/api/admin/dr/spaces/:spaceId/invite-codes` | 为空间创建新邀请码 |
| `DELETE` | `/api/admin/dr/invite-codes/:codeId` | 删除邀请码 |

#### DeepRead 频道管理

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/admin/dr/channels` | 获取频道列表（可按 space_id 过滤，含文章数） |
| `POST` | `/api/admin/dr/channels` | 创建频道 |
| `PUT` | `/api/admin/dr/channels/:channelId` | 更新频道名称或排序 |
| `DELETE` | `/api/admin/dr/channels/:channelId` | 删除频道 |

#### DeepRead 文章管理

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/admin/dr/articles` | 分页获取文章列表（可按 space_id / channel_id 过滤） |
| `GET` | `/api/admin/dr/articles/:articleId` | 获取文章详情（含 content） |
| `POST` | `/api/admin/dr/articles` | 创建文章 |
| `PUT` | `/api/admin/dr/articles/:articleId` | 更新文章（支持部分更新） |
| `DELETE` | `/api/admin/dr/articles/:articleId` | 删除文章 |

#### DeepRead 空间首页模块管理

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/admin/dr/spaces/:spaceId/homepage-modules` | 获取空间的所有首页模块（含资源绑定详情） |
| `POST` | `/api/admin/dr/spaces/:spaceId/homepage-modules` | 创建首页模块 |
| `PUT` | `/api/admin/dr/homepage-modules/:moduleId` | 更新模块（标题、副标题、排列方式） |
| `DELETE` | `/api/admin/dr/homepage-modules/:moduleId` | 删除模块（级联删除资源绑定） |
| `PUT` | `/api/admin/dr/spaces/:spaceId/homepage-modules/reorder` | 批量更新模块排序 |
| `POST` | `/api/admin/dr/homepage-modules/:moduleId/resources` | 向模块绑定资源（频道或文章） |
| `DELETE` | `/api/admin/dr/homepage-modules/:moduleId/resources/:resourceId` | 移除模块资源绑定 |

**排列方式（layoutType）枚举值**：

| 值 | 含义 |
|----|------|
| `large_card` | 大图卡 |
| `horizontal_card` | 横向卡 |
| `vertical_card` | 纵向卡 |
| `waterfall` | 瀑布流 |

**GET /api/admin/dr/spaces/:spaceId/homepage-modules 响应示例**：

```json
{
  "code": 200,
  "message": "success",
  "data": [
    {
      "id": 1,
      "moduleId": "HM17111234567890001",
      "spaceId": "S17111234567890001",
      "title": "推荐阅读",
      "subtitle": "精选内容每日更新",
      "layoutType": "large_card",
      "sortOrder": 0,
      "createdAt": "2026-03-22T00:00:00.000Z",
      "updatedAt": "2026-03-22T00:00:00.000Z",
      "resources": [
        {
          "id": 1,
          "moduleId": "HM17111234567890001",
          "resourceType": "channel",
          "resourceId": "CH17111234567890001",
          "sortOrder": 0,
          "detail": { "channelId": "CH...", "name": "技术专栏", "spaceId": "S...", "sortOrder": 0 }
        }
      ]
    }
  ]
}
```

**POST /api/admin/dr/homepage-modules/:moduleId/resources 请求体**：

```json
{
  "resourceType": "channel",
  "resourceId": "CH17111234567890001"
}
```

`resourceType` 只接受 `"channel"` 或 `"article"`，接口会校验对应资源是否存在。

### 关键接口详解

#### GET /api/admin/task-definitions

返回所有已注册任务的完整定义，包含参数说明和示例 payload。

```json
{
  "code": 200,
  "message": "success",
  "data": {
    "list": [
      {
        "taskName": "server.echo",
        "title": "服务端回显示例任务",
        "description": "服务端执行纯 task 逻辑，不依赖脚本。",
        "taskType": "server_task",
        "executeMode": "task",
        "params": [
          { "name": "message", "type": "string", "required": false, "description": "回显日志内容", "defaultValue": "hello from server task" },
          { "name": "repeat", "type": "number", "required": false, "description": "循环次数 (1-20)", "defaultValue": 3 },
          { "name": "sleep_ms", "type": "number", "required": false, "description": "每次循环等待毫秒数", "defaultValue": 400 }
        ],
        "exampleTaskPayload": { "message": "同步商品索引", "repeat": 3, "sleep_ms": 400 }
      }
    ],
    "total": 4
  }
}
```

#### POST /api/admin/tasks/execute-by-name

高级入队接口，通过注册名自动推断任务类型和参数校验。

**请求体**：
```json
{
  "taskName": "server.echo",
  "taskPayload": { "message": "hello", "repeat": 3, "sleep_ms": 400 },
  "executionName": "测试回显（可选标签）"
}
```

**成功响应**：
```json
{
  "code": 200,
  "message": "任务已创建",
  "data": {
    "task_id": "T17111234567890001",
    "task_name": "server.echo",
    "task_title": "服务端回显示例任务",
    "task_type": "server_task",
    "execution_name": "测试回显",
    "queue_position": 1
  }
}
```

#### POST /api/admin/tasks（低级接口）

支持手动指定全部字段，包括 `requiredTags`、`targetClientId`、`maxRetries`。

**请求体**：
```json
{
  "taskName": "client.echo",
  "taskPayload": { "message": "hi", "repeat": 2 },
  "executionName": "测试",
  "targetClientId": "mac-mini-01",
  "requiredTags": ["production", "mac"],
  "maxRetries": 3
}
```

- `maxRetries` 取值范围 0–10，仅 `client_task` 生效（server_task 强制为 0）
- `targetClientId` 仅 `client_task` 时有效
- 通过 `inferTaskTypeFromName()` 从 taskName 前缀推断 `taskType`

#### GET /api/admin/tasks（分页）

```
GET /api/admin/tasks?page=1&pageSize=20
```

**响应**：
```json
{
  "code": 200,
  "data": {
    "list": [ { "id": 1, "taskId": "T...", "taskName": "server.echo", "status": "completed", ... } ],
    "total": 42,
    "page": 1,
    "pageSize": 20
  }
}
```

---

## 3. app.ts — 移动 App 接口

**挂载路径**：`/api/v1/app`
**中间件**：`signMiddleware`（全局）

### 完整接口列表

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/v1/app/config` | 获取应用配置（默认 key=global_json） |
| `GET` | `/api/v1/app/task/catalog` | 获取已注册任务定义列表 |
| `POST` | `/api/v1/app/task/execute` | 入队任务（通过注册名） |
| `PUT` | `/api/v1/app/task/status` | 更新任务状态（供旧版客户端使用） |
| `GET` | `/api/v1/app/task/status` | 查询任务状态（含完整执行信息） |

### 接口详解

#### GET /api/v1/app/config

```
GET /api/v1/app/config?key=global_json
```

从 `AppConfig` 表读取指定 `configKey` 的值，并对 JSON 进行解析后返回。

**响应**：
```json
{
  "code": 200,
  "message": "success",
  "data": { "version": "1.0", "theme": "dark", "features": { ... } }
}
```

#### POST /api/v1/app/task/execute

**请求体**（字段名使用蛇形命名，与 admin.ts 的驼峰不同）：
```json
{
  "task_name": "server.echo",
  "task_payload": { "message": "hello", "repeat": 2 },
  "execution_name": "App触发的任务"
}
```

#### GET /api/v1/app/task/status

```
GET /api/v1/app/task/status?task_id=T17111234567890001
```

**响应**包含完整的任务信息：
```json
{
  "code": 200,
  "data": {
    "task_id": "T...",
    "task_name": "server.echo",
    "task_type": "server_task",
    "status": "completed",
    "status_info": { "executor": "server_task_runtime", "duration_ms": 1200, "output_json": { "ok": true } },
    "execution_log": "[server.echo] 1/3: hello\n...",
    "result_code": 0,
    "task_payload": { "message": "hello", "repeat": 2 },
    "execution_name": "App触发的任务",
    "target_client_id": null,
    "claimed_by_client_id": "server-local",
    "claimed_at": "2026-03-01T10:00:00.000Z",
    "started_at": "2026-03-01T10:00:00.000Z",
    "finished_at": "2026-03-01T10:00:01.200Z",
    "created_at": "2026-03-01T09:59:59.000Z",
    "updated_at": "2026-03-01T10:00:01.200Z"
  }
}
```

---

## 4. deepread.ts — DeepRead 客户端接口

**挂载路径**：`/api/v1/dr`
**中间件**：
- 全局：`signMiddleware`（所有接口）
- `/sms/send` 和 `/login` 之后：`drAuthMiddleware`（需要 JWT 的接口）

### 完整接口列表

#### 认证（无需 DR JWT）

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/v1/dr/sms/send` | 发送 SMS 验证码（开发模式固定返回 888888） |
| `POST` | `/api/v1/dr/login` | 手机号 + 验证码登录，返回 DR JWT（30天） |

#### 空间

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/v1/dr/space/join` | 通过邀请码加入空间 |

#### 文章

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/v1/dr/articles` | 分页获取文章列表（含书签/阅读进度状态） |
| `GET` | `/api/v1/dr/articles/:articleId` | 获取文章详情（自动增加阅读数） |
| `PUT` | `/api/v1/dr/articles/:articleId/bookmark` | 收藏或取消收藏文章 |
| `PUT` | `/api/v1/dr/articles/:articleId/read` | 更新阅读进度（0-100） |

#### 批注

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/v1/dr/highlights` | 创建批注（text+color+position+note） |
| `PUT` | `/api/v1/dr/highlights/:highlightId` | 更新批注（仅 color 和 note） |
| `DELETE` | `/api/v1/dr/highlights/:highlightId` | 删除批注（仅本人） |
| `GET` | `/api/v1/dr/highlights` | 获取指定文章的批注列表 |

#### 合集

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/v1/dr/collections` | 创建合集 |
| `PUT` | `/api/v1/dr/collections/:collectionId/articles` | 向合集添加或移除文章（action: "add"/"remove"） |
| `GET` | `/api/v1/dr/collections` | 获取当前用户的合集列表（含文章数） |

### 关键接口详解

#### POST /api/v1/dr/sms/send

**请求体**：
```json
{ "phone": "13800138000" }
```

手机号格式验证：`/^1\d{10}$/`（中国大陆 11 位手机号）

**响应**（开发模式直接返回验证码，生产环境应移除 `data.code`）：
```json
{
  "code": 200,
  "message": "验证码已发送",
  "data": { "code": "888888" }
}
```

验证码固定为 `888888`，有效期 5 分钟，存储在 `DrSmsCode` 表。

#### POST /api/v1/dr/login

**请求体**：
```json
{ "phone": "13800138000", "code": "888888" }
```

**成功响应**：
```json
{
  "code": 200,
  "message": "登录成功",
  "data": {
    "token": "eyJ...",
    "user": { "id": 1, "phone": "13800138000", "nickname": "测试用户", "avatar": "" }
  }
}
```

- 验证码匹配后标记为 `used: true`
- 如果用户不存在，自动创建（nickname 默认为 `用户${phone后4位}`）

#### GET /api/v1/dr/articles

```
GET /api/v1/dr/articles?space_id=S1000001&channel_id=CH1000001&page=1&page_size=20
```

- 需要当前用户是该空间的成员
- 同时批量查询书签和阅读状态，避免 N+1 查询

**响应的每个文章对象**：
```json
{
  "articleId": "A1000001",
  "spaceId": "S1000001",
  "channelId": "CH1000001",
  "title": "人工智能如何重塑未来教育",
  "summary": "探讨 AI 技术在教育领域的应用前景与挑战",
  "coverUrl": "",
  "layoutType": "default",
  "author": "张明",
  "readCount": 42,
  "publishedAt": "2026-03-01T00:00:00.000Z",
  "bookmarked": true,
  "readProgress": 75
}
```

#### POST /api/v1/dr/highlights（创建批注）

**请求体**：
```json
{
  "article_id": "A1000001",
  "text": "AI 技术正在重新定义我们对教育的理解",
  "color": "#FFEB3B",
  "position_data": { "start": 100, "end": 140, "paragraph": 2 },
  "note": "这句话很有启发性"
}
```

- `color` 默认为 `#FFEB3B`（黄色）
- `position_data` 为任意 JSON 对象，由客户端定义结构
- `note` 可为空字符串

#### PUT /api/v1/dr/collections/:collectionId/articles

**请求体**：
```json
{
  "article_id": "A1000001",
  "action": "add"
}
```

`action` 为 `"add"` 或 `"remove"`。操作失败如越权（非本人合集）返回 403。

