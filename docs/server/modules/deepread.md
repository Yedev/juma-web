# DeepRead 平台功能文档

DeepRead 是 juma-web 内嵌的深度阅读平台，提供空间化内容管理、文章阅读、批注、合集和 AI 问答功能。

---

## 1. 功能概述

DeepRead 的核心概念层次结构：

```
Space（阅读空间）
  ├── Channel（频道/栏目）
  │     └── Article（文章）
  └── SpaceMember（成员）

User（用户）
  ├── Bookmark（收藏）       → 关联 Article
  ├── ReadStatus（阅读进度） → 关联 Article
  ├── Highlight（批注）      → 关联 Article
  └── Collection（合集）     → 关联多个 Article
```

用户通过邀请码加入空间，成为成员后可以浏览该空间下的所有文章，并进行个人化的阅读管理（收藏、进度、批注、合集）。

---

## 2. 认证方案

DeepRead 采用双层认证：

### 外层：x-sign 签名（所有接口）

所有 `/api/v1/dr/*` 接口都需要 x-sign 签名，由 `signMiddleware` 负责验证。这一层防止接口被未授权的客户端调用。

签名计算：`MD5(APP_SECRET + x-timestamp)`，时间窗口 ±5 分钟。

### 内层：DR JWT（需登录的接口）

`/api/v1/dr/sms/send` 和 `/api/v1/dr/login` 仅需 x-sign。

其余所有接口还需要在 Authorization 头携带 DR JWT：
```
Authorization: Bearer eyJ...
```

- **签发时机**：`/api/v1/dr/login` 成功后
- **有效期**：30 天（硬编码，见 `middleware/drAuth.ts`）
- **密钥**：`DR_JWT_SECRET`（默认 `deepread_jwt_secret_2026`）
- **Payload**：`{ userId: number, phone: string }`

### 与管理员认证的对比

| 特性 | 管理员（auth.ts） | DeepRead（drAuth.ts） |
|------|-----------------|----------------------|
| 登录方式 | 用户名 + bcrypt 密码 | 手机号 + SMS 验证码 |
| Token 有效期 | 24 小时 | 30 天 |
| 密钥变量 | `JWT_SECRET` | `DR_JWT_SECRET` |
| 外层防护 | 无 | x-sign 签名 |
| 请求属性 | `req.userId`, `req.username` | `req.drUserId`, `req.drPhone` |

---

## 3. SMS 验证码模块

### 开发模式说明

当前实现为开发模式：验证码固定为 `888888`，不会真正发送短信，且响应中直接返回验证码明文。

**生产化改造需要**：
1. 集成真实短信服务（如阿里云 SMS、腾讯云 SMS）
2. 生成随机 6 位数字验证码
3. 从响应中移除 `data.code` 字段
4. 实现防刷机制（同一手机号限流）

### 验证码存储

```
DrSmsCode {
  phone, code, expiresAt(5分钟后), used(默认false)
}
```

登录验证时查询条件：
- `phone` 匹配
- `code` 匹配
- `used = false`
- `expiresAt >= now`
- 按 `createdAt DESC` 取最新的

验证成功后：`used = true`（一次性使用）

---

## 4. 用户系统

### 自动注册

DeepRead 没有单独的注册接口。首次使用手机号登录时，如果该手机号不存在对应用户记录，系统自动创建：

```typescript
user = await prisma.drUser.create({
  data: {
    phone,
    nickname: `用户${phone.slice(-4)}`   // 例如：用户8000
  }
});
```

用户创建后可修改昵称和头像（通过后续接口，当前版本未实现更新接口）。

### 种子数据

测试账号：手机号 `13800138000`，昵称 `测试用户`，已是 `DeepRead 精选` 空间的管理员成员。

---

## 5. 空间与成员系统

### 空间模型

| 字段 | 说明 |
|------|------|
| `spaceId` | 唯一 ID（格式：S + 时间戳 + 随机数） |
| `name` | 空间名称 |
| `description` | 空间描述 |
| `inviteCode` | 历史固定邀请码（全局唯一） |

### 动态邀请码（DrInviteCode）

与 `DrSpace.inviteCode` 不同，`DrInviteCode` 是可管理的动态邀请码：

