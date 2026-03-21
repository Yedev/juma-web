# 中间件模块文档

`server/src/middleware/` 目录包含三个中间件，分别负责不同的认证场景。所有中间件遵循 Express 标准签名 `(req, res, next) => void`。

---

## 1. auth.ts — 管理员 JWT 验证

### 功能说明

验证管理后台 API 请求的 JWT Bearer Token，成功后将解码的用户信息挂载到请求对象上，供后续路由处理器使用。

### 使用的路由

- `src/routes/admin.ts` — 所有 `/api/admin/*` 接口（通过 `router.use(authMiddleware)` 全局应用）

### 核心逻辑

```
1. 读取 Authorization 请求头
2. 校验格式是否为 "Bearer <token>"
   → 格式错误：返回 401 { code: 401, message: "未授权，请先登录" }
3. 提取 token，调用 jwt.verify(token, JWT_SECRET)
   → 验证失败（过期/篡改）：返回 401 { code: 401, message: "Token已过期或无效" }
4. 将解码结果挂载到请求对象
   req.userId   = decoded.userId    (number)
   req.username = decoded.username  (string)
5. 调用 next() 继续处理
```

### 扩展接口

```typescript
export interface AuthRequest extends Request {
  userId?: number;
  username?: string;
}
```

路由处理器使用 `AuthRequest` 类型代替 `Request` 以访问 `req.userId`。

### 配置

| 参数 | 环境变量 | 默认值 | 说明 |
|------|----------|--------|------|
| 签名密钥 | `JWT_SECRET` | `juma_jwt_secret_2026` | HS256 算法密钥 |
| Token 有效期 | 无（由 login 接口设定） | `24h` | 在 `routes/auth.ts` 签发时指定 |

### 错误响应码

| HTTP 状态 | code | message | 触发条件 |
|-----------|------|---------|---------|
| 401 | 401 | 未授权，请先登录 | 缺少 Authorization 头或格式错误 |
| 401 | 401 | Token已过期或无效 | jwt.verify 抛出异常 |

---

## 2. sign.ts — x-sign MD5 签名验证

### 功能说明

验证移动 App 和 DeepRead 客户端请求的 MD5 签名，防止接口被未授权调用，并通过时间戳窗口防止重放攻击。

### 使用的路由

- `src/routes/app.ts` — 所有 `/api/v1/app/*` 接口（`router.use(signMiddleware)` 全局应用）
- `src/routes/deepread.ts` — 所有 `/api/v1/dr/*` 接口（包括无需 JWT 的 sms/send 和 login）

### 签名计算规则

```
signature = MD5(APP_SECRET + x-timestamp)
```

- `APP_SECRET`：环境变量，默认值 `juma2026_secret`
- `x-timestamp`：请求头中的 Unix 时间戳（毫秒，字符串格式）
- MD5 输出为 32 位小写十六进制字符串
- 比较时双方均转换为小写（`sign.toLowerCase() !== expectedSign.toLowerCase()`）

### 请求头要求

```
x-timestamp: 1711234567890    # Unix 时间戳（毫秒）
x-sign: a1b2c3d4...          # MD5 签名（32 位十六进制）
```

### 防重放机制

时间窗口：`MAX_TIME_DIFF_MS = 5 * 60 * 1000`（±5 分钟）

```
diff = |Date.now() - parseInt(x-timestamp)|
if diff > 300000ms → 拒绝请求（timestamp expired）
```

客户端需保证本地时钟与标准时间误差在 5 分钟以内。

### 核心验证流程

```
1. 读取 x-timestamp 请求头
   → 缺失：403 { message: "Forbidden: missing x-timestamp" }
   → 非数字：403 { message: "Forbidden: invalid x-timestamp" }

2. 计算时间差
   → |now - ts| > 5分钟：403 { message: "Forbidden: timestamp expired (replay attack prevented)" }

3. 读取 x-sign 请求头
   → 缺失：401 { message: "Unauthorized: missing x-sign" }

4. 计算期望签名
   expectedSign = MD5(APP_SECRET + timestamp)

5. 比较签名（不区分大小写）
   → 不匹配：401 { message: "Unauthorized: invalid signature" }

6. 验证通过，调用 next()
```

### 错误响应码

| HTTP 状态 | code | message | 触发条件 |
|-----------|------|---------|---------|
| 403 | 403 | Forbidden: missing x-timestamp | 缺少 x-timestamp 头 |
| 403 | 403 | Forbidden: invalid x-timestamp | x-timestamp 无法解析为数字 |
| 403 | 403 | Forbidden: timestamp expired (replay attack prevented) | 时间差超过 5 分钟 |
| 401 | 401 | Unauthorized: missing x-sign | 缺少 x-sign 头 |
| 401 | 401 | Unauthorized: invalid signature | MD5 签名不匹配 |

### 客户端签名示例（TypeScript）

