# 数据库模块文档

## 1. 技术栈概述

| 组件 | 版本 | 说明 |
|------|------|------|
| Prisma ORM | 6.19.2 | Schema 定义、Client 生成、迁移管理 |
| SQLite | 内置 | 文件型数据库，零部署成本 |
| DATABASE_URL | 环境变量 | 例如 `file:./dev.db` |

**特点**：
- SQLite 是单文件数据库，无需独立数据库服务进程
- Prisma 提供类型安全的查询 API，自动生成 TypeScript 类型
- Schema 变更通过 `prisma db push`（开发）或 `prisma migrate dev`（生产）同步

---

## 2. 数据模型详解

### 2.1 AdminUser（管理员用户）

**表名**：`admin_users`

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| `id` | Int | PK, 自增 | 内部 ID |
| `username` | String | 唯一 | 登录用户名 |
| `password` | String | — | bcryptjs 哈希（salt=10） |
| `createdAt` | DateTime | 默认 now() | 创建时间 |

**唯一约束**：`username`

**种子数据**：用户名 `juma`，密码 `juma2026`

---

### 2.2 AppConfig（应用配置）

**表名**：`app_configs`

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| `id` | Int | PK, 自增 | 内部 ID |
| `configKey` | String | 唯一 | 配置键名 |
| `configValue` | String | — | JSON 格式的配置值（字符串存储） |
| `updatedAt` | DateTime | 自动更新 | 最后更新时间 |

**唯一约束**：`configKey`

**种子数据**（键名 → 默认内容）：
- `global_json` → `{ version, theme, features }`
- `app_settings` → `{ language, timezone, maxRetries, timeout }`
- `ad_config` → `{ enabled, provider, interstitialId, bannerId, frequency }`

---

### 2.3 Task（任务）

**表名**：`tasks`

| 字段 | 类型 | 约束 | 默认值 | 说明 |
|------|------|------|--------|------|
| `id` | Int | PK, 自增 | — | 内部 ID |
| `taskId` | String | 唯一 | — | 业务 ID（格式：T + 毫秒时间戳 + 3位随机数） |
| `taskName` | String | — | — | 任务名（server.xxx / client.xxx） |
| `taskType` | String | — | `"server_task"` | 任务类型（server_task / client_task） |
| `targetClientId` | String? | 可为空 | null | 指定目标执行器客户端 ID |
| `claimedByClientId` | String? | 可为空 | null | 实际执行的客户端 ID（server-local 或客户端 ID） |
| `taskParams` | String | — | — | JSON：`{ task_payload, required_tags, execution_name }` |
| `status` | String | — | `"queued"` | 状态：queued / running / completed / error |
| `statusInfo` | String | — | `"{}"` | JSON 格式的状态附加信息 |
| `executionLog` | String | — | `""` | 执行日志（最大 64KB） |
| `resultCode` | Int? | 可为空 | null | 结果码（0=成功，-1=失败） |
| `claimedAt` | DateTime? | 可为空 | null | 任务被认领的时间 |
| `startedAt` | DateTime? | 可为空 | null | 任务开始执行的时间 |
| `finishedAt` | DateTime? | 可为空 | null | 任务完成/失败的时间 |
| `maxRetries` | Int | — | `0` | 最大重试次数（0–10） |
| `retryCount` | Int | — | `0` | 已重试次数 |
| `createdAt` | DateTime | 默认 now() | — | 创建时间 |
| `updatedAt` | DateTime | 自动更新 | — | 最后更新时间 |

**唯一约束**：`taskId`

**状态流转**：
```
queued → running → completed
                └→ error（重试 or 终止）
error/running → queued（重试时重置）
```

---

### 2.4 ExecutorClient（执行器客户端）

**表名**：`executor_clients`

