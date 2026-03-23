# DeepRead 客户端 API

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

### GET /api/v1/dr/spaces/:spaceId/homepage

获取空间首页模块列表（含资源详情）。需要用户 JWT。

**路径参数：**

| 参数 | 说明 |
|------|------|
| `spaceId` | 空间 ID |

**响应示例：**
```json
{
  "code": 200,
  "message": "success",
  "data": [
    {
      "moduleId": "HM1000001",
      "title": "编辑推荐",
      "subtitle": "本周精选",
      "layoutType": "large_card",
      "sortOrder": 0,
      "resources": [
        {
          "resourceType": "article",
          "resourceId": "A1000001",
          "sortOrder": 0,
          "detail": {
            "articleId": "A1000001",
            "channelId": "C1000001",
            "title": "AI 时代的教育变革",
            "summary": "探讨人工智能对教育的深远影响",
            "coverUrl": "https://example.com/cover.jpg",
            "layoutType": "default",
            "author": "李四",
            "readCount": 128,
            "publishedAt": "2026-03-01T08:00:00.000Z",
            "bookmarked": false,
            "readProgress": 0
          }
        },
        {
          "resourceType": "channel",
          "resourceId": "C1000001",
          "sortOrder": 1,
          "detail": {
            "channelId": "C1000001",
            "spaceId": "S1000001",
            "name": "科技前沿",
            "sortOrder": 0
          }
        },
        {
          "resourceType": "collection",
          "resourceId": "COL1000001",
          "sortOrder": 2,
          "detail": {
            "collectionId": "COL1000001",
            "spaceId": "S1000001",
            "name": "AI 专题精选",
            "description": "精选 AI 领域深度好文",
            "coverUrl": "https://example.com/collection-cover.jpg",
            "sortOrder": 0
          }
        }
      ]
    }
  ]
}
```

`layoutType` 决定客户端渲染样式，取值由管理员在后台配置（如 `large_card`、`small_card` 等）。

资源类型（`resourceType`）说明：

| 类型 | `detail` 字段 |
|------|------|
| `article` | articleId, channelId, title, summary, coverUrl, layoutType, author, readCount, publishedAt, bookmarked, readProgress |
| `channel` | channelId, spaceId, name, sortOrder |
| `collection` | collectionId, spaceId, name, description, coverUrl, sortOrder |

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
    "spaceId": "S1000001",
    "name": "DeepRead 精选",
    "description": "DeepRead 官方精选阅读空间"
  }
}
```

> 若用户已是该空间成员，返回 200 `"您已是该空间成员"` 而不报错。

**错误情况：**
```json
{ "code": 404, "message": "邀请码无效" }
{ "code": 400, "message": "邀请码已过期" }
{ "code": 400, "message": "邀请码使用次数已达上限" }
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
  "message": "success",
  "data": {
    "list": [
      {
        "articleId": "A1000001",
        "spaceId": "S1000001",
        "channelId": "C1000001",
        "title": "AI 时代的教育变革",
        "summary": "探讨人工智能对教育的深远影响",
        "coverUrl": "https://example.com/cover.jpg",
        "layoutType": "default",
        "author": "李四",
        "readCount": 128,
        "publishedAt": "2026-03-01T08:00:00.000Z",
        "bookmarked": true,
        "readProgress": 75
      }
    ],
    "total": 24,
    "page": 1,
    "pageSize": 20
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
  "message": "success",
  "data": {
    "articleId": "A1000001",
    "spaceId": "S1000001",
    "channelId": "C1000001",
    "title": "AI 时代的教育变革",
    "summary": "探讨人工智能对教育的深远影响",
    "coverUrl": "https://example.com/cover.jpg",
    "layoutType": "default",
    "content": "<h1>AI 时代的教育变革</h1><p>...</p>",
    "contentType": "html",
    "author": "李四",
    "readCount": 129,
    "publishedAt": "2026-03-01T08:00:00.000Z",
    "bookmarked": true,
    "readProgress": 75
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
{ "code": 200, "message": "已收藏" }
// 取消收藏时 message 为 "已取消收藏"
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
| `progress` | number | 阅读进度百分比（0-100），不传则默认 100（标记已读） |

**响应示例：**
```json
{ "code": 200, "message": "已标记" }
```

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
  "message": "批注已创建",
  "data": {
    "highlightId": "H1000002",
    "articleId": "A1000001",
    "text": "AI 技术正在重新定义我们对教育的理解",
    "color": "#FFEB3B",
    "positionData": { "paragraph": 1, "offset": 10, "length": 20 },
    "note": "这个观点很有启发",
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

**响应示例：**
```json
{
  "code": 200,
  "message": "批注已更新",
  "data": {
    "highlightId": "H1000002",
    "color": "#FF5722",
    "note": "修改后的笔记内容",
    "updatedAt": "2026-03-01T13:00:00.000Z"
  }
}
```

---

### DELETE /api/v1/dr/highlights/:highlightId

删除批注。需要用户 JWT（只能删除自己的批注）。

**响应示例：**
```json
{ "code": 200, "message": "批注已删除" }
```

---

### GET /api/v1/dr/highlights

获取文章批注列表。需要用户 JWT。

**查询参数：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `article_id` | string | 是 | 文章 ID |

**响应示例：**
```json
{
  "code": 200,
  "message": "success",
  "data": [
    {
      "highlightId": "H1000001",
      "articleId": "A1000001",
      "text": "AI 技术正在重新定义教育",
      "color": "#FFEB3B",
      "positionData": { "paragraph": 1, "offset": 10, "length": 12 },
      "note": "核心观点",
      "createdAt": "2026-03-01T10:00:00.000Z",
      "updatedAt": "2026-03-01T10:00:00.000Z"
    }
  ]
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
  "message": "success",
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

## 个人合集

> 个人合集是用户自建的文章收藏夹，与空间集合（Space Collection）相互独立。所有接口需要用户 JWT。

### POST /api/v1/dr/collections

创建个人合集。

**请求体：**
```json
{ "name": "我的 AI 阅读清单" }
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `name` | string | 是 | 合集名称，不能为空 |

**响应示例：**
```json
{
  "code": 200,
  "message": "合集已创建",
  "data": {
    "collectionId": "C1000003",
    "name": "我的 AI 阅读清单",
    "createdAt": "2026-03-23T08:00:00.000Z"
  }
}
```

---

### GET /api/v1/dr/collections

获取当前用户的所有个人合集（按创建时间倒序）。

**响应示例：**
```json
{
  "code": 200,
  "message": "success",
  "data": [
    {
      "collectionId": "C1000003",
      "name": "我的 AI 阅读清单",
      "articleCount": 5,
      "createdAt": "2026-03-23T08:00:00.000Z",
      "updatedAt": "2026-03-23T09:00:00.000Z"
    }
  ]
}
```

---

### PUT /api/v1/dr/collections/:collectionId/articles

向合集添加或移除文章。只能操作自己的合集。

**路径参数：**

| 参数 | 说明 |
|------|------|
| `collectionId` | 合集 ID |

**请求体：**
```json
{
  "article_id": "A1000001",
  "action": "add"
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `article_id` | string | 是 | 文章 ID |
| `action` | string | 是 | `add`（添加）或 `remove`（移除） |

**响应示例：**
```json
{ "code": 200, "message": "已添加到合集" }
// 移除时 message 为 "已从合集移除"
```

**错误情况：**
```json
{ "code": 404, "message": "合集不存在" }
{ "code": 403, "message": "无权操作他人的合集" }
```