```typescript
import md5 from 'md5';

const APP_SECRET = 'juma2026_secret'; // 与服务端保持一致
const timestamp = Date.now().toString();
const sign = md5(APP_SECRET + timestamp);

const headers = {
  'Content-Type': 'application/json',
  'x-timestamp': timestamp,
  'x-sign': sign,
};

fetch('/api/v1/app/config', { headers });
```

---

## 3. drAuth.ts — DeepRead 用户 JWT 验证

### 功能说明

验证 DeepRead 移动客户端的 JWT Token，与 `auth.ts` 类似但使用独立的密钥和更长的有效期（30 天）。同时提供 `signDrToken()` 工具函数供 login 接口调用。

### 使用的路由

- `src/routes/deepread.ts` — `/api/v1/dr/sms/send` 和 `/api/v1/dr/login` **之后**的所有接口（通过第二个 `router.use(drAuthMiddleware)` 应用）

### 核心逻辑

与 `auth.ts` 完全对称，但：
- 使用 `DR_JWT_SECRET` 密钥
- Token 有效期为 30 天（`"30d"`）
- 解码后挂载 `req.drUserId` 和 `req.drPhone`

```
1. 读取 Authorization 请求头，校验 "Bearer <token>" 格式
   → 格式错误：401 { message: "未登录，请先登录" }
2. jwt.verify(token, DR_JWT_SECRET)
   → 验证失败：401 { message: "Token已过期或无效" }
3. 挂载到请求对象
   req.drUserId = decoded.userId  (number)
   req.drPhone  = decoded.phone   (string)
4. next()
```

### 扩展接口

```typescript
export interface DrAuthRequest extends Request {
  drUserId?: number;
  drPhone?: string;
}
```

### Token 签发函数

```typescript
export function signDrToken(payload: { userId: number; phone: string }): string {
  return jwt.sign(payload, DR_JWT_SECRET, { expiresIn: '30d' });
}
```

在 `routes/deepread.ts` 的 login 接口中调用此函数签发 Token。

### 配置

| 参数 | 环境变量 | 默认值 | 说明 |
|------|----------|--------|------|
| 签名密钥 | `DR_JWT_SECRET` | `deepread_jwt_secret_2026` | HS256 算法密钥 |
| Token 有效期 | 硬编码 | `30d` | 在 `signDrToken()` 中指定 |

### 错误响应码

| HTTP 状态 | code | message | 触发条件 |
|-----------|------|---------|---------|
| 401 | 401 | 未登录，请先登录 | 缺少 Authorization 头或格式错误 |
| 401 | 401 | Token已过期或无效 | jwt.verify 抛出异常 |

---

## 4. 三个中间件对比

| 特性 | auth.ts | sign.ts | drAuth.ts |
|------|---------|---------|-----------|
| 保护对象 | 管理后台 | App + DeepRead | DeepRead 用户接口 |
| 认证方式 | JWT Bearer | MD5 签名 + 时间戳 | JWT Bearer |
| 密钥变量 | `JWT_SECRET` | `APP_SECRET` | `DR_JWT_SECRET` |
| Token 有效期 | 24 小时 | 无状态（每次计算） | 30 天 |
| 防重放 | JWT exp 字段 | ±5 分钟时间窗口 | JWT exp 字段 |
| 扩展接口 | `AuthRequest` | 无 | `DrAuthRequest` |

---

## 5. 在新路由中使用这些中间件

### 新增一个需要管理员权限的路由

```typescript
// src/routes/admin.ts（已有全局 router.use(authMiddleware)）
import { AuthRequest } from '../middleware/auth';

router.get('/my-new-endpoint', async (req: AuthRequest, res: Response) => {
  // req.userId 和 req.username 已由中间件注入
  const adminId = req.userId!;
  res.json({ code: 200, message: 'ok', data: { adminId } });
});
```

### 新增一个需要 App 签名的路由

```typescript
// src/routes/app.ts（已有全局 router.use(signMiddleware)）
router.get('/my-app-endpoint', async (req: Request, res: Response) => {
  // 签名验证已由中间件完成，此处直接处理业务逻辑
  res.json({ code: 200, message: 'ok' });
});
```

### 新增一个独立文件，同时需要签名和 DR JWT

```typescript
import { Router } from 'express';
import { signMiddleware } from '../middleware/sign';
import { drAuthMiddleware, DrAuthRequest } from '../middleware/drAuth';

const router = Router();

// 公开接口（仅需签名）
router.use(signMiddleware);
router.post('/public-action', async (req, res) => { ... });

// 私有接口（签名 + JWT）
router.use(drAuthMiddleware);
router.get('/private-data', async (req: DrAuthRequest, res) => {
  const userId = req.drUserId!;
  // ...
});

export default router;
```

### 在 index.ts 中挂载新路由

```typescript
import myNewRoutes from './routes/myNew';
app.use('/api/v1/new', myNewRoutes);
```
