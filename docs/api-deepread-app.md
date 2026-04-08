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

获取空间首页模块列表。需要用户 JWT。

**路径参数：**

| 参数 | 说明 |
|------|------|
| `spaceId` | 空间 ID |

每个模块包含 `moduleType` 字段，客户端根据类型做不同渲染。`load_list` 类型模块固定排在其他模块之后。

**模块类型（`moduleType`）说明：**

| 类型 | 说明 | 返回字段 |
|------|------|------|
| `standard` | 标准模块，手动绑定资源 | moduleId, moduleType, title, subtitle, layoutType, resources |
| `title_desc` | 标题描述模块，纯文本展示 | moduleId, moduleType, title, description |
| `load_list` | 加载列表模块，客户端自行拉取数据 | moduleId, moduleType, title, subtitle, sourceType, sourceId |

**`load_list` 说明：** 仅返回来源信息，客户端收到后根据 `sourceType` 调用对应接口加载文章列表：
- `sourceType: "channel"` → 调用 `GET /api/v1/dr/articles?space_id=&channel_id={sourceId}`
- `sourceType: "collection"` → 调用 `GET /api/v1/dr/articles?space_id=&collection_id={sourceId}`

**响应示例：**
```json
{
  "code": 200,
  "message": "success",
  "data": [
    {
      "moduleId": "HM1000001",
      "moduleType": "standard",
      "title": "编辑推荐",
      "subtitle": "本周精选",
      "layoutType": "large_horizontal",
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
            "coverUrl": "https://example.com/channel-cover.jpg",
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
    },
    {
      "moduleId": "HM1000002",
      "moduleType": "title_desc",
      "title": "关于本空间",
      "description": "这里汇聚了 AI 领域最前沿的深度内容，每周更新。"
    },
    {
      "moduleId": "HM1000003",
      "moduleType": "load_list",
      "title": "科技前沿",
      "subtitle": "频道全部文章",
      "sourceType": "channel",
      "sourceId": "C1000001"
    }
  ]
}
```

`layoutType`（仅 `standard` 模块）取值：

| 值 | 说明 |
|----|------|
| `large_horizontal` | 大图横向（默认） |
| `small_horizontal` | 小图横向 |
| `large_vertical` | 大图纵向 |
| `small_vertical` | 小图纵向 |
| `plain_text` | 纯文本 |

`standard` 模块资源类型（`resourceType`）说明：

| 类型 | `detail` 字段 |
|------|------|
| `article` | articleId, channelId, title, summary, coverUrl, layoutType, author, readCount, publishedAt, bookmarked, readProgress |
| `channel` | channelId, spaceId, name, coverUrl, sortOrder |
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

获取文章列表（频道或合集）。需要用户 JWT。

**查询参数：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `space_id` | string | 是 | 空间 ID |
| `channel_id` | string | 否 | 频道 ID，与 `collection_id` 二选一 |
| `collection_id` | string | 否 | 合集 ID，与 `channel_id` 二选一；文章按 `sortOrder` 升序排列 |
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

---

## 空间合集

> 空间合集由管理员创建并维护，用户加入空间后可通过首页模块入口访问合集内的文章。所有接口需要用户 JWT，且用户必须是对应空间的成员。

## 阅读统计

### POST /api/v1/dr/reading-stats

上报单条阅读统计数据。需要用户 JWT。

**查询参数：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `include_today_summary` | string | 否 | 设为 `true` 时响应中附带当日阅读汇总 |

