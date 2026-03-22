# Server 模块 Release 评审文档

> **评审日期**：2026-03-21
> **评审版本**：master 分支当前状态
> **评审结论**：⚠️ **有条件上线** — 2 项阻塞问题必须修复，其余问题可计划迭代

---

## 总体评分

| 维度 | 得分 | 说明 |
|------|------|------|
| 代码质量 | 7/10 | TypeScript strict，结构清晰，但无测试 |
| 安全性 | 5/10 | 认证体系完整，但存在高危配置风险 |
| 稳定性 | 6/10 | 核心流程健壮，WebSocket 层有单点风险 |
| 可运维性 | 5/10 | Docker 部署齐全，但缺日志/监控 |
| 文档完整性 | 9/10 | 架构文档、接口文档、开发指南齐备 |

---

## 🔴 阻塞问题（上线前必须解决）

> 不修复则**禁止上线**

### BLOCK-1：弱密钥硬编码，生产环境必须强制替换

**文件位置**：
- `src/middleware/auth.ts` — `JWT_SECRET` 默认值 `juma_jwt_secret_2026`
- `src/middleware/drAuth.ts` — `DR_JWT_SECRET` 默认值 `deepread_jwt_secret_2026`
- `src/middleware/sign.ts` — `APP_SECRET` 默认值 `juma2026_secret`
- `src/ws/executorWsGateway.ts` — `EXECUTOR_SHARED_KEY` 默认值 `juma_executor_2026`

**风险**：所有默认密钥已公开在代码注释中。攻击者可伪造 JWT Token、绕过签名验证、劫持 WebSocket 执行器连接，进而控制所有任务执行。

**修复方案**：
1. 在部署环境（Docker/K8s）中为以下 4 个环境变量注入强随机值（≥32 字节）：
   ```
   JWT_SECRET=<openssl rand -hex 32>
   DR_JWT_SECRET=<openssl rand -hex 32>
   APP_SECRET=<openssl rand -hex 32>
   EXECUTOR_SHARED_KEY=<openssl rand -hex 32>
   ```
2. CI/CD 流水线中增加"敏感变量非默认值"校验，阻止使用默认密钥部署

---

### BLOCK-2：SMS 验证码固定为 888888，DeepRead 登录形同虚设

**文件位置**：`src/routes/deepread.ts`，`POST /api/v1/dr/sms/send`

**风险**：任何人只要知道任意手机号 + `888888`，即可登录/注册任意 DeepRead 账号。

**修复方案（二选一）**：
- **方案 A（快）**：上线前接入阿里云/腾讯云短信，生成随机 6 位码，存入 DB，60 秒有效期
- **方案 B（应急）**：如果 DeepRead 暂不对外开放，在 `src/routes/deepread.ts` 中增加功能开关（环境变量 `DR_ENABLED=false`），彻底关闭 `/api/v1/dr/*` 路由，等短信接入后再开放

---

## 🟡 高优先级问题（上线后 2 周内修复）

### HIGH-1：缺少限流（Rate Limiting）

**受影响接口**：
- `POST /api/auth/login` — 可被无限暴力破解管理员密码
- `POST /api/v1/dr/sms/send` — 可被恶意刷短信费用

**修复**：安装 `express-rate-limit`
```typescript
// 登录接口：每 IP 每分钟最多 10 次
// SMS 接口：每手机号每分钟最多 1 次
```
工作量估计：**0.5 天**

---

### HIGH-2：多个 PrismaClient 实例（潜在连接泄漏）

**文件位置**：`src/routes/admin.ts`、`app.ts`、`deepread.ts`、`auth.ts` 均各自 `new PrismaClient()`

**风险**：SQLite 并发写冲突（`SQLITE_BUSY`），内存占用偏高，连接数不可控。

**修复**：新建 `src/lib/prisma.ts` 单例文件，所有路由从此文件 import
```typescript
// src/lib/prisma.ts
import { PrismaClient } from "@prisma/client";
export const prisma = new PrismaClient();
```
工作量估计：**0.5 天**

---

### HIGH-3：CORS 完全开放

**文件位置**：`src/index.ts` — `app.use(cors())`

**风险**：任意域名可跨域请求 Admin API，增加 CSRF 攻击面。

**修复**：
```typescript
app.use(cors({
  origin: process.env.CORS_ORIGINS?.split(",") ?? ["http://localhost:5173"],
  credentials: true,
}));
```
工作量估计：**0.5 天**

---

### HIGH-4：缺少结构化日志和请求追踪

**现状**：仅有 `console.error`，无请求 ID、无访问日志、无耗时记录。生产环境出问题时无法定位。