| 字段 | 类型 | 约束 | 默认值 | 说明 |
|------|------|------|--------|------|
| `id` | Int | PK, 自增 | — | 内部 ID |
| `clientId` | String | 唯一 | — | 客户端自定义唯一 ID |
| `name` | String | — | — | 显示名称 |
| `platform` | String | — | `"darwin"` | 平台（darwin/linux/windows） |
| `appVersion` | String | — | `"unknown"` | 客户端应用版本 |
| `tags` | String | — | `"[]"` | JSON 数组格式的标签 |
| `capabilities` | String | — | `"{}"` | JSON 格式的能力描述（含 tasks 列表） |
| `status` | String | — | `"online"` | 在线状态：online / offline |
| `ip` | String? | 可为空 | null | 客户端 IP 地址 |
| `lastHeartbeat` | DateTime | 默认 now() | — | 最后心跳时间 |
| `tasksClaimed` | Int | — | `0` | 累计认领任务数 |
| `tasksSuccess` | Int | — | `0` | 累计成功任务数 |
| `tasksFailed` | Int | — | `0` | 累计失败任务数 |
| `createdAt` | DateTime | 默认 now() | — | 首次注册时间 |
| `updatedAt` | DateTime | 自动更新 | — | 最后更新时间 |

**唯一约束**：`clientId`

---

### 2.5 DrUser（DeepRead 用户）

**表名**：`dr_users`

| 字段 | 类型 | 约束 | 默认值 | 说明 |
|------|------|------|--------|------|
| `id` | Int | PK, 自增 | — | 内部 ID |
| `phone` | String | 唯一 | — | 手机号（11位，中国大陆格式） |
| `nickname` | String | — | `""` | 昵称（首次登录自动生成） |
| `avatar` | String | — | `""` | 头像 URL |
| `createdAt` | DateTime | 默认 now() | — | 注册时间 |
| `updatedAt` | DateTime | 自动更新 | — | 最后更新时间 |

**唯一约束**：`phone`

---

### 2.6 DrSmsCode（短信验证码）

**表名**：`dr_sms_codes`

| 字段 | 类型 | 约束 | 默认值 | 说明 |
|------|------|------|--------|------|
| `id` | Int | PK, 自增 | — | 内部 ID |
| `phone` | String | — | — | 手机号 |
| `code` | String | — | — | 验证码（开发模式固定 888888） |
| `expiresAt` | DateTime | — | — | 过期时间（发送后 5 分钟） |
| `used` | Boolean | — | `false` | 是否已使用 |
| `createdAt` | DateTime | 默认 now() | — | 发送时间 |

**无唯一约束**：同一手机号可以有多条记录，查询时按 `createdAt DESC` 取最新的未过期未使用记录。

---

### 2.7 DrSpace（阅读空间）

**表名**：`dr_spaces`

| 字段 | 类型 | 约束 | 默认值 | 说明 |
|------|------|------|--------|------|
| `id` | Int | PK, 自增 | — | 内部 ID |
| `spaceId` | String | 唯一 | — | 业务 ID（格式：S + 时间戳 + 随机数） |
| `name` | String | — | — | 空间名称 |
| `description` | String | — | `""` | 空间描述 |
| `inviteCode` | String | 唯一 | — | 固定邀请码（由管理员创建空间时生成） |
| `createdAt` | DateTime | 默认 now() | — | 创建时间 |
| `updatedAt` | DateTime | 自动更新 | — | 最后更新时间 |

**唯一约束**：`spaceId`，`inviteCode`

---

### 2.8 DrSpaceMember（空间成员）

**表名**：`dr_space_members`

| 字段 | 类型 | 约束 | 默认值 | 说明 |
|------|------|------|--------|------|
| `id` | Int | PK, 自增 | — | 内部 ID |
| `spaceId` | String | 联合唯一 | — | 空间 ID |
| `userId` | Int | 联合唯一 | — | 用户 ID（DrUser.id） |
| `role` | String | — | `"member"` | 角色：admin / member |
| `inviteCodeId` | String? | 可为空 | null | 使用的邀请码 ID（DrInviteCode.codeId） |
| `joinedAt` | DateTime | 默认 now() | — | 加入时间 |

