# DeepRead 后端 API 实现计划

## 架构决策

### 路由命名空间
- DeepRead 客户端 API：`/api/v1/dr/*`（复用现有 sign 中间件鉴权，与现有 `/api/v1/app/*` 并行）
- DeepRead 管理后台 API：`/api/admin/dr/*`（复用现有 JWT admin 鉴权）
- 新增用户 token 鉴权中间件 `drAuth`，用于需要登录的 DeepRead 接口

### 鉴权方案
- 外层：sign 中间件（MD5 签名，防篡改/防重放，所有 `/api/v1/dr/*` 请求都校验）
- 内层：`drAuth` 中间件（JWT Bearer token，`POST /sms/send` 和 `POST /login` 不需要，其余接口需要）
- 用户 JWT payload：`{ userId, phone }`，有效期 30 天

### 数据库
- 扩展现有 Prisma schema，新增 DeepRead 相关表
- 继续使用 SQLite（与现有系统一致）

---

## Phase 1：数据库 Schema 设计

在 `server/prisma/schema.prisma` 新增以下模型：

```prisma
model DrUser {
  id        Int      @id @default(autoincrement())
  phone     String   @unique
  nickname  String   @default("")
  avatar    String   @default("")
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @default(now()) @updatedAt @map("updated_at")
  @@map("dr_users")
}

model DrSmsCode {
  id        Int      @id @default(autoincrement())
  phone     String
  code      String
  expiresAt DateTime @map("expires_at")
  used      Boolean  @default(false)
  createdAt DateTime @default(now()) @map("created_at")
  @@map("dr_sms_codes")
}

model DrSpace {
  id           Int      @id @default(autoincrement())
  spaceId      String   @unique @map("space_id")
  name         String
  description  String   @default("")
  inviteCode   String   @unique @map("invite_code")
  createdAt    DateTime @default(now()) @map("created_at")
  updatedAt    DateTime @default(now()) @updatedAt @map("updated_at")
  @@map("dr_spaces")
}

model DrSpaceMember {
  id        Int      @id @default(autoincrement())
  spaceId   String   @map("space_id")
  userId    Int      @map("user_id")
  role      String   @default("member")
  joinedAt  DateTime @default(now()) @map("joined_at")
  @@unique([spaceId, userId])
  @@map("dr_space_members")
}

model DrChannel {
  id        Int      @id @default(autoincrement())
  channelId String   @unique @map("channel_id")
  spaceId   String   @map("space_id")
  name      String
  sortOrder Int      @default(0) @map("sort_order")
  createdAt DateTime @default(now()) @map("created_at")
  @@map("dr_channels")
}

model DrArticle {
  id          Int      @id @default(autoincrement())
  articleId   String   @unique @map("article_id")
  spaceId     String   @map("space_id")
  channelId   String   @map("channel_id")
  title       String
  summary     String   @default("")
  coverUrl    String   @default("") @map("cover_url")
  layoutType  String   @default("default") @map("layout_type")
  contentHtml String   @default("") @map("content_html")
  author      String   @default("")
  readCount   Int      @default(0) @map("read_count")
  publishedAt DateTime @default(now()) @map("published_at")
  createdAt   DateTime @default(now()) @map("created_at")
  updatedAt   DateTime @default(now()) @updatedAt @map("updated_at")
  @@map("dr_articles")
}

model DrBookmark {
  id        Int      @id @default(autoincrement())
  userId    Int      @map("user_id")
  articleId String   @map("article_id")
  createdAt DateTime @default(now()) @map("created_at")
  @@unique([userId, articleId])
  @@map("dr_bookmarks")
}

model DrReadStatus {
  id        Int      @id @default(autoincrement())
  userId    Int      @map("user_id")
  articleId String   @map("article_id")
  progress  Int      @default(0)
  readAt    DateTime @default(now()) @map("read_at")
  @@unique([userId, articleId])
  @@map("dr_read_status")
}

model DrHighlight {
  id           Int      @id @default(autoincrement())
  highlightId  String   @unique @map("highlight_id")
  userId       Int      @map("user_id")
  articleId    String   @map("article_id")
  text         String
  color        String   @default("#FFEB3B")
  positionData String   @default("{}") @map("position_data")
  note         String   @default("")
  createdAt    DateTime @default(now()) @map("created_at")
  updatedAt    DateTime @default(now()) @updatedAt @map("updated_at")
  @@map("dr_highlights")
}

model DrCollection {
  id           Int      @id @default(autoincrement())
  collectionId String   @unique @map("collection_id")
  userId       Int      @map("user_id")
  name         String
  createdAt    DateTime @default(now()) @map("created_at")
  updatedAt    DateTime @default(now()) @updatedAt @map("updated_at")
  @@map("dr_collections")
}

model DrCollectionArticle {
  id           Int      @id @default(autoincrement())
  collectionId String   @map("collection_id")
  articleId    String   @map("article_id")
  addedAt      DateTime @default(now()) @map("added_at")
  @@unique([collectionId, articleId])
  @@map("dr_collection_articles")
}
```

