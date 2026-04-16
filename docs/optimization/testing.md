# 测试用例完善计划

当前 DeepRead 模块已实现 49 个测试用例（6 个测试套件），采用 Mock Prisma 方案。
本文档记录后续优化方向。

---

## 现状

| 项目 | 说明 |
|------|------|
| 测试框架 | Jest + ts-jest + supertest |
| 数据层 | Mock Prisma（因 ARM/Termux 无法运行 Prisma 引擎） |
| 覆盖模块 | DeepRead（auth、articles、highlights、collections、homepage、sync） |
| 测试文件 | `server/src/__tests__/deepread/*.test.ts` |

### Mock 方案的局限

- 不验证 SQL 查询正确性
- 不验证数据约束（唯一键、外键等）
- 不验证事务行为
- Mock 数据可能偏离真实 Schema

---

## TODO：迁移到真实数据库集成测试

**目标**：在 x86 环境（CI/CD 或开发机）运行时，使用真实 SQLite 测试数据库。

### 实现步骤

1. **条件判断测试环境**
   - 检测 Prisma 引擎是否可用
   - 可用时走集成测试，不可用时回退 Mock 测试

2. **创建测试数据库**
   - 使用独立 `prisma/test.db`
   - `globalSetup.ts` 中执行 `prisma db push` 创建表结构
   - `globalTeardown.ts` 清理

3. **编写 seed 辅助函数**
   - `server/src/__tests__/factories/` 目录下放置工厂函数
   - `createUser()`, `createSpace()`, `createArticle()` 等
   - 每个测试 beforeAll 种子数据，afterAll 清理

4. **迁移现有 Mock 测试**
   - 逐步替换 Mock 为真实 DB 查询
   - 保留 Mock 版本作为 fallback（可通过环境变量切换）

5. **CI 集成**
   - GitHub Actions 中运行完整集成测试
   - Termux/ARM 环境跳过或仅跑 Mock 测试

### 预期收益

| 收益 | 说明 |
|------|------|
| 数据约束验证 | 唯一键冲突、外键约束等真实场景 |
| 事务正确性 | `$transaction`、原子操作的真实行为 |
| Schema 一致性 | 字段类型、默认值与代码预期匹配 |
| 回归保护 | Schema 变更自动被测试捕获 |

---

## TODO：补充其他模块测试

| 模块 | 优先级 | 说明 |
|------|--------|------|
| Admin API | 中 | `/api/admin` 路由，JWT 认证 |
| App API | 中 | `/api/v1/app` 路由，x-sign 认证 |
| AI Chat | 低 | 需 Mock OpenAI SDK |
| 任务执行引擎 | 低 | WebSocket + 任务调度 |
