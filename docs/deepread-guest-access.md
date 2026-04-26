# DeepRead 游客登录 — 功能权限对比

## 认证方式

| 用户类型 | 认证方式 | 标识符 |
|---------|---------|-------|
| 登录用户 | SMS 验证码 + JWT | 手机号 |
| 游客用户 | deviceId 自动注册 + JWT | 客户端生成的 UUID |

## 游客登录接口

**POST** `/api/v1/dr/guest/login`

请求：
```json
{ "device_id": "客户端生成的UUID（至少8位）" }
```

响应：
```json
{
  "code": 200,
  "message": "游客登录成功",
  "data": {
    "token": "JWT token（payload 含 role=guest）",
    "user": { "id": 1, "role": "guest", "nickname": "游客", "avatar": "" }
  }
}
```

同一 deviceId 重复调用会返回已有用户，不会重复创建。

## 游客升级为正式用户

调用 SMS 登录时传入 `device_id`，系统自动将游客升级为正式用户：

**POST** `/api/v1/dr/login`

```json
{ "phone": "13800138000", "code": "888888", "device_id": "之前的UUID" }
```

升级后：`role` 变为 `user`，绑定手机号，AI 配额提升至正常值。

## 游客受限响应

游客访问受限接口时返回：
```json
{ "code": 403, "message": "该功能需要登录后使用", "data": { "reason": "guest_restricted" } }
```

客户端可据此弹出登录引导。

---

## 功能权限矩阵

### 认证相关（无需 JWT）

| 接口 | 方法 | 路径 | 登录用户 | 游客 | 说明 |
|------|------|------|---------|------|------|
| 发送短信验证码 | POST | `/sms/send` | ✅ | ❌ | 游客无手机号 |
| 手机号登录 | POST | `/login` | ✅ | — | 支持 device_id 参数升级游客 |
| 游客登录 | POST | `/guest/login` | — | ✅ | deviceId 换 JWT |

### 用户信息

| 接口 | 方法 | 路径 | 登录用户 | 游客 | 说明 |
|------|------|------|---------|------|------|
| 获取个人资料 | GET | `/me` | ✅ | ✅ | 返回含 role 字段 |
| 修改昵称 | PUT | `/me/nickname` | ✅ | ❌ | guest_restricted |

### 空间

| 接口 | 方法 | 路径 | 登录用户 | 游客 | 说明 |
|------|------|------|---------|------|------|
| 加入空间 | POST | `/space/join` | ✅ | ❌ | guest_restricted |
| 查看空间首页 | GET | `/spaces/:spaceId/homepage` | ✅ | ✅ | 游客自动加入默认空间 |

### 文章

| 接口 | 方法 | 路径 | 登录用户 | 游客 | 说明 |
|------|------|------|---------|------|------|
| 文章列表 | GET | `/articles` | ✅ | ✅ | 核心阅读体验 |
| 文章详情 | GET | `/articles/:articleId` | ✅ | ✅ | 核心阅读体验 |

### 每日推荐

| 接口 | 方法 | 路径 | 登录用户 | 游客 | 说明 |
|------|------|------|---------|------|------|
| 每日文章 | GET | `/daily-article` | ✅ | ✅ | 展示产品核心价值 |
| 思维网格 | GET | `/thinking-lattice` | ✅ | ✅ | 展示产品核心价值 |

### AI 对话

| 接口 | 方法 | 路径 | 登录用户 | 游客 | 说明 |
|------|------|------|---------|------|------|
| AI 对话（同步） | POST | `/ai/chat` | ✅ | ✅(限额) | 游客每日 3 次 |
| AI 对话（流式） | POST | `/ai/chat/stream` | ✅ | ✅(限额) | 同上 |

### 数据同步

| 接口 | 方法 | 路径 | 登录用户 | 游客 | 说明 |
|------|------|------|---------|------|------|
| 导出备份 | POST | `/sync/export` | ✅ | ❌ | guest_restricted |
| 导入备份 | POST | `/sync/import` | ✅ | ❌ | guest_restricted |

---

## 汇总

| 类别 | 登录用户 | 游客 |
|------|---------|------|
| 阅读（文章列表/详情） | ✅ | ✅ |
| 空间首页浏览 | ✅ | ✅ |
| 每日推荐 + 思维网格 | ✅ | ✅ |
| AI 对话 | ✅（按配额） | ✅（每日 3 次） |
| 个人资料查看 | ✅ | ✅ |
| 修改昵称 | ✅ | ❌ |
| 加入空间 | ✅ | ❌ |
| 数据同步 | ✅ | ❌ |

## 技术实现

- **Schema**：`DrUser` 增加 `role`（guest/user）和 `deviceId` 字段，`phone` 改为可选
- **JWT**：payload 含 `role` 字段，中间件自动提取到 `req.drRole`
- **守卫**：`guestGuard` 中间件集中拦截受限路径（`PUT /me/nickname`、`POST /space/join`、`POST /sync/*`）
- **AI 配额**：游客使用独立配置 `dr_guest_daily_limit`（默认 3），通过 `DrAiQuota` 表控制
- **自动加入空间**：游客登录时自动加入默认空间，复用现有 `requireMembership` 检查