**操作**：
1. 编辑 `server/prisma/schema.prisma` 追加上述模型
2. 运行 `npx prisma db push` 同步
3. 运行 `npx prisma generate` 生成 client

---

## Phase 2：用户认证接口

新建文件 `server/src/middleware/drAuth.ts`：
- 解析 `Authorization: Bearer <token>`
- 验证 JWT，提取 `userId` / `phone`
- 挂载到 `req.drUserId` / `req.drPhone`

新建文件 `server/src/routes/deepread.ts`：
- 挂载到 `/api/v1/dr`，外层统一使用 `signMiddleware`

### 接口清单

#### 2.1 发送短信验证码
```
POST /api/v1/dr/sms/send
Body: { phone: "13800138000" }
```
- 校验手机号格式（11位数字）
- 生成6位随机验证码，存入 `DrSmsCode`（5分钟有效）
- 开发阶段：不真实发送短信，直接返回验证码（或固定 `888888`）
- 生产阶段：预留短信服务商接口调用位置

#### 2.2 验证码登录
```
POST /api/v1/dr/login
Body: { phone: "13800138000", code: "888888" }
```
- 查询 `DrSmsCode` 中最新未使用且未过期的记录
- 验证通过后标记 `used = true`
- 查找或创建 `DrUser`（首次登录自动注册）
- 返回 JWT token + 用户信息

#### 2.3 加入空间
```
POST /api/v1/dr/space/join   [需要 drAuth]
Body: { invite_code: "ABC123" }
```
- 根据邀请码查找空间
- 创建 `DrSpaceMember` 记录（已加入则忽略）
- 返回空间信息

---

## Phase 3：内容接口

所有接口需要 `drAuth`。

#### 3.1 获取文章列表
```
GET /api/v1/dr/articles?space_id=xxx&channel_id=xxx&page=1&page_size=20
```
- 校验用户是否为该空间成员
- 按 `publishedAt` 降序分页
- 返回列表（不含 `contentHtml`），附带收藏/已读状态

#### 3.2 获取文章详情
```
GET /api/v1/dr/articles/:articleId
```
- 校验空间成员权限
- 返回完整文章（含 `contentHtml`）
- 阅读数 +1

#### 3.3 收藏/取消收藏
```
PUT /api/v1/dr/articles/:articleId/bookmark
Body: { bookmarked: true }
```
- `true` → upsert DrBookmark
- `false` → delete DrBookmark

#### 3.4 标记已读
```
PUT /api/v1/dr/articles/:articleId/read
Body: { progress: 100 }
```
- upsert `DrReadStatus`

---

## Phase 4：批注接口

所有接口需要 `drAuth`。

#### 4.1 创建高亮/批注
```
POST /api/v1/dr/highlights
Body: { article_id, text, color, position_data: {...}, note }
```
- 生成唯一 `highlightId`（`H` + 时间戳 + 随机数）
- 存入 `DrHighlight`

#### 4.2 更新批注
```
PUT /api/v1/dr/highlights/:highlightId
Body: { color?, note? }
```
- 仅允许修改自己的批注

#### 4.3 删除批注
```
DELETE /api/v1/dr/highlights/:highlightId
```
- 仅允许删除自己的批注

#### 4.4 获取文章批注列表
```
GET /api/v1/dr/highlights?article_id=xxx
```
- 返回当前用户在该文章的所有高亮/批注

---

## Phase 5：合集接口

所有接口需要 `drAuth`。

#### 5.1 创建合集
```
POST /api/v1/dr/collections
Body: { name: "我的收藏夹" }
```
- 生成唯一 `collectionId`

#### 5.2 合集添加/移除文章
```
PUT /api/v1/dr/collections/:collectionId/articles
Body: { article_id: "xxx", action: "add" | "remove" }
```
- 仅允许操作自己的合集

#### 5.3 获取合集列表
```
GET /api/v1/dr/collections
```
- 返回当前用户的所有合集，附带文章数量

---

## Phase 6：AI 对话接口（Gemini）