**请求体：**
```json
{
  "article_id": "A1000001",
  "reading_time_seconds": 180,
  "scroll_depth": 85,
  "session_start": "2026-03-25T10:00:00.000Z",
  "session_end": "2026-03-25T10:03:00.000Z"
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `article_id` | string | 是 | 文章 ID |
| `reading_time_seconds` | int | 否 | 有效阅读时长（秒），默认 0 |
| `scroll_depth` | int | 否 | 滚动深度 (0-100)，默认 0 |
| `session_start` | string | 否 | 阅读开始时间，默认当前时间 |
| `session_end` | string | 否 | 阅读结束时间，默认当前时间 |

**响应示例（不含汇总）：**
```json
{
  "code": 200,
  "message": "统计已上报",
  "data": {
    "statsId": "RS17429088000001234",
    "articleId": "A1000001",
    "readingTimeSeconds": 180,
    "scrollDepth": 85,
    "createdAt": "2026-03-25T10:03:00.000Z"
  }
}
```

**响应示例（`?include_today_summary=true`）：**
```json
{
  "code": 200,
  "message": "统计已记录",
  "data": {
    "statsId": "RS17429088000001234",
    "articleId": "A1000001",
    "readingTimeSeconds": 180,
    "scrollDepth": 85,
    "createdAt": "2026-03-25T10:03:00.000Z",
    "total_reading_time_today": 3600,
    "articles_read_today": 5
  }
}
```

---

### POST /api/v1/dr/reading-stats/batch

批量上报阅读统计数据（最多 100 条）。需要用户 JWT。

**请求体：**
```json
{
  "stats": [
    {
      "article_id": "A1000001",
      "reading_time_seconds": 180,
      "scroll_depth": 85,
      "session_start": "2026-03-25T10:00:00.000Z",
      "session_end": "2026-03-25T10:03:00.000Z"
    },
    {
      "article_id": "A1000002",
      "reading_time_seconds": 60,
      "scroll_depth": 50,
      "session_start": "2026-03-25T10:05:00.000Z",
      "session_end": "2026-03-25T10:06:00.000Z"
    }
  ]
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `stats` | array | 是 | 阅读统计数组，最多 100 条 |
| `stats[].article_id` | string | 是 | 文章 ID |
| `stats[].reading_time_seconds` | int | 否 | 有效阅读时长（秒），默认 0 |
| `stats[].scroll_depth` | int | 否 | 滚动深度 (0-100)，默认 0 |
| `stats[].session_start` | string | 否 | 阅读开始时间 |
| `stats[].session_end` | string | 否 | 阅读结束时间 |

**响应示例：**
```json
{
  "code": 200,
  "message": "统计已批量上报",
  "data": {
    "count": 2
  }
}
```

**错误情况：**
```json
{ "code": 400, "message": "stats 不能为空" }
{ "code": 400, "message": "单次最多上报 100 条统计" }
```

---

### GET /api/v1/dr/stats/summary

获取用户阅读统计汇总。需要用户 JWT。

**查询参数：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `period` | string | 否 | 统计周期: `today`/`week`/`month`/`all`，默认 `all` |

**响应示例：**
```json
{
  "code": 200,
  "message": "success",
  "data": {
    "total_reading_time_seconds": 86400,
    "total_articles_read": 45,
    "total_highlights": 128,
    "total_notes": 32,
    "reading_streak_days": 12
  }
}
```

---

## 收藏列表

### GET /api/v1/dr/bookmarks

获取用户收藏的文章列表。需要用户 JWT。

**查询参数：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `page` | int | 否 | 页码，默认 1 |
| `page_size` | int | 否 | 每页数量，默认 20 |

**响应示例：**
```json
{
  "code": 200,
  "message": "success",
  "data": {
    "list": [
      {
        "articleId": "A1000001",
        "title": "AI 时代的教育变革",
        "summary": "探讨人工智能对教育的深远影响...",
        "coverUrl": "https://example.com/cover.jpg",
        "author": "李四",
        "bookmarkedAt": "2026-03-25T10:00:00.000Z"
      }
    ],
    "total": 24,
    "page": 1,
    "pageSize": 20
  }
}
```

---

## 每日一文

### GET /api/v1/dr/daily-article

获取每日推荐文章（含编辑高亮及上下文）及思维格栅合集模块。需要用户 JWT。

**响应示例：**
```json
{
  "code": 200,
  "message": "success",
  "data": {
    "date": "2026-04-06",
    "article": {
      "articleId": "A1000001",
      "title": "AI 时代的教育变革",
      "summary": "探讨人工智能对教育的深远影响...",
      "coverUrl": "https://example.com/cover.jpg",
      "author": "李四",
      "readTimeMinutes": 8,
      "channelId": "C1000001",
      "channelName": "科技前沿",
      "highlights": [
        {
          "highlightId": "EH1000001",
          "text": "AI 将从根本上改变软件开发的范式",
          "color": "#FFD700",
          "note": "核心论点",
          "sortOrder": 0,
          "contextBefore": "在过去的十年里，有研究者指出，",
          "contextAfter": "。这一判断已在多个领域得到印证，尤其是代码生成和文档撰写。"
        }
      ]
    },
    "reason": "根据您的阅读偏好推荐",
    "lattice": {
      "collectionId": "SC1000001",
      "collectionName": "思维方式精选",
      "description": "帮你建立更清晰的思考框架",
      "coverUrl": "https://example.com/collection-cover.jpg",
      "recommendation": "这个合集会让你重新审视自己的思维方式",
      "articles": [
        {
          "articleId": "A1000010",
          "title": "第一性原理思考法",
          "summary": "从基本假设出发，重构解决方案",
          "coverUrl": "https://example.com/cover2.jpg",
          "author": "王五",
          "publishedAt": "2026-03-10T10:00:00.000Z"
        }
      ]
    }
  }
}
```

**字段说明：**

| 字段 | 类型 | 说明 |
|------|------|------|
| `date` | string | 当日日期（YYYY-MM-DD） |
| `article` | object \| null | 推荐文章，无精选时为 `null` |
| `article.readTimeMinutes` | number | 预估阅读时长（分钟），基于正文字数计算 |
| `article.highlights` | array | 编辑标注的高亮列表，无高亮时为 `[]` |
| `highlights[].text` | string | 高亮文本内容 |
| `highlights[].color` | string | 高亮颜色（十六进制） |
| `highlights[].note` | string | 编辑备注 |
| `highlights[].sortOrder` | number | 排序序号 |
| `highlights[].contextBefore` | string | 高亮文字前的原文片段，由管理员手动填写，未填时为空字符串 |
| `highlights[].contextAfter` | string | 高亮文字后的原文片段，由管理员手动填写，未填时为空字符串 |
| `reason` | string | 管理员填写的推荐语，未填写时为空字符串 |
| `lattice` | object \| null | 思维格栅模块，未配置或已禁用时为 `null` |
| `lattice.collectionId` | string | 合集 ID |
| `lattice.collectionName` | string | 合集名称 |
| `lattice.description` | string | 合集描述 |
| `lattice.coverUrl` | string | 合集封面图 URL |
| `lattice.recommendation` | string | 管理员填写的一句话推荐，未填时为空字符串 |
| `lattice.articles` | array | 合集下的全部资源文章列表 |

**`article` 为 `null` 时，`reason` 为固定说明：**

| `reason` | 说明 |
|----------|------|
| `您还没有加入任何空间` | 用户未加入任何空间 |
| `暂无精选文章` | 空间精选池为空 |
| `文章不存在` | 精选文章已被删除 |

**轮换规则：**
- 基于日期索引 + 空间 ID 哈希选取精选池中的文章
- 同一天内多次请求返回相同结果
- 取用户所在的第一个空间

> `contextBefore` 和 `contextAfter` 由管理员在后台手动填写，客户端可直接拼接展示「前文 + **高亮** + 后文」的效果。

---

## 批量同步

### POST /api/v1/dr/sync

批量同步客户端数据到服务器。需要用户 JWT。

**请求体：**
```json
{
  "client_sync_id": "uuid-xxx",
  "last_sync_at": "2026-03-25T09:00:00.000Z",
  "payload": {
    "highlights": [
      {
        "local_id": "uuid-1",
        "action": "create",
        "data": {
          "article_id": "A1000001",
          "text": "高亮文字",
          "color": "#FFEB3B",
          "position_data": { "paragraph": 1, "offset": 10 },
          "note": "批注内容"
        }
      },
      {
        "local_id": "uuid-2",
        "action": "delete",
        "remote_id": "H1000001"
      }
    ],
    "bookmarks": [
      {
        "local_id": "uuid-3",
        "action": "create",
        "data": { "article_id": "A1000001", "bookmarked": true }
      }
    ],
    "read_progress": [
      {
        "local_id": "uuid-4",
        "action": "update",
        "data": { "article_id": "A1000001", "progress": 75 }
      }
    ],
    "reading_stats": [
      {
        "local_id": "uuid-5",
        "action": "create",
        "data": {
          "article_id": "A1000001",
          "reading_time_seconds": 180,
          "scroll_depth": 85,
          "session_start": "2026-03-25T10:00:00.000Z",
          "session_end": "2026-03-25T10:03:00.000Z"
        }
      }
    ]
  }
}
```

**响应示例：**
```json
{
  "code": 200,
  "message": "同步成功",
  "data": {
    "server_sync_id": "sync-1742908800000",
    "synced_at": "2026-03-25T10:30:00.000Z",
    "results": {
      "highlights": [
        { "local_id": "uuid-1", "remote_id": "H1000002", "status": "success" }
      ],
      "bookmarks": [
        { "local_id": "uuid-3", "status": "success" }
      ],
      "read_progress": [
        { "local_id": "uuid-4", "status": "success" }
      ],
      "reading_stats": [
        { "local_id": "uuid-5", "status": "success" }
      ]
    },
    "server_changes": {
      "highlights": [],
      "bookmarks": [],
      "articles": []
    }
  }
}
```

---

### GET /api/v1/dr/sync/changes

获取自上次同步以来的服务端数据变化。需要用户 JWT。

**查询参数：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `last_sync_at` | string | 是 | 上次同步时间 |
| `entity_types` | string | 否 | 实体类型，逗号分隔，默认全部 |

**响应示例：**
```json
{
  "code": 200,
  "message": "success",
  "data": {
    "synced_at": "2026-03-25T10:30:00.000Z",
    "changes": {
      "highlights": {
        "created": [],
        "updated": [
          {
            "highlightId": "H1000001",
            "articleId": "A1000001",
            "text": "更新后的文字",
            "color": "#FF5722",
            "note": "更新后的笔记",
            "updatedAt": "2026-03-25T10:00:00.000Z"
          }
        ],
        "deleted": []
      },
      "bookmarks": {
        "created": [],
        "updated": [],
        "deleted": []
      }
    }
  }
}
```
