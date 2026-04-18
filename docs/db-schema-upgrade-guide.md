# 数据库 Schema 升级指南

本项目使用 **Prisma + SQLite**，采用 `db push` 模式（非 migrate 模式）。
两者的核心区别：

| | `db push` | `migrate` |
|---|---|---|
| 适合场景 | 开发阶段、原型、快速迭代 | 生产环境、需要回滚历史 |
| 是否生成迁移文件 | 否 | 是 |
| 是否支持回滚 | 否 | 是 |
| 数据丢失保护 | 警告，需手动确认 | 拦截，需先写迁移脚本 |

**当前项目处于快速迭代阶段，继续使用 `db push` 即可。**
本指南覆盖所有常见变更场景。

---

## 通用流程

无论什么变更，步骤都是：

```
1. 修改 server/prisma/schema.prisma
2. 运行 db:push
3. 重新生成 Prisma Client（push 会自动触发）
4. 更新对应的 TypeScript 代码
```

---

## 场景一：新增字段

**示例：给 `DrArticle` 加一个 `likeCount` 字段**

### 1. 修改 schema

```prisma
model DrArticle {
  // ... 现有字段 ...
  likeCount   Int      @default(0) @map("like_count")   // 新增
}
```

**关键点：新字段必须有默认值（`@default(...)`）或声明为可空（`Int?`）**，否则现有数据行无法填充该字段，`db push` 会报错。

### 2. 执行 push

```bash
cd server
npm run db:push
```

无需任何额外参数，push 会直接 `ALTER TABLE ... ADD COLUMN`，**不会丢失数据**。

### 3. 更新代码

新字段会自动出现在 Prisma Client 的类型定义里，在 Service / Route 里按需使用即可。

---

## 场景二：修改字段名

SQLite 原生支持 `RENAME COLUMN`（SQLite 3.25+），但 Prisma 的 `db push` **不能直接重命名列**——它会删掉旧列、新建新列，导致数据丢失。

**正确做法：用 `@map` 保持数据库列名不变，只改 Prisma 模型属性名**

```prisma
// 修改前
readCount   Int  @default(0) @map("read_count")

// 修改后（只改 Prisma 侧的属性名，数据库列名 read_count 不变）
viewCount   Int  @default(0) @map("read_count")
```

这样数据库不会有任何变化，只是 TypeScript 里的引用从 `article.readCount` 改为 `article.viewCount`。
然后全局搜索替换代码里的引用即可，**不需要跑 db:push**。

---

## 场景三：修改字段类型

SQLite 的类型系统很宽松，但 Prisma 对类型变更有限制。

### 安全的改法

- `Int` → `String`（数据会以字符串形式保留）
- 添加/去掉 `?`（可空/非空）

### 有数据丢失风险的改法

- `String` → `Int`（无法转换的值会出错）
- 任何不兼容的类型转换

**操作步骤：**

1. 先备份数据库：
   ```bash
   cp server/dev.db server/dev.db.backup
   ```
2. 修改 schema
3. 运行 push，根据提示决定是否加 `--accept-data-loss`
4. 如果数据有问题，从备份恢复：
   ```bash
   cp server/dev.db.backup server/dev.db
   ```

---

## 场景四：删除字段

**这是最危险的操作，会永久删除该列的所有数据。**

### 步骤

1. **备份数据库**
   ```bash
   cp server/dev.db server/dev.db.backup
   ```

2. **从 schema 中删除该字段**

3. **先清理代码**（必须在 push 之前做，否则编译报错）
   - 删除 Service 里所有对该字段的引用
   - 删除 Route 里的相关逻辑
   - 删除测试文件里的引用

4. **执行 push**
   ```bash
   cd server
   npm run db:push
   ```
   如果该字段有数据，会收到警告：
   ```
   ⚠️  There might be data loss when applying the changes:
     • You are about to drop the column `xxx` on the `yyy` table...
   ```
   确认没问题后加参数：
   ```bash
   npx prisma db push --accept-data-loss
   ```

---

## 场景五：删除整张表

和删除字段类似，但影响更大。

### 步骤

1. **备份数据库**
   ```bash
   cp server/dev.db server/dev.db.backup
   ```

2. **从 schema 中删除整个 model 块**

3. **清理所有相关代码**
   - 对应的 Service 文件
   - 对应的 Route 文件
   - `index.ts` 里的路由挂载
   - 其他 model 里对该表的 relation 引用
   - Admin 路由里的级联删除逻辑

4. **执行 push**
   ```bash
   npx prisma db push --accept-data-loss
   ```

---

## 场景六：新增整张表

最简单的操作，零风险。

1. 在 schema 末尾添加新 model 块
2. 执行 `npm run db:push`
3. 编写对应的 Service 和 Route

---

## 场景七：修改索引

索引变更（添加/删除 `@@index`、`@@unique`）不影响数据，直接改 schema 然后 push 即可。

```prisma
// 添加索引
@@index([userId, createdAt])

// 删除：直接移除该行
```

---

## 数据备份最佳实践

### 开发环境

每次做**删除字段/删除表/修改字段类型**前，手动备份：

```bash
cp server/dev.db server/dev.db.$(date +%Y%m%d_%H%M%S)
```

### 生产环境（未来部署时）

部署前固定执行：

```bash
# 1. 停服务
# 2. 备份数据库文件到 S3 / 对象存储
# 3. 执行 push（或切换为 migrate）
# 4. 启服务
```

---

## 快速参考表

| 操作 | 是否丢数据 | 是否需要 `--accept-data-loss` | 是否需要先改代码 |
|------|-----------|-------------------------------|-----------------|
| 新增字段（有默认值）| 否 | 否 | 否（push 后再加）|
| 新增字段（无默认值）| 否，但会报错 | — | 需先加默认值或 `?` |
| 改字段名（用 @map）| 否 | 否 | 是（同步改引用）|
| 删除字段 | **是** | **是** | **是（先删引用）**|
| 新增表 | 否 | 否 | 否 |
| 删除表 | **是** | **是** | **是（先删代码）**|
| 改索引 | 否 | 否 | 否 |

---

## 常见报错与解决

**报错：`Field 'xxx' doesn't have a default value`**
→ 新增字段时忘记加 `@default(...)`，补上即可。

**报错：`There might be data loss`（命令退出非0）**
→ 正常保护机制，加 `--accept-data-loss` 参数确认执行。

**报错：TypeScript 编译错误（找不到字段）**
→ 删除字段后忘记清理代码引用，全局搜索字段名并删除。

**误操作丢了数据**
→ 从备份恢复：`cp server/dev.db.backup server/dev.db`，然后重新生成 client：`npx prisma generate`。
