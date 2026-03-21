# 开发进度与技术规范

## 1. 当前版本功能完成状态

### 核心基础设施

| 功能 | 状态 | 说明 |
|------|------|------|
| Express HTTP 服务 | 完成 | 端口可配置，CORS 开启 |
| TypeScript 编译 | 完成 | tsconfig 严格模式 |
| Prisma + SQLite | 完成 | 16 个数据模型，种子数据 |
| 健康检查接口 | 完成 | `GET /api/health` |
| SPA 静态文件托管 | 完成 | admin-ui 构建产物 |
| 环境变量配置 | 完成 | 所有关键参数可通过环境变量覆盖 |

### 认证与安全

| 功能 | 状态 | 说明 |
|------|------|------|
| 管理员密码认证（bcrypt） | 完成 | salt=10，JWT 24h |
| 管理员 JWT 中间件 | 完成 | `authMiddleware` |
| x-sign MD5 签名中间件 | 完成 | `signMiddleware`，±5分钟防重放 |
| DeepRead JWT 中间件 | 完成 | `drAuthMiddleware`，30天有效期 |
| DeepRead SMS 验证码登录 | 完成（开发模式） | 固定验证码 888888，无真实短信 |
| WebSocket 连接密钥验证 | 完成 | `EXECUTOR_SHARED_KEY` |

### 任务系统

| 功能 | 状态 | 说明 |
|------|------|------|
| 任务命名规则（server.*/client.*） | 完成 | `taskNaming.ts` |
| 任务注册表 | 完成 | `taskRegistry.ts`，4个内置任务 |
| 任务入队接口 | 完成 | `taskEnqueue.ts` |
| 本地执行引擎（server_task） | 完成 | 并发控制，乐观锁 |
| server.echo 内置任务 | 完成 | 可配置循环回显 |
| client_task 任务队列 | 完成 | 数据库持久化 |
| 任务重试机制（client_task） | 完成 | 最大重试 0-10 次 |
| 任务日志截断（64KB） | 完成 | 保留尾部内容 |
| 远程任务超时恢复 | 完成 | 5分钟超时后重试或报错 |
| 遗留任务类型处理 | 完成 | server_script/remote_mac 自动报错 |

### WebSocket 网关

| 功能 | 状态 | 说明 |
|------|------|------|
| RFC 6455 手动帧解析 | 完成 | 支持 Text/Close/Ping/Pong |
| client.hello 注册 | 完成 | upsert ExecutorClient |
| client.heartbeat | 完成 | 更新 lastHeartbeat |
| task.assign 分发 | 完成 | 每 1500ms 轮询分发 |
| task.update 状态回报 | 完成 | 支持 running/completed/error |
| task.log 日志追加 | 完成 | 实时追加，64KB 截断 |
| required_tags AND 匹配 | 完成 | 标签过滤 |
| target_client_id 定向分发 | 完成 | 指定客户端 |
| 客户端离线状态管理 | 完成 | 心跳超时 + 断线即时更新 |
| 多客户端并发控制 | 完成 | maxConcurrency 1-20 |

### 管理后台 API（/api/admin）

| 功能 | 状态 | 说明 |
|------|------|------|
| 管理员登录 | 完成 | bcrypt + JWT |
| 任务 CRUD | 完成 | 创建/查询/更新状态/删除 |
| 任务注册表查询 | 完成 | 含参数和示例 payload |
| 任务快速入队（按名称） | 完成 | `execute-by-name` |
| 执行器客户端管理 | 完成 | 列表/删除 |
| 应用配置 CRUD | 完成 | upsert 支持 |
| DeepRead 空间管理 | 完成 | CRUD + 级联删除 |
| DeepRead 动态邀请码管理 | 完成 | 支持限次/限时 |
| DeepRead 频道管理 | 完成 | CRUD + 排序 |
| DeepRead 文章管理 | 完成 | CRUD + 分页 |
| DeepRead 成员列表查看 | 完成 | 含用户信息关联 |

### DeepRead 客户端 API（/api/v1/dr）

