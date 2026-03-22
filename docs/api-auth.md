# 认证接口

### POST /api/auth/login

管理员登录，获取 JWT Token。

**请求体：**
```json
{
  "username": "juma",
  "password": "juma2026"
}
```

**响应示例：**
```json
{
  "code": 200,
  "message": "登录成功",
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
}
```

**错误情况：**
```json
{ "code": 401, "message": "用户名或密码错误" }
```
