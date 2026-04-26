# DeepRead 游客登录 — 客户端接入指南

## 1. 什么时候触发游客登录

用户首次打开 App，未进行过 SMS 登录时：

```
App 启动
  → 检查本地存储是否有 token
    → 有 token → 正常使用（检查过期则重新登录）
    → 无 token → 调用游客登录接口
```

## 2. 游客登录接口

**POST** `/api/v1/dr/guest/login`

请求头（所有 `/api/v1/dr` 接口都需要）：
```
x-timestamp: 当前毫秒时间戳
x-sign: MD5(APP_SECRET + x-timestamp)
Content-Type: application/json
```

请求体：
```json
{
  "device_id": "客户端生成的唯一标识，至少8位"
}
```

建议 `device_id` 生成方式：`UUID` 或 `设备型号+随机数`，首次生成后**持久化到本地存储**，卸载前保持不变。

响应：
```json
{
  "code": 200,
  "message": "游客登录成功",
  "data": {
    "token": "eyJhbGciOi...",
    "user": {
      "id": 42,
      "role": "guest",
      "nickname": "游客",
      "avatar": ""
    }
  }
}
```

拿到 `token` 后存入本地，后续请求在 Header 中携带：
```
Authorization: Bearer <token>
```

## 3. 判断当前用户类型

通过 `/me` 接口的 `role` 字段，或直接解析 JWT token：

```swift
// iOS 示例
let role = decodedJWT["role"] as? String  // "guest" 或 "user"
```

```kotlin
// Android 示例
val role = jwtPayload.getString("role") // "guest" 或 "user"
```

| role 值 | 含义 | 显示 |
|---------|------|------|
| `guest` | 游客，未绑定手机号 | 显示"登录"入口 |
| `user` | 正式用户，已绑定手机号 | 正常状态 |

## 4. 处理游客限制

当游客访问受限功能时，服务端返回：

```json
{
  "code": 403,
  "message": "该功能需要登录后使用",
  "data": {
    "reason": "guest_restricted"
  }
}
```

**客户端处理逻辑：**

```
收到响应
  → code == 403 且 data.reason == "guest_restricted"
    → 弹出登录引导（跳转 SMS 登录页）
```

受限功能列表（只需关注这几个）：
- 修改昵称 `PUT /me/nickname`
- 加入空间 `POST /space/join`
- 数据同步 `POST /sync/export` 和 `POST /sync/import`

## 5. 游客升级为正式用户

用户在 SMS 登录时，**额外传入 `device_id`** 即可自动升级：

**POST** `/api/v1/dr/login`

```json
{
  "phone": "13800138000",
  "code": "888888",
  "device_id": "之前游客登录用的 device_id"
}
```

响应与正常登录一致，但 `role` 变为 `user`，`phone` 已绑定：

```json
{
  "code": 200,
  "message": "登录成功",
  "data": {
    "token": "新 JWT（role=user）",
    "user": {
      "id": 42,
      "role": "user",
      "phone": "138****8000",
      "nickname": "用户8000",
      "avatar": ""
    }
  }
}
```

升级后用新 token **替换**本地存储的旧 token。

## 6. AI 调用限额差异

| 用户类型 | 每日 AI 次数 | 超限响应 |
|---------|-------------|---------|
| 游客 | 3 次 | `{ "code": 429, "message": "今日AI使用次数已达上限" }` |
| 正式用户 | 10 次（可配置） | 同上 |

游客 AI 次数用尽时，建议弹出登录引导："登录后可获得更多 AI 对话次数"。

## 7. 完整流程图

```
┌─────────────┐
│  App 启动    │
└──────┬──────┘
       │
       ▼
  本地有 token？──── 否 ────→ POST /guest/login { device_id }
       │                           │
       是                          ▼
       │                      保存 token
       ▼                          │
  使用 token 请求              ────┘
       │
       ▼
  收到 guest_restricted？
       │
    是 │          否 → 正常处理
       ▼
  引导 SMS 登录
  POST /login { phone, code, device_id }
       │
       ▼
  替换 token，role 变为 user
```

## 8. 注意事项

- `device_id` 一旦生成，不要轻易更换。同一 device_id 对应同一个游客账号。
- 游客的阅读数据（AI 对话记录等）在升级为正式用户后会保留。
- 游客 token 有效期 30 天，过期后用同一 device_id 重新调用 `/guest/login` 即可。
- `/guest/login` 不需要 Authorization header，只需要 x-sign + x-timestamp。