| 功能 | 状态 | 说明 |
|------|------|------|
| SMS 验证码发送 | 完成（开发模式） | 固定 888888 |
| 手机号 + 验证码登录 | 完成 | 自动注册新用户 |
| 通过邀请码加入空间 | 完成 | 支持动态邀请码 |
| 文章列表（含书签/进度） | 完成 | 批量查询，无 N+1 |
| 文章详情（自动增加阅读数） | 完成 | 成员校验 |
| 文章收藏/取消收藏 | 完成 | upsert/deleteMany |
| 阅读进度更新（0-100） | 完成 | upsert |
| 批注创建 | 完成 | 支持颜色/位置/笔记 |
| 批注更新（颜色/笔记） | 完成 | 仅本人可修改 |
| 批注删除 | 完成 | 仅本人可删除 |
| 文章批注列表 | 完成 | 仅返回本人批注 |
| 合集创建 | 完成 | 用户私有 |
| 合集文章管理（添加/移除） | 完成 | 仅合集所有者可操作 |
| 合集列表（含文章数） | 完成 | groupBy 批量统计 |
| AI 文章问答（Gemini） | 完成 | 需配置 GEMINI_API_KEY |

### 移动 App API（/api/v1/app）

| 功能 | 状态 | 说明 |
|------|------|------|
| 获取应用配置 | 完成 | 支持任意 configKey |
| 任务目录查询 | 完成 | 同 admin 的 task-definitions |
| 任务入队 | 完成 | 蛇形命名字段 |
| 任务状态查询 | 完成 | 含完整执行信息 |
| 任务状态更新（旧接口） | 完成 | 向后兼容 |

---

## 2. 技术债务与已知限制

### 数据库层

| 问题 | 严重程度 | 说明 |
|------|----------|------|
| SQLite 单文件，不支持并发写 | 中 | 高并发写操作可能导致 SQLITE_BUSY 错误 |
| 无连接池 | 中 | 每个路由文件独立创建 `new PrismaClient()`，存在多实例问题 |
| 无数据库迁移历史 | 中 | 使用 `db push` 而非 `migrate dev`，schema 变更无版本记录 |
| SQLite 不支持完整的 SQL 特性 | 低 | 如某些 JSON 查询、窗口函数等 |
| 删除空间时无法级联删除用户的书签/批注/合集 | 低 | 需手动处理孤儿数据 |

### WebSocket 层

| 问题 | 严重程度 | 说明 |
|------|----------|------|
| 手动 RFC 6455 实现不支持分片帧（Fragmented frames） | 低 | 客户端消息必须在单帧内发送完 |
| 无 WebSocket 协议层认证（握手后无二次验证） | 中 | 依赖共享密钥，密钥泄露后无法追踪 |
| sessions Map 存储在内存中 | 中 | 服务重启后所有 WS 连接状态丢失 |
| 单进程架构，不支持水平扩展 | 高 | 多实例部署时 sessions 无法共享 |

### 安全层

| 问题 | 严重程度 | 说明 |
|------|----------|------|
| 所有默认密钥都是弱密钥（公开在代码注释中） | 高 | 生产环境必须更换所有 `_SECRET`/`_KEY` 变量 |
| SMS 验证码为固定值 888888 | 高 | 必须在生产环境接入真实短信服务 |
| 无请求频率限制（Rate Limiting） | 中 | SMS 接口、登录接口易被暴力攻击 |
| CORS 完全开放 | 低 | `cors()` 无限制，生产环境应配置白名单 |
| JWT Token 无法主动吊销 | 低 | 无黑名单机制，只能等待过期 |

### 功能层

| 问题 | 严重程度 | 说明 |
|------|----------|------|
| AI 对话无上下文历史 | 低 | 每次请求独立，无法进行多轮对话 |
| AI 对话不支持流式响应 | 低 | 响应延迟较高（需等待 Gemini 完整回复） |
| 文章内容无全文搜索 | 低 | 仅支持精确 ID 查询，无关键词搜索 |
| DeepRead 用户无头像上传接口 | 低 | 头像 URL 字段存在但无上传功能 |
| 无任务优先级队列 | 低 | 任务按 createdAt ASC 顺序处理 |

---

## 3. 待开发功能建议

### 近期（高优先级）

1. **接入真实短信服务**
   - 集成阿里云 SMS 或腾讯云 SMS
   - 生成随机 6 位验证码
   - 实现同一手机号 60 秒内不重复发送的限制

2. **请求频率限制**
   - 对 `/api/v1/dr/sms/send` 限制：每手机号每分钟最多 1 次
   - 对 `/api/auth/login` 限制：每 IP 每分钟最多 10 次

3. **修复多 PrismaClient 实例问题**
   - 创建共享的 `prisma.ts` 单例文件
   - 所有路由文件从该文件导入，而非 `new PrismaClient()`

4. **WebSocket 认证增强**
   - 在 client.hello 中增加 timestamp + 签名验证
   - 防止长期有效的连接被重放

### 中期（中优先级）

5. **AI 多轮对话支持**
   - 在客户端维护对话历史
   - 服务端接受 `history` 数组参数