**唯一约束**：`(spaceId, userId)` — 每个用户在同一空间只能有一条成员记录

---

### 2.9 DrInviteCode（动态邀请码）

**表名**：`dr_invite_codes`

| 字段 | 类型 | 约束 | 默认值 | 说明 |
|------|------|------|--------|------|
| `id` | Int | PK, 自增 | — | 内部 ID |
| `codeId` | String | 唯一 | — | 业务 ID（格式：IC + 时间戳 + 随机数） |
| `spaceId` | String | — | — | 所属空间 ID |
| `code` | String | 唯一 | — | 邀请码字符串（6位） |
| `label` | String | — | `""` | 管理备注 |
| `maxUses` | Int? | 可为空 | null | 最大使用次数（null=无限制） |
| `useCount` | Int | — | `0` | 已使用次数 |
| `expiresAt` | DateTime? | 可为空 | null | 过期时间（null=永不过期） |
| `disabled` | Boolean | — | `false` | 是否禁用 |
| `createdAt` | DateTime | 默认 now() | — | 创建时间 |
| `updatedAt` | DateTime | 自动更新 | — | 最后更新时间 |

**唯一约束**：`codeId`，`code`

---

### 2.10 DrChannel（频道）

**表名**：`dr_channels`

| 字段 | 类型 | 约束 | 默认值 | 说明 |
|------|------|------|--------|------|
| `id` | Int | PK, 自增 | — | 内部 ID |
| `channelId` | String | 唯一 | — | 业务 ID（格式：CH + 时间戳 + 随机数） |
| `spaceId` | String | — | — | 所属空间 ID |
| `name` | String | — | — | 频道名称 |
| `sortOrder` | Int | — | `0` | 排序权重（升序） |
| `createdAt` | DateTime | 默认 now() | — | 创建时间 |

**唯一约束**：`channelId`

---

### 2.11 DrArticle（文章）

**表名**：`dr_articles`

| 字段 | 类型 | 约束 | 默认值 | 说明 |
|------|------|------|--------|------|
| `id` | Int | PK, 自增 | — | 内部 ID |
| `articleId` | String | 唯一 | — | 业务 ID（格式：A + 时间戳 + 随机数） |
| `spaceId` | String | — | — | 所属空间 ID |
| `channelId` | String | — | — | 所属频道 ID |
| `title` | String | — | — | 文章标题 |
| `summary` | String | — | `""` | 摘要 |
| `coverUrl` | String | — | `""` | 封面图 URL |
| `layoutType` | String | — | `"default"` | 布局类型 |
| `content` | String | — | `""` | 正文内容 |
| `contentType` | String | — | `"html"` | 正文格式（html/markdown） |
| `author` | String | — | `""` | 作者名称 |
| `readCount` | Int | — | `0` | 累计阅读次数 |
| `publishedAt` | DateTime | 默认 now() | — | 发布时间 |
| `createdAt` | DateTime | 默认 now() | — | 创建时间 |
| `updatedAt` | DateTime | 自动更新 | — | 最后更新时间 |

**唯一约束**：`articleId`

---

### 2.12 DrSpaceHomepageModule（空间首页模块）

**表名**：`dr_space_homepage_modules`

| 字段 | 类型 | 约束 | 默认值 | 说明 |
|------|------|------|--------|------|
| `id` | Int | PK, 自增 | — | 内部 ID |
| `moduleId` | String | 唯一 | — | 业务 ID（格式：HM + 时间戳 + 随机数） |
| `spaceId` | String | — | — | 所属空间 ID |
| `title` | String | — | — | 模块标题 |
| `subtitle` | String | — | `""` | 副标题（小字说明） |
| `layoutType` | String | — | `"large_card"` | 资源排列方式，支持：`large_card`（大图卡）、`horizontal_card`（横向卡）、`vertical_card`（纵向卡）、`waterfall`（瀑布流） |
| `sortOrder` | Int | — | `0` | 排序权重（升序） |
| `createdAt` | DateTime | 默认 now() | — | 创建时间 |
| `updatedAt` | DateTime | 自动更新 | — | 最后更新时间 |

