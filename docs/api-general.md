# 通用说明与错误码

## 通用说明

### 响应格式

所有接口均返回 JSON，标准格式如下：

```json
{
  "code": 200,
  "message": "操作成功",
  "data": { ... }
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `code` | number | 业务状态码（200=成功，非 200=失败） |
| `message` | string | 状态描述 |
| `data` | any | 响应数据（失败时可能为 null） |

### 签名计算（x-sign）

所有 `/api/v1/*` 接口需要以下请求头：

```
x-timestamp: 1709000000000        # 13位毫秒时间戳
x-sign: a3f2c1d4e5b6...          # MD5(APP_SECRET + x-timestamp)，32位小写十六进制
```

**计算方式（Shell）：**
```bash
APP_SECRET="juma2026_secret"
TS=$(date +%s%3N)
SIGN=$(printf "%s" "${APP_SECRET}${TS}" | md5sum | awk '{print $1}')
```

**计算方式（JavaScript）：**
```javascript
import CryptoJS from 'crypto-js'
const ts = Date.now().toString()
const sign = CryptoJS.MD5(APP_SECRET + ts).toString()
```

---

## 健康检查

### GET /api/health

```bash
curl "http://localhost:3001/api/health"
```

**响应：**
```json
{
  "code": 200,
  "message": "OK",
  "timestamp": "2026-03-01T12:00:00.000Z"
}
```

---

## 错误码说明

| HTTP 状态码 | 业务 code | 说明 |
|------------|----------|------|
| 200 | 200 | 成功 |
| 400 | 400 | 请求参数错误 |
| 401 | 401 | 未认证（缺少 Token 或 Token 无效，或 x-sign 错误） |
| 403 | 403 | 禁止访问（时间戳过期，防重放） |
| 404 | 404 | 资源不存在 |
| 500 | 500 | 服务器内部错误 |

### 签名错误示例

```json
// x-timestamp 缺失或格式错误
HTTP 403
{ "code": 403, "message": "时间戳无效" }

// 时间戳超出 ±5 分钟
HTTP 403
{ "code": 403, "message": "请求已过期" }

// x-sign 不匹配
HTTP 401
{ "code": 401, "message": "签名错误" }
```

### JWT 错误示例

```json
// Bearer Token 缺失
HTTP 401
{ "code": 401, "message": "未授权" }

// Token 过期或无效
HTTP 401
{ "code": 401, "message": "Token 无效或已过期" }
```