#### 6.1 AI 对话
```
POST /api/v1/dr/ai/chat   [需要 drAuth]
Body: { article_id: "xxx", message: "这篇文章的核心观点是什么？" }
```
- 从数据库取出文章 `contentHtml`，剥离 HTML 标签提取纯文本
- 构造 system prompt：你是 DeepRead 阅读助手，基于以下文章内容回答用户问题
- 调用 Google Gemini API（`@google/genai`）
- 流式返回 → 本期先做非流式，返回完整回复

**依赖**：
- 安装 `@google/genai`
- 环境变量：`GEMINI_API_KEY`

---

## Phase 7：管理后台 API

在 `server/src/routes/admin.ts` 中新增 DeepRead 管理路由（复用现有 JWT authMiddleware）：

### 空间管理
- `GET /api/admin/dr/spaces` — 空间列表（含成员数、文章数、频道数统计）
- `POST /api/admin/dr/spaces` — 创建空间（自动生成 spaceId + 6位随机 inviteCode）
- `PUT /api/admin/dr/spaces/:spaceId` — 编辑空间（名称、描述）
- `DELETE /api/admin/dr/spaces/:spaceId` — 删除空间
- `GET /api/admin/dr/spaces/:spaceId/members` — 空间成员列表

### 频道管理
- `GET /api/admin/dr/channels?space_id=xxx` — 频道列表（含文章数统计）
- `POST /api/admin/dr/channels` — 创建频道（指定所属空间）
- `PUT /api/admin/dr/channels/:channelId` — 编辑频道（名称、排序）
- `DELETE /api/admin/dr/channels/:channelId` — 删除频道

### 文章管理
- `GET /api/admin/dr/articles?space_id=xxx&channel_id=xxx&page=1&page_size=20` — 文章列表（分页，含阅读数/收藏数统计）
- `POST /api/admin/dr/articles` — 创建文章（标题、摘要、封面、正文HTML、所属空间+频道、作者、布局类型）
- `PUT /api/admin/dr/articles/:articleId` — 编辑文章
- `DELETE /api/admin/dr/articles/:articleId` — 删除文章

### 用户管理
- `GET /api/admin/dr/users?page=1&page_size=20` — 用户列表（分页，含加入空间数、批注数统计）
- `GET /api/admin/dr/users/:userId` — 用户详情（含加入的空间列表）

---

## Phase 8：管理后台 UI 页面

遵循现有 admin-ui 模式：React + Ant Design + 内联样式 + adminClient API 调用。

### 8.1 路由与导航变更

**修改 `admin-ui/src/App.tsx`**，新增路由：
```tsx
<Route path="dr/spaces" element={<DrSpaceManagement />} />
<Route path="dr/channels" element={<DrChannelManagement />} />
<Route path="dr/articles" element={<DrArticleManagement />} />
<Route path="dr/users" element={<DrUserManagement />} />
```

**修改 `admin-ui/src/layouts/AdminLayout.tsx`**，在 menuItems 中添加 DeepRead 分组：
```tsx
// 分隔线（视觉上区分 JUMA 与 DeepRead）
{ type: "divider", label: "DeepRead" },
{ key: "/dr/spaces", icon: <AppstoreOutlined />, label: "空间管理" },
{ key: "/dr/channels", icon: <BranchesOutlined />, label: "频道管理" },
{ key: "/dr/articles", icon: <ReadOutlined />, label: "文章管理" },
{ key: "/dr/users", icon: <TeamOutlined />, label: "用户管理" },
```

同步更新 `pageTitle` 映射。

### 8.2 空间管理页面

**新建 `admin-ui/src/pages/DrSpaceManagement.tsx`**

布局：顶部操作栏 + Ant Design Table

| 功能 | 说明 |
|------|------|
| 空间列表 | Table 展示：空间名称、spaceId、邀请码（可复制）、成员数、频道数、文章数、创建时间 |
| 新建空间 | Modal 表单：空间名称（必填）、描述（选填） |
| 编辑空间 | Modal 表单：修改名称和描述 |
| 删除空间 | Modal.confirm 二次确认 |
| 查看成员 | 点击展开或弹窗，展示成员手机号、昵称、角色、加入时间 |

### 8.3 频道管理页面

**新建 `admin-ui/src/pages/DrChannelManagement.tsx`**

布局：顶部空间选择器（Select）+ 操作栏 + Table