**修复**：
1. 安装 `pino` + `pino-http`（轻量、JSON 格式，适合容器日志收集）
2. 在 `src/index.ts` 中注入 `pinoHttp` 中间件
3. 所有 `console.error` 替换为 `logger.error`

工作量估计：**1 天**

---

## 🟢 中优先级问题（上线后下一个迭代处理）

### MED-1：WebSocket Session 存储在进程内存

- **风险**：服务重启后所有执行器需重新连接，无法水平扩展
- **修复方向**：将 `sessions` Map 迁移到 Redis（`ioredis`）
- 当前为单机部署，暂可接受

### MED-2：数据库无迁移版本历史

- **风险**：`db push` 会静默修改字段，无法回滚 schema
- **修复方向**：切换到 `prisma migrate dev`，建立迁移文件夹
- 建议在下个有 schema 变更的需求时顺带完成

### MED-3：无健康探针细化

- **现状**：`GET /api/health` 仅返回 `{status: ok}`，未检查数据库连通性
- **修复**：在 health check 中执行 `SELECT 1` 验证 DB 可用性，供 K8s liveness/readiness 使用

### MED-4：JWT 无法主动吊销

- **影响**：管理员密码泄露后，已签发的 Token 在 24 小时内仍有效
- **修复方向**：维护 Redis 黑名单，在 `authMiddleware` 中查验

---

## 🔵 低优先级问题（路线图规划）

| 编号 | 问题 | 方向 |
|------|------|------|
| LOW-1 | 无自动化测试 | 补充核心业务逻辑单测（Vitest），集成测试覆盖任务流程 |
| LOW-2 | AI 问答无对话上下文 | 客户端传 `history` 数组，服务端拼 prompt |
| LOW-3 | 无全文搜索 | SQLite FTS5 虚拟表，或接入 MeiliSearch |
| LOW-4 | SQLite 并发写上限 | 高并发场景迁移 PostgreSQL |
| LOW-5 | 任务无优先级队列 | Task 表增 `priority` 字段 |
| LOW-6 | DeepRead 用户无头像上传 | 接入 OSS 对象存储 |
| LOW-7 | WS 握手后无二次身份验证 | `client.hello` 增 timestamp 签名 |

---

## 上线前检查清单

> 运维/研发在部署时逐项确认打勾

### 必须完成

- [ ] **BLOCK-1**：4 个密钥环境变量均已替换为强随机值（非代码默认值）
- [ ] **BLOCK-2**：SMS 服务已接入，或 `/api/v1/dr/*` 路由已通过环境变量关闭
- [ ] `DATABASE_URL` 指向持久化存储路径（容器内 `/app/data/juma.db`，已配置 Volume 挂载）
- [ ] `deploy.sh` 默认密码 `juma2026` 已在首次启动后通过 Admin UI 修改
- [ ] Docker Volume 已在宿主机做定时备份（`juma_data` Volume）

### 建议完成

- [ ] **HIGH-1**：限流中间件已添加
- [ ] **HIGH-2**：PrismaClient 单例已迁移
- [ ] **HIGH-3**：CORS `origin` 白名单已配置
- [ ] **HIGH-4**：结构化日志已接入

### 运维监控

- [ ] 容器健康检查已配置（`/api/health`）
- [ ] 日志收集已对接（ELK / Loki / CloudWatch）
- [ ] 磁盘告警已设置（SQLite 文件增长监控）

---

## 架构风险说明

| 风险 | 当前影响 | 触发条件 | 预案 |
|------|----------|----------|------|
| SQLite 写锁 | 并发写操作失败 | >10 并发写入 | 重试机制、迁移 PG |
| WS Sessions 丢失 | 执行器需重连 | 服务重启 | 执行器自动重连逻辑 |
| 单点故障 | 服务不可用 | 进程崩溃 | Docker restart policy + PM2 |
| 日志缺失 | 故障难排查 | 任何异常 | 优先级 HIGH-4 修复 |

---

## 结论与建议

**推荐策略**：

1. **立即（本次 Release）**：修复 BLOCK-1 + BLOCK-2，这是硬性安全门槛
2. **发布后第 1 周**：完成 HIGH-1（限流）、HIGH-2（Prisma 单例）、HIGH-3（CORS）
3. **发布后第 2 周**：完成 HIGH-4（日志），同时评估短信服务接入方案
4. **后续迭代**：MED/LOW 系列问题按业务优先级排期

> 整体而言，server 模块代码质量良好，架构思路清晰，文档体系完善，开发规范已落地。
> 当前状态属于**开发内测级别**，通过安全加固后可达**生产可用标准**。
> 核心阻塞不在代码逻辑，在于**密钥管理**和**外部服务依赖（短信）**，修复成本低，影响面可控。

---

*文档维护：每次上线前更新评审日期和已解决条目状态*