| 字段 | 说明 |
|------|------|
| `codeId` | 唯一 ID |
| `spaceId` | 关联空间 |
| `code` | 邀请码字符串（6位，字符集：ABCDEFGHJKLMNPQRSTUVWXYZ23456789） |
| `label` | 备注标签 |
| `maxUses` | 最大使用次数（null=无限制） |
| `useCount` | 已使用次数 |
| `expiresAt` | 过期时间（null=永不过期） |
| `disabled` | 是否禁用 |

### 加入空间流程（POST /api/v1/dr/space/join）

```
1. 根据 invite_code 查询 DrInviteCode（精确匹配）
2. 检查邀请码状态：
   a. 不存在或 disabled=true → 404 邀请码无效
   b. expiresAt < now → 400 邀请码已过期
   c. useCount >= maxUses（且 maxUses != null）→ 400 使用次数达上限
3. 检查空间是否存在
4. 检查用户是否已是成员
5. 如果不是成员：
   a. 事务：createMember + useCount+1（原子操作）
6. 返回空间信息
```

### 成员角色

| 角色 | 说明 |
|------|------|
| `admin` | 管理员（种子数据默认） |
| `member` | 普通成员（通过邀请码加入） |

当前版本角色仅存储，不做权限区分（所有成员权限相同）。

---

## 6. 文章系统

### 文章数据结构

| 字段 | 类型 | 说明 |
|------|------|------|
| `articleId` | string | 唯一 ID（格式：A + 时间戳 + 随机数） |
| `spaceId` | string | 所属空间 |
| `channelId` | string | 所属频道 |
| `title` | string | 文章标题 |
| `summary` | string | 摘要 |
| `coverUrl` | string | 封面图 URL |
| `layoutType` | string | 布局类型（默认 "default"） |
| `content` | string | HTML 或 Markdown 格式的文章正文 |
| `author` | string | 作者名称 |
| `readCount` | number | 总阅读次数（自动递增） |
| `publishedAt` | DateTime | 发布时间 |

### 文章列表接口的性能优化

`GET /api/v1/dr/articles` 使用批量查询避免 N+1：

```typescript
// 一次查询获取所有文章的书签状态
const bookmarks = await prisma.drBookmark.findMany({
  where: { userId, articleId: { in: articleIds } }
});

// 一次查询获取所有文章的阅读进度
const readStatuses = await prisma.drReadStatus.findMany({
  where: { userId, articleId: { in: articleIds } }
});

// 转换为 Set/Map 后 O(1) 查找
const bookmarkSet = new Set(bookmarks.map(b => b.articleId));
const readMap = new Map(readStatuses.map(r => [r.articleId, r.progress]));
```

### 阅读进度

通过 `PUT /api/v1/dr/articles/:articleId/read` 更新：

```json
{ "progress": 75 }
```

`progress` 范围 0–100，表示阅读百分比。缺省时默认为 100（标记为已读）。

使用 upsert 操作，确保每个用户对每篇文章只有一条进度记录。

---

## 7. 批注系统

批注（Highlight）支持用户在文章中标记任意文本段落，并添加颜色、位置信息和笔记。

### 批注数据结构

| 字段 | 类型 | 说明 |
|------|------|------|
| `highlightId` | string | 唯一 ID（格式：H + 时间戳 + 随机数） |
| `userId` | number | 创建者用户 ID |
| `articleId` | string | 关联文章 |
| `text` | string | 被标记的文本内容 |
| `color` | string | 标记颜色（默认 `#FFEB3B` 黄色） |
| `positionData` | string | JSON 格式的位置信息（由客户端定义结构） |
| `note` | string | 用户笔记（可为空） |

### positionData 结构

`positionData` 是客户端自定义的 JSON 对象，服务端仅负责存储和原样返回，不做结构验证。建议客户端使用如下结构：

```json
{
  "startOffset": 120,
  "endOffset": 165,
  "paragraphIndex": 3,
  "nodeSelector": "#content > p:nth-child(4)"
}
```

### 权限控制

- 更新批注（PUT）：只有批注的创建者（`existing.userId === req.drUserId`）可以修改，否则返回 403
- 删除批注（DELETE）：同上
- 查询批注（GET）：只返回当前用户自己的批注（`where: { userId: req.drUserId! }`）

---

## 8. 合集系统

合集（Collection）是用户自定义的文章分组，类似"书单"或"收藏夹"。