**唯一约束**：`moduleId`

---

### 2.13 DrSpaceHomepageModuleResource（首页模块资源绑定）

**表名**：`dr_space_homepage_module_resources`

| 字段 | 类型 | 约束 | 默认值 | 说明 |
|------|------|------|--------|------|
| `id` | Int | PK, 自增 | — | 内部 ID |
| `moduleId` | String | 联合唯一 | — | 所属模块 ID（DrSpaceHomepageModule.moduleId） |
| `resourceType` | String | — | — | 资源类型：`channel`（频道）或 `article`（文章） |
| `resourceId` | String | 联合唯一 | — | 资源 ID（channelId 或 articleId） |
| `sortOrder` | Int | — | `0` | 资源在模块内的排序权重（升序） |
| `createdAt` | DateTime | 默认 now() | — | 绑定时间 |

**唯一约束**：`(moduleId, resourceId)` — 同一资源不能重复绑定到同一模块

---

### 2.14 DrBookmark（收藏）

**表名**：`dr_bookmarks`

| 字段 | 类型 | 约束 | 默认值 | 说明 |
|------|------|------|--------|------|
| `id` | Int | PK, 自增 | — | 内部 ID |
| `userId` | Int | 联合唯一 | — | 用户 ID |
| `articleId` | String | 联合唯一 | — | 文章 ID |
| `createdAt` | DateTime | 默认 now() | — | 收藏时间 |

**唯一约束**：`(userId, articleId)` — 每个用户对同一文章只能收藏一次

---

### 2.16 DrReadStatus（阅读进度）

**表名**：`dr_read_status`

| 字段 | 类型 | 约束 | 默认值 | 说明 |
|------|------|------|--------|------|
| `id` | Int | PK, 自增 | — | 内部 ID |
| `userId` | Int | 联合唯一 | — | 用户 ID |
| `articleId` | String | 联合唯一 | — | 文章 ID |
| `progress` | Int | — | `0` | 阅读进度（0–100） |
| `readAt` | DateTime | 默认 now() | — | 最后阅读时间 |

**唯一约束**：`(userId, articleId)` — 每个用户对同一文章只有一条进度记录（upsert 更新）

---

### 2.17 DrHighlight（批注）

**表名**：`dr_highlights`

| 字段 | 类型 | 约束 | 默认值 | 说明 |
|------|------|------|--------|------|
| `id` | Int | PK, 自增 | — | 内部 ID |
| `highlightId` | String | 唯一 | — | 业务 ID（格式：H + 时间戳 + 随机数） |
| `userId` | Int | — | — | 创建者用户 ID |
| `articleId` | String | — | — | 关联文章 ID |
| `text` | String | — | — | 被标记的文本 |
| `color` | String | — | `"#FFEB3B"` | 标记颜色 |
| `positionData` | String | — | `"{}"` | JSON 格式位置信息 |
| `note` | String | — | `""` | 用户笔记 |
| `createdAt` | DateTime | 默认 now() | — | 创建时间 |
| `updatedAt` | DateTime | 自动更新 | — | 最后更新时间 |

**唯一约束**：`highlightId`

---

### 2.18 DrCollection（合集）

**表名**：`dr_collections`

| 字段 | 类型 | 约束 | 默认值 | 说明 |
|------|------|------|--------|------|
| `id` | Int | PK, 自增 | — | 内部 ID |
| `collectionId` | String | 唯一 | — | 业务 ID（格式：C + 时间戳 + 随机数） |
| `userId` | Int | — | — | 创建者用户 ID |
| `name` | String | — | — | 合集名称 |
| `createdAt` | DateTime | 默认 now() | — | 创建时间 |
| `updatedAt` | DateTime | 自动更新 | — | 最后更新时间 |

**唯一约束**：`collectionId`

---

### 2.19 DrCollectionArticle（合集文章关联）

**表名**：`dr_collection_articles`

