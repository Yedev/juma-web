# Redis 优化方案设计

本文档梳理 juma-web 项目中适合引入 Redis 的场景，分析现状痛点、Redis 方案和预期收益。

---

## 总览

| # | 场景 | 现状问题 | Redis 方案 | 优先级 |
|---|------|---------|-----------|--------|
| 1 | SMS 验证码 | 写 SQLite，需定期清理 | `SET key TTL` 自动过期 | ★★★ 高 |
| 2 | AI 使用额度 | 每次请求读写 DB | 当日额度计数器缓存 | ★★★ 高 |
| 3 | AppConfig 热配置 | 每次请求都查 DB | 带失效的 KV 缓存 | ★★★ 高 |
| 4 | 首页模块缓存 | 多次 DB 联查 | 按 spaceId 缓存结果 | ★★☆ 中 |
| 5 | 任务队列 | DB 轮询（2s 间隔） | Redis List / BullMQ | ★★☆ 中 |
| 6 | Executor 心跳状态 | 定时 DB 扫描判断离线 | Hash + TTL 心跳键 | ★★☆ 中 |
| 7 | JWT Token 吊销 | 30 天 Token 无法提前失效 | Token 黑名单 Set | ★☆☆ 低 |
| 8 | 接口限流 | 无限流，AI 接口可被滥用 | 滑动窗口计数器 | ★★☆ 中 |

---

## 1. SMS 验证码（高优先级）

### 现状

```
DrSmsCode 表: { phone, code, expiresAt, used }
```

- 每次发送验证码写一条 SQLite 记录
- 验证后 `UPDATE used = true`，旧记录永久堆积
- 需要 `inviteCodeCleaner` 之类的定时任务清理过期数据

### Redis 方案

```
KEY:   sms:code:{phone}
TYPE:  STRING
VALUE: "888888"
TTL:   300 秒（5 分钟，与现有逻辑一致）
```

**发送验证码**
```typescript
await redis.set(`sms:code:${phone}`, code, 'EX', 300);
```

**验证验证码**
```typescript
const stored = await redis.get(`sms:code:${phone}`);
if (!stored || stored !== code) return null;
await redis.del(`sms:code:${phone}`); // 使用后立即删除，防止重用
```

### 收益

- 完全消除 `DrSmsCode` 表，去掉清理逻辑
- 验证码天然过期，无需定时任务
- 读写速度提升 10x+

---

## 2. AI 使用额度（高优先级）

### 现状

`drAiService.ts → prepareChatContext()` 在每次 AI 调用时执行：

1. `findUnique` 查 `DrAiProvider`
2. `findFirst` 查 `DrAiModel`
3. `findUnique` 查 `DrAiQuota`
4. `findUnique` 查 `AppConfig`（默认额度）
5. `upsert` 确保当日记录存在
6. `$executeRaw` 原子扣减

共 5~6 次 DB 操作，发生在每次 AI 流式请求的关键路径上。

### Redis 方案

**每日用量计数器（替换步骤 5~6）**

```
KEY:   ai:usage:{userId}:{YYYY-MM-DD}
TYPE:  STRING（整数计数器）
TTL:   当日剩余秒数（次日 0 点自动清零）
```

```typescript
const today = getTodayDateString(); // "2026-04-15"
const key = `ai:usage:${userId}:${today}`;

// 原子 INCRBY，返回操作后的值
const consumed = await redis.incrby(key, costPerUse);

// 首次写入时设置过期（次日 0 点 UTC+8）
if (consumed === costPerUse) {
  const secondsUntilMidnight = calcSecondsUntilMidnightCST();
  await redis.expire(key, secondsUntilMidnight);
}

if (consumed > dailyLimit) {
  // 超限：回滚扣减
  await redis.decrby(key, costPerUse);
  return { error: '今日 AI 使用额度已达上限', status: 429 };
}
```

**AI Provider / Model 配置缓存（替换步骤 1~2）**

```
KEY:   ai:provider:{providerName}
TYPE:  STRING (JSON)
TTL:   300 秒
```

配置几乎不变，缓存 5 分钟无感知。

### 收益

- AI 调用关键路径从 5~6 次 DB 操作降至 1~2 次 Redis 操作
- 额度控制更精准，Redis 原子操作天然防并发超限

---

## 3. AppConfig 热配置（高优先级）

### 现状

`AppConfig` 表存储全局配置（如 `dr_ai_default_daily_limit`），但每次 AI 调用、每次用户注册都会 `findUnique` 查询，而配置几乎不会变动。

### Redis 方案

```
KEY:   config:{configKey}
TYPE:  STRING
TTL:   60 秒
```

```typescript
async function getConfig(key: string): Promise<string | null> {
  const cached = await redis.get(`config:${key}`);
  if (cached !== null) return cached;

  const record = await prisma.appConfig.findUnique({ where: { configKey: key } });
  const value = record?.configValue ?? null;
  if (value !== null) {
    await redis.set(`config:${key}`, value, 'EX', 60);
  }
  return value;
}
```

管理端更新配置时，主动删除对应缓存键：

```typescript
await redis.del(`config:${configKey}`);
```

### 收益

- 消除大量重复的配置读取 DB 查询
- 60 秒 TTL 保证配置更新最多 60 秒生效，无需手动同步

---

## 4. 首页模块缓存（中优先级）

### 现状

`drHomepageService.ts → getHomepageModules()` 执行：

1. 查 `DrSpaceHomepageModule`
2. 查 `DrSpaceHomepageModuleResource`
3. 并行查 `DrChannel` + `DrArticle` + `DrSpaceCollection`
4. 查每篇文章的用户阅读状态 (`enrichWithUserState`)

首页是访问最频繁的接口，但模块配置变化很低频。