### 主要操作

**创建合集**：
```json
POST /api/v1/dr/collections
{ "name": "AI 前沿合集" }
```

**向合集添加/移除文章**：
```json
PUT /api/v1/dr/collections/{collectionId}/articles
{ "article_id": "A1000001", "action": "add" }
```

**获取合集列表**（含每个合集的文章数）：
```json
GET /api/v1/dr/collections
→ [{ "collectionId": "C...", "name": "AI 前沿合集", "articleCount": 3, ... }]
```

`articleCount` 通过 `groupBy` 查询一次性获取所有合集的文章数，避免 N+1。

### 权限控制

合集属于用户私有，只有合集的创建者（`collection.userId === req.drUserId`）可以向其中添加或移除文章。

- 文章内容限制 8000 字符

---

## 10. 管理员对 DeepRead 的管理接口

管理员通过 `/api/admin/dr/*` 系列接口管理 DeepRead 的内容。

| 功能 | 接口 |
|------|------|
| 空间管理（CRUD） | `/api/admin/dr/spaces` |
| 成员列表查看 | `/api/admin/dr/spaces/:spaceId/members` |
| 邀请码管理 | `/api/admin/dr/spaces/:spaceId/invite-codes` |
| 频道管理（CRUD） | `/api/admin/dr/channels` |
| 文章管理（CRUD） | `/api/admin/dr/articles` |

管理员可以：
- 创建空间（邀请码自动生成）
- 为空间创建限次/限时的动态邀请码
- 管理频道和文章内容
- 删除空间时级联删除成员、频道、文章（但不删除用户的书签、批注、合集）

---

## 11. 完整接口一览表

| 方法 | 路径 | 中间件 | 说明 |
|------|------|--------|------|
| POST | `/api/v1/dr/sms/send` | sign | 发送验证码 |
| POST | `/api/v1/dr/login` | sign | 手机号登录 |
| POST | `/api/v1/dr/space/join` | sign + drAuth | 通过邀请码加入空间 |
| GET | `/api/v1/dr/articles` | sign + drAuth | 获取文章列表 |
| GET | `/api/v1/dr/articles/:articleId` | sign + drAuth | 获取文章详情 |
| PUT | `/api/v1/dr/articles/:articleId/bookmark` | sign + drAuth | 收藏/取消收藏 |
| PUT | `/api/v1/dr/articles/:articleId/read` | sign + drAuth | 更新阅读进度 |
| POST | `/api/v1/dr/highlights` | sign + drAuth | 创建批注 |
| PUT | `/api/v1/dr/highlights/:highlightId` | sign + drAuth | 更新批注 |
| DELETE | `/api/v1/dr/highlights/:highlightId` | sign + drAuth | 删除批注 |
| GET | `/api/v1/dr/highlights` | sign + drAuth | 获取文章批注列表 |
| POST | `/api/v1/dr/collections` | sign + drAuth | 创建合集 |
| PUT | `/api/v1/dr/collections/:collectionId/articles` | sign + drAuth | 添加/移除合集文章 |
| GET | `/api/v1/dr/collections` | sign + drAuth | 获取合集列表 |
| GET | `/api/v1/dr/spaces/:spaceId/collections/:collectionId/articles` | sign + drAuth | 获取空间合集文章列表 |
| GET | `/api/v1/dr/spaces/:spaceId/homepage` | sign + drAuth | 获取空间首页模块 |
| GET | `/api/v1/dr/spaces/:spaceId/daily-picks` | sign + drAuth | 获取每日精选文章 |
| POST | `/api/v1/dr/reading-stats` | sign + drAuth | 上报单条阅读统计 |
| POST | `/api/v1/dr/reading-stats/batch` | sign + drAuth | 批量上报阅读统计 |
| GET | `/api/v1/dr/stats/summary` | sign + drAuth | 获取阅读统计汇总 |
| GET | `/api/v1/dr/bookmarks` | sign + drAuth | 获取收藏列表 |
| GET | `/api/v1/dr/daily-article` | sign + drAuth | 获取每日推荐文章 |
| POST | `/api/v1/dr/sync` | sign + drAuth | 批量同步 |
| GET | `/api/v1/dr/sync/changes` | sign + drAuth | 增量获取同步变化 |