| 字段 | 类型 | 约束 | 默认值 | 说明 |
|------|------|------|--------|------|
| `id` | Int | PK, 自增 | — | 内部 ID |
| `collectionId` | String | 联合唯一 | — | 合集 ID |
| `articleId` | String | 联合唯一 | — | 文章 ID |
| `addedAt` | DateTime | 默认 now() | — | 添加时间 |

**唯一约束**：`(collectionId, articleId)` — 同一文章不能重复加入同一合集

---

### 2.20 DrDailyPickArticle（每日精选文章）

**表名**：`dr_daily_pick_articles`

| 字段 | 类型 | 约束 | 默认值 | 说明 |
|------|------|------|--------|------|
| `id` | Int | PK, 自增 | — | 内部 ID |
| `pickId` | String | 唯一 | — | 业务 ID（格式：DP + 时间戳 + 随机数） |
| `spaceId` | String | 联合唯一 | — | 所属空间 ID |
| `articleId` | String | 联合唯一 | — | 关联文章 ID |
| `sortOrder` | Int | — | `0` | 在精选池中的排序权重（升序） |
| `enabled` | Boolean | — | `true` | 是否启用（禁用后不参与轮换） |
| `createdAt` | DateTime | 默认 now() | — | 创建时间 |
| `updatedAt` | DateTime | 自动更新 | — | 最后更新时间 |

**唯一约束**：`pickId`，`(spaceId, articleId)` — 同一文章不能重复加入同一空间的精选池

**轮换算法**：
```typescript
dayIndex = Math.floor(Date.now() / 86400000)  // 天数索引
spaceHash = hashString(spaceId)               // 空间 ID 哈希
startIndex = (dayIndex + spaceHash) % poolSize // 起始位置
// 循环选取最多 3 篇启用的文章
```

---

### 2.21 DrEditorHighlight（编辑高亮）

**表名**：`dr_editor_highlights`

| 字段 | 类型 | 约束 | 默认值 | 说明 |
|------|------|------|--------|------|
| `id` | Int | PK, 自增 | — | 内部 ID |
| `highlightId` | String | 唯一 | — | 业务 ID（格式：EH + 时间戳 + 随机数） |
| `articleId` | String | — | — | 关联文章 ID |
| `text` | String | — | — | 高亮文本内容 |
| `color` | String | — | `"#FFD700"` | 高亮颜色（十六进制，默认金色） |
| `positionData` | String | — | `"{}"` | JSON 格式位置信息 |
| `note` | String | — | `""` | 编辑备注/推荐理由 |
| `sortOrder` | Int | — | `0` | 显示排序权重（升序） |
| `createdAt` | DateTime | 默认 now() | — | 创建时间 |
| `updatedAt` | DateTime | 自动更新 | — | 最后更新时间 |

**唯一约束**：`highlightId`

**与用户高亮的区别**：
- `DrHighlight`：用户创建的批注，关联 `userId`
- `DrEditorHighlight`：管理员预标注的编辑精选，无用户关联

---

## 3. 模型关系图