### Redis 方案

**两级缓存：模块结构 + 用户个人状态分离**

```
KEY:   homepage:modules:{spaceId}          # 通用模块结构（无用户状态）
TYPE:  STRING (JSON)
TTL:   300 秒

KEY:   homepage:user_state:{userId}:{spaceId}  # 用户阅读状态
TYPE:  STRING (JSON)
TTL:   60 秒
```

管理端修改首页模块时，主动删除 `homepage:modules:{spaceId}` 缓存。

### 收益

- 热门 space 首页从 5~8 次 DB 查询降至 0~1 次
- 用户状态独立缓存，精细化控制失效策略

---

## 5. 任务队列（中优先级）

### 现状

`executionEngine.ts` 使用 `setInterval` 每 2 秒轮询 SQLite：

```typescript
setInterval(() => {
  void scheduleLocalTasks(prisma);
}, LOCAL_POLL_INTERVAL_MS); // 2000ms
```

- 即使无任务也持续产生 DB 查询
- 多实例部署时竞争同一 SQLite，存在锁争用风险

### Redis 方案（BullMQ）

```typescript
// 生产端（enqueue）
import { Queue } from 'bullmq';
const serverTaskQueue = new Queue('server-tasks', { connection: redis });
await serverTaskQueue.add('task', { taskId, taskName, taskParams });

// 消费端（worker，替换 setInterval 轮询）
import { Worker } from 'bullmq';
const worker = new Worker('server-tasks', async (job) => {
  await executeLocalTask(prisma, job.data);
}, { connection: redis, concurrency: LOCAL_CONCURRENCY });
```

Task 结果仍写回 SQLite（保持审计记录），只用 Redis 做队列调度。

### 收益

- 消除空转轮询，任务到达即时触发（延迟从 ~2s 降至 ~10ms）
- BullMQ 内置重试、延迟、优先级、死信队列
- 支持横向扩展多个 worker 实例

---

## 6. Executor 心跳状态（中优先级）

### 现状

`executionEngine.ts` 每 10 秒扫描全表判断 executor 是否离线：

```typescript
setInterval(() => {
  void refreshExecutorStatus(prisma); // 全表 UPDATE
}, OFFLINE_SWEEP_INTERVAL_MS); // 10000ms
```

### Redis 方案

```
KEY:   executor:heartbeat:{clientId}
TYPE:  STRING
TTL:   70 秒（略大于心跳周期 60s）
```

WebSocket 每次收到心跳消息时刷新 TTL：

```typescript
await redis.set(`executor:heartbeat:${clientId}`, '1', 'EX', 70);
```

判断在线状态：

```typescript
const alive = await redis.exists(`executor:heartbeat:${clientId}`);
```

TTL 过期 = executor 离线，无需定时扫描。

### 收益

- 消除每 10 秒的全表扫描
- 离线检测更实时（秒级 vs 分钟级）

---

## 7. JWT Token 吊销（低优先级）

### 现状

DeepRead JWT 有效期 30 天，一旦签发无法提前失效（用户注销、改密后 Token 仍有效）。

### Redis 方案

```
KEY:   jwt:blacklist:{jti}      # jti = JWT unique ID
TYPE:  STRING
TTL:   与 Token 剩余有效期一致
```

签发 Token 时加入 `jti` 字段；验证时额外检查黑名单：

```typescript
const blacklisted = await redis.exists(`jwt:blacklist:${decoded.jti}`);
if (blacklisted) return res.status(401).json({ message: 'Token 已失效' });
```

用户主动注销时将 `jti` 写入黑名单。

### 收益

- 支持安全注销，30 天长期 Token 不再是风险
- 黑名单 TTL 自动对齐 Token 过期，无需清理

---

## 8. 接口限流（中优先级）

### 现状

AI 接口（`/api/v1/dr/ai/chat`、`/api/v1/dr/ai/chat-stream`）无请求频率限制，单用户可在额度未耗尽前高频并发请求。

### Redis 方案（滑动窗口）

```
KEY:   ratelimit:ai:{userId}
TYPE:  STRING（计数器）
TTL:   60 秒
```

```typescript
async function checkRateLimit(userId: number, limit = 10): Promise<boolean> {
  const key = `ratelimit:ai:${userId}`;
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, 60);
  return count <= limit; // 每分钟最多 10 次
}
```

也可对 `/api/v1/dr/auth/send-code` 做手机号级别的限流（防止短信轰炸）：

```
KEY:   ratelimit:sms:{phone}
TTL:   60 秒
LIMIT: 1 次/分钟，5 次/天
```

### 收益

- 防止 AI 接口被恶意滥用或意外循环调用
- 防短信轰炸，降低短信成本

---

## 实施建议

### 接入成本

- 推荐使用 [`ioredis`](https://github.com/luin/ioredis) 客户端
- 创建 `server/src/lib/redis.ts` 统一管理连接实例
- 本地开发用 Docker 启动 Redis：`docker run -d -p 6379:6379 redis:alpine`

### 推荐实施顺序

1. **第一步**：SMS 验证码 → 去掉一张表，最低风险
2. **第二步**：AppConfig 缓存 → 一行封装，收益立竿见影
3. **第三步**：AI 额度计数器 → 减少 AI 关键路径延迟
4. **第四步**：首页模块缓存 → 显著降低高频接口 DB 压力
5. **后续**：任务队列、心跳状态、限流、JWT 黑名单

### 数据一致性原则

- 缓存只做**读加速**，SQLite 仍是 Source of Truth（任务状态、用户数据等）
- 写操作：先写 DB，再删除（而非更新）对应缓存键（Cache-Aside 模式）
- 给所有缓存键设置合理 TTL，避免缓存永不失效

---

*文档生成于 2026-04-15*