| 功能 | 说明 |
|------|------|
| 空间筛选 | 顶部 Select 组件，加载所有空间列表，切换后刷新频道列表 |
| 频道列表 | Table：频道名称、channelId、所属空间、文章数、排序值、创建时间 |
| 新建频道 | Modal 表单：频道名称（必填）、所属空间（Select，必填）、排序值（InputNumber） |
| 编辑频道 | Modal 表单：修改名称和排序 |
| 删除频道 | Modal.confirm 二次确认 |

### 8.4 文章管理页面

**新建 `admin-ui/src/pages/DrArticleManagement.tsx`**

布局：顶部筛选区（空间 + 频道联动选择器）+ 操作栏 + Table，创建/编辑用抽屉（Drawer）

| 功能 | 说明 |
|------|------|
| 筛选 | 空间 Select → 联动加载频道 Select，支持分页 |
| 文章列表 | Table：标题、作者、频道、布局类型、阅读数、发布时间、操作列 |
| 新建文章 | Drawer（宽度 720px）：标题、摘要、作者、封面URL、空间+频道选择、布局类型（Select: default/card/wide）、正文编辑（Monaco Editor，language=html） |
| 编辑文章 | 同新建 Drawer，预填充数据 |
| 删除文章 | Modal.confirm 二次确认 |
| 预览正文 | 弹窗中用 `dangerouslySetInnerHTML` 渲染 HTML 正文 |

### 8.5 用户管理页面

**新建 `admin-ui/src/pages/DrUserManagement.tsx`**

布局：Table + 分页

| 功能 | 说明 |
|------|------|
| 用户列表 | Table：用户ID、手机号、昵称、头像、加入空间数、批注数、注册时间 |
| 查看详情 | 点击展开，显示用户加入的空间列表（空间名称 + 角色 + 加入时间） |
| 分页 | 20条/页 |

> 注：用户管理为只读页面，不提供编辑/删除功能（用户通过手机端自行注册）。

---

## Phase 9：种子数据

更新 `server/src/prisma/seed.ts`，插入：
- 1 个示例空间（邀请码 `DEEP2026`）
- 2 个频道（如"科技前沿"、"深度评论"）
- 3-5 篇示例文章（含 HTML 正文）
- 1 个测试用户（手机号 `13800138000`）

---

## Phase 10：路由注册与集成

1. 在 `server/src/index.ts` 中注册新路由：
   ```typescript
   import deepreadRoutes from "./routes/deepread";
   app.use("/api/v1/dr", deepreadRoutes);
   ```

2. 更新 README.md 补充 DeepRead API 文档与管理页面说明

---

## 文件变更清单

| 操作 | 文件路径 | 说明 |
|------|----------|------|
| 修改 | `server/prisma/schema.prisma` | 新增 12 个 DR 表 |
| 新建 | `server/src/middleware/drAuth.ts` | DeepRead 用户 JWT 鉴权 |
| 新建 | `server/src/routes/deepread.ts` | 客户端 API 路由 |
| 新建 | `server/src/services/deepread/smsService.ts` | 短信验证码服务 |
| 新建 | `server/src/services/deepread/aiService.ts` | Gemini AI 对话服务 |
| 修改 | `server/src/routes/admin.ts` | 追加 DR 管理 API 路由 |
| 修改 | `server/src/index.ts` | 注册 deepread 路由 |
| 修改 | `server/src/prisma/seed.ts` | 追加 DR 种子数据 |
| 修改 | `server/package.json` | 追加 @google/genai 依赖 |
| 新建 | `admin-ui/src/pages/DrSpaceManagement.tsx` | 空间管理页面 |
| 新建 | `admin-ui/src/pages/DrChannelManagement.tsx` | 频道管理页面 |
| 新建 | `admin-ui/src/pages/DrArticleManagement.tsx` | 文章管理页面 |
| 新建 | `admin-ui/src/pages/DrUserManagement.tsx` | 用户管理页面 |
| 修改 | `admin-ui/src/App.tsx` | 新增 4 条 DR 页面路由 |
| 修改 | `admin-ui/src/layouts/AdminLayout.tsx` | 侧边栏添加 DR 菜单分组 |
| 修改 | `README.md` | 补充文档 |

## 实现顺序

1. Phase 1 → Schema + migrate
2. Phase 2 → 认证（最基础，后续都依赖）
3. Phase 3 → 内容（核心阅读功能）
4. Phase 4 → 批注（核心交互功能）
5. Phase 5 → 合集
6. Phase 6 → AI 对话
7. Phase 7 → 管理后台 API
8. Phase 8 → 管理后台 UI（空间/频道/文章/用户 4 个页面）
9. Phase 9 → 种子数据
10. Phase 10 → 集成 & 文档