```
AdminUser          AppConfig          Task               ExecutorClient
(独立)             (独立)             (独立，关联          (独立)
                                      ExecutorClient.clientId
                                      via claimedByClientId)

━━━━━━━━━━━━━━━━━━━ DeepRead 模块 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━

DrUser ──────────────────────────────────────────────┐
  │ (phone, unique)                                  │
  │                                                  │
  ├──< DrSpaceMember >──── DrSpace                  │
  │     (spaceId+userId, unique)   │                 │
  │     role: admin/member         │                 │
  │     inviteCodeId → DrInviteCode│                 │
  │                                │                 │
  │                      DrSpaceHomepageModule       │
  │                           │                      │
  │                      DrSpaceHomepageModuleResource│
  │                        (channel/article/collection ref)
  │                                │                 │
  │                         DrChannel               │
  │                           │                      │
  │                       DrArticle <───────────────┤
  │                           │                      │
  │                           ├──< DrEditorHighlight │ (编辑高亮)
  │                           │     text, color, note
  │                           │                      │
  ├──< DrBookmark >───────────┤                      │
  │     (userId+articleId, unique)  │                │
  │                                 │                │
  ├──< DrReadStatus >───────────────┤                │
  │     (userId+articleId, unique)  │                │
  │     progress: 0-100             │                │
  │                                 │                │
  ├──< DrHighlight >────────────────┘                │ (用户批注)
  │     text, color, positionData, note              │
  │                                                  │
  └──< DrCollection >                                │
        │                                            │
        └──< DrCollectionArticle >──────────────────┘
              (collectionId+articleId, unique)

DrSpace ──────────────────────────────────────────────┐
  │                                                  │
  ├──< DrSpaceCollection >                          │
  │     └──< DrSpaceCollectionArticle >─────────────┤
  │           (collectionId+articleId, unique)       │
  │                                                  │
  └──< DrDailyPickArticle > (每日精选池)              │
        (spaceId+articleId, unique)                  │
        enabled: boolean                             │
        → 轮换算法：日期 + 空间哈希选取 1-3 篇 ────────┘
```

---

## 4. 唯一约束汇总表

| 模型 | 唯一约束字段 |
|------|-------------|
| AdminUser | `username` |
| AppConfig | `configKey` |
| Task | `taskId` |
| ExecutorClient | `clientId` |
| DrUser | `phone` |
| DrSpace | `spaceId`, `inviteCode` |
| DrSpaceMember | `(spaceId, userId)` |
| DrInviteCode | `codeId`, `code` |
| DrChannel | `channelId` |
| DrArticle | `articleId` |
| DrSpaceHomepageModule | `moduleId` |
| DrSpaceHomepageModuleResource | `(moduleId, resourceId)` |
| DrBookmark | `(userId, articleId)` |
| DrReadStatus | `(userId, articleId)` |
| DrHighlight | `highlightId` |
| DrCollection | `collectionId` |
| DrCollectionArticle | `(collectionId, articleId)` |
| DrDailyPickArticle | `pickId`, `(spaceId, articleId)` |
| DrEditorHighlight | `highlightId` |

---

## 5. 常用 Prisma 操作命令

### 开发流程

```bash
# 1. 修改 prisma/schema.prisma 后，同步到数据库（开发用，无迁移记录）
npm run db:push
# 等价于：npx prisma db push

# 2. 重新生成 Prisma Client（修改 schema 后必须执行）
npm run db:generate
# 等价于：npx prisma generate

# 3. 运行种子脚本（初始化默认数据）
npm run db:seed
# 等价于：npx tsx src/prisma/seed.ts
```

### 数据库迁移（生产环境推荐）

```bash
# 创建新的迁移文件（会提示输入迁移名称）
npx prisma migrate dev --name add_new_field

# 在生产环境应用迁移
npx prisma migrate deploy
```

### 数据库查看

```bash
# 启动 Prisma Studio（可视化数据库管理界面，浏览器访问）
npx prisma studio
```

### 重置数据库（危险操作）

```bash
# 删除所有表并重新创建（会提示确认）
npx prisma migrate reset

# 重置后重新运行种子
npx prisma migrate reset && npm run db:seed
```

### 直接查询 SQLite

```bash
# 使用 sqlite3 命令行工具
sqlite3 prisma/dev.db

# 常用查询
.tables                          # 列出所有表
SELECT * FROM admin_users;       # 查询管理员
SELECT * FROM tasks ORDER BY created_at DESC LIMIT 10;  # 最新 10 条任务
SELECT * FROM dr_users;          # 查询 DR 用户
```

---

## 6. 数据库文件位置

开发环境默认路径：`server/prisma/dev.db`（由 `DATABASE_URL=file:./dev.db` 决定，相对路径基于 `prisma/` 目录）

生产环境推荐使用绝对路径：
```bash
DATABASE_URL="file:/data/juma.db"
```

SQLite 数据库文件应定期备份，并不应放在容器内部（需挂载 volume）。