6. **AI 流式响应（SSE）**
   - 改为 Server-Sent Events 或 HTTP 流式响应
   - 减少用户等待感知时间

7. **全文搜索**
   - 对文章标题和内容建立搜索索引
   - 可使用 SQLite FTS5 虚拟表实现

8. **任务优先级**
   - 在 Task 表增加 `priority` 字段（整数）
   - 调度时按 `priority DESC, createdAt ASC` 排序

9. **数据库迁移规范化**
   - 从 `db push` 切换到 `migrate dev` 管理 schema 变更
   - 建立迁移版本历史

### 长期（架构级）

10. **数据库迁移到 PostgreSQL**
    - 支持真正的并发写
    - 丰富的 JSON 查询能力
    - 支持读写分离
    - 修改 `datasource db { provider = "postgresql" }`

11. **多实例支持**
    - 将 sessions 状态迁移到 Redis
    - 支持水平扩展
    - WebSocket 网关可以独立部署

12. **完整的 RBAC 权限系统**
    - DeepRead 空间内的精细角色权限（admin/editor/member）
    - 管理员多角色支持

---

## 4. 开发规范

### 4.1 添加新路由

1. 在 `src/routes/` 下创建新文件或向现有文件添加路由
2. 选择合适的中间件：
   - 管理后台接口 → 添加到 `admin.ts`（已有全局 `authMiddleware`）
   - 移动 App 接口 → 添加到 `app.ts`（已有全局 `signMiddleware`）
   - DeepRead 接口 → 添加到 `deepread.ts`（根据是否需要 JWT 决定位置）
3. 遵循统一响应格式：`{ code, message, data? }`
4. 所有异步处理器加 `try/catch`，错误时返回 500
5. 如创建新路由文件，在 `index.ts` 中挂载

### 4.2 添加新的 server_task

1. 在 `src/services/serverTaskRuntime.ts` 中：
   - 定义 payload 接口（TypeScript interface）
   - 创建继承 `ServerTaskBase` 的类
   - 实现 `taskName`（格式：`server.xxx`）、`title`、`description`、`params`、`exampleTaskPayload`
   - 实现 `normalizePayload()` 做类型安全的参数规范化
   - 实现 `run()` 方法，通过 `context.log()` 记录日志
   - 将实例加入 `serverTaskInstances` 数组

2. 任务自动出现在：
   - `GET /api/admin/task-definitions` 响应中
   - `GET /api/v1/app/task/catalog` 响应中

### 4.3 添加新的数据库模型

1. 在 `prisma/schema.prisma` 中添加新 model
2. 运行 `npm run db:push` 同步 schema 到 SQLite
3. 运行 `npm run db:generate` 重新生成 Prisma Client
4. 如有初始数据，在 `src/prisma/seed.ts` 中添加种子逻辑
5. 在相应的路由文件中添加 CRUD 接口

### 4.4 代码风格约定

- **TypeScript 类型**：所有参数和返回值应有明确的类型标注，避免使用 `any`
- **参数校验**：用户输入的字符串要 trim() 并验证格式，数字要使用 `Math.max/min` 限制范围
- **JSON 存储**：数据库中存储为 JSON 字符串的字段（如 `taskParams`、`statusInfo`）在读写时必须解析/序列化
- **错误处理**：路由处理器统一使用 `try/catch`，`catch` 块打印错误并返回 500
- **空值处理**：使用 `?? fallback` 而非 `|| fallback`（避免 0/false 被替换）
- **Prisma 操作**：优先使用 `upsert` 实现"不存在则创建"逻辑，减少竞态条件
- **日志**：使用 `console.error` 记录错误（便于容器日志收集），正常流程不打印无用日志

### 4.5 接口字段命名约定

- **admin 路由**：请求/响应字段使用驼峰命名（camelCase），与前端 TypeScript 保持一致
- **app 路由**：请求字段使用蛇形命名（snake_case），与移动端习惯保持一致
- **deepread 路由**：请求字段使用蛇形命名（snake_case）

### 4.6 taskId 生成格式

```typescript
function generateTaskId(): string {
  return `T${Date.now()}${Math.floor(Math.random() * 1000).toString().padStart(3, "0")}`;
}
// 示例：T17111234567890042
```

其他实体 ID 格式：
- Space: `S` + 时间戳 + 随机3位
- Channel: `CH` + 时间戳 + 随机3位
- Article: `A` + 时间戳 + 随机3位
- InviteCode: `IC` + 时间戳 + 随机3位
- Collection: `C` + 时间戳 + 随机3位
- Highlight: `H` + 时间戳 + 随机3位
