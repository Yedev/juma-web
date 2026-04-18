# 生产环境升级指南

## 先理解当前的自动升级机制

容器启动时，`Dockerfile` 的 CMD 会自动执行：

```
db push → seed → node dist/index.js
```

也就是说，**只要部署新镜像，schema 变更就会自动应用**，不需要手动进数据库执行 SQL。

但这个机制有一个关键细节：

```dockerfile
npx prisma db push --schema=... --skip-generate
# 注意：没有 --accept-data-loss
```

**没有 `--accept-data-loss`，意味着：**
- 新增字段、新增表 → 自动通过，容器正常启动
- 删除字段、删除表 → Prisma 报错，**容器启动失败**，旧容器已经被删了

所以删除操作需要特殊处理，下面会详细说。

---

## 升级的两种类型

### 类型 A：安全升级（加法操作）

包括：新增字段（有默认值）、新增表、新增索引、纯代码改动

**流程：直接跑 `./deploy.sh`**

```
旧容器停止 → 构建新镜像 → 新容器启动 → db push 自动应用变更 → 服务恢复
```

停机时间约 30~60 秒（构建期间）。无需任何额外操作。

---

### 类型 B：危险升级（删除操作）

包括：删除字段、删除表、修改字段类型（不兼容）

**直接跑 `./deploy.sh` 会导致容器启动失败！**

必须按以下流程操作：

---

## 类型 B 完整操作流程

### 第一步：备份数据库

```bash
# 在服务器上执行
cp juma-data/juma.db juma-data/juma.db.backup-$(date +%Y%m%d_%H%M%S)
```

备份文件留在 `juma-data/` 目录里，不会被 Docker 清理。

### 第二步：修改 Dockerfile，临时允许数据丢失

找到 CMD 里的这一行：

```dockerfile
DATABASE_URL=file:/app/data/juma.db npx prisma db push --schema=/app/prisma/schema.prisma --skip-generate && \
```

改为：

```dockerfile
DATABASE_URL=file:/app/data/juma.db npx prisma db push --schema=/app/prisma/schema.prisma --skip-generate --accept-data-loss && \
```

### 第三步：部署

```bash
./deploy.sh
```

### 第四步：验证服务正常后，还原 Dockerfile

把 `--accept-data-loss` 删掉，再提交：

```bash
git add Dockerfile
git commit -m "[chore] remove --accept-data-loss after schema cleanup"
```

**不还原的后果：** 下次有人手滑改了 schema 删了字段，容器会直接丢数据没有任何警告。

---

## 回滚流程

如果新版本部署后出现问题，需要回滚：

### 情况一：只有代码改动（没有删除字段/表）

直接用 git 回到旧版本重新部署即可，数据库结构是兼容的。

```bash
git checkout <旧版本的 commit hash>
./deploy.sh
```

### 情况二：已经删除了字段或表（最复杂）

数据已经丢失，唯一的救援手段是备份文件。

```bash
# 1. 停止当前容器
docker stop juma-web && docker rm juma-web

# 2. 恢复数据库备份
cp juma-data/juma.db.backup-20260418_120000 juma-data/juma.db

# 3. 切回旧版本代码
git checkout <旧版本的 commit hash>

# 4. 重新部署
./deploy.sh
```

**所以：删字段前一定先备份。**

---

## 查看生产数据库

需要检查数据库内容时，不要直接在容器里操作，直接访问宿主机上的数据库文件：

```bash
# 安装 sqlite3（如果没有）
apt install sqlite3

# 打开数据库
sqlite3 juma-data/juma.db

# 常用命令
.tables              -- 查看所有表
.schema dr_articles  -- 查看某张表的结构
SELECT COUNT(*) FROM dr_articles;
.quit
```

---

## 查看升级日志

容器启动时的 db push 日志可以在这里看：

```bash
docker logs juma-web | head -50
```

正常的输出应该是：

```
🚀  Your database is now in sync with your Prisma schema.
```

如果出现以下内容，说明有删除操作被拦截了（容器会在此处退出）：

```
⚠️  There might be data loss when applying the changes
Error: ...
```

---

## 停机时间参考

| 操作 | 停机时间 | 说明 |
|------|---------|------|
| 纯代码改动 | ~30s | 仅重新构建，push 瞬间完成 |
| 新增字段/表 | ~30s | push 做 ALTER TABLE，很快 |
| 删除字段/表 | ~30s | 加了 `--accept-data-loss` 后同上 |
| 数据量很大时的索引变更 | 可能更长 | SQLite 在线 DDL 较慢 |

停机窗口就是从 `docker stop` 到新容器健康检查通过的这段时间。

---

## 快速检查清单

部署前过一遍：

- [ ] schema 改动是否包含**删除字段/表**？
  - 是 → 先备份数据库
  - 是 → 临时在 Dockerfile 加 `--accept-data-loss`
- [ ] 代码里对被删字段的所有引用是否已清理？
- [ ] 新增字段是否都有 `@default(...)` 或标记为可空？
- [ ] 部署完成后，Dockerfile 里的 `--accept-data-loss` 是否已删除并提交？
