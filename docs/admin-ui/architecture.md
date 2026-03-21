# admin-ui 架构文档

## 1. 模块职责概述

`admin-ui` 是 JUMA 项目的前端管理后台，是一个基于 React 的单页应用（SPA）。它为管理员提供以下核心能力：

- **任务管理**：创建、触发、监控后台定时/异步任务，查看执行日志，管理执行器客户端
- **配置管理**：以 JSON 键值对形式维护系统运行时配置，支持多 key 切换与在线编辑
- **API 说明与调试**：内嵌交互式接口文档，支持自动生成签名并实时发送测试请求
- **DeepRead 内容管理**：管理 DeepRead 子系统的空间、频道、文章及用户数据

该模块**不包含**业务逻辑执行，所有数据均通过后端 REST API 获取，admin-ui 仅负责展示与交互。

---

## 2. 目录结构

```
admin-ui/
├── public/                  # 静态资源（直接托管，不经 Vite 处理）
├── src/
│   ├── main.tsx             # 应用入口，挂载根 React 组件
│   ├── App.tsx              # 路由配置、认证守卫、Ant Design 主题
│   ├── index.css            # 全局基础样式（reset/通用）
│   ├── assets/              # 图片等静态资源（会被 Vite 处理）
│   ├── api/
│   │   └── client.ts        # Axios 实例，含请求/响应拦截器
│   ├── utils/
│   │   └── sign.ts          # 签名工具函数 generateSign()
│   ├── layouts/
│   │   └── AdminLayout.tsx  # 全局管理后台布局（侧边栏 + 顶部栏 + 内容区）
│   └── pages/
│       ├── Login.tsx              # 登录页
│       ├── TaskManagement.tsx     # 任务管理
│       ├── ConfigManagement.tsx   # 配置管理
│       ├── ApiPlayground.tsx      # API 接口说明与调试
│       ├── DrSpaceManagement.tsx  # DeepRead 空间管理
│       ├── DrChannelManagement.tsx# DeepRead 频道管理
│       ├── DrArticleManagement.tsx# DeepRead 文章管理
│       └── DrUserManagement.tsx   # DeepRead 用户管理
├── index.html               # HTML 入口模板
├── vite.config.ts           # Vite 构建与开发服务器配置
├── tsconfig.json            # TypeScript 项目引用根配置
├── tsconfig.app.json        # 应用代码的 TS 编译选项
├── tsconfig.node.json       # Vite 配置文件的 TS 编译选项
└── package.json             # 依赖与脚本声明
```

### 各目录说明

| 目录/文件 | 说明 |
|-----------|------|
| `src/api/` | 封装所有 HTTP 通信，统一处理 token 注入与 401 跳转 |
| `src/utils/` | 纯工具函数，当前只有签名生成，与框架无耦合 |
| `src/layouts/` | 管理后台的外壳组件，通过 `<Outlet />` 渲染子页面 |
| `src/pages/` | 各业务页面组件，每个文件对应一个路由，自包含状态与 API 调用 |

---

## 3. 路由架构

### 路由结构图

```
/ (BrowserRouter)
├── /login                    → Login.tsx（无需认证）
│
└── /  (RequireAuth 守卫)
    └── AdminLayout.tsx（Outlet）
        ├── /tasks            → TaskManagement.tsx
        ├── /config           → ConfigManagement.tsx
        ├── /api-playground   → ApiPlayground.tsx
        ├── /dr/spaces        → DrSpaceManagement.tsx
        ├── /dr/channels      → DrChannelManagement.tsx
        ├── /dr/articles      → DrArticleManagement.tsx
        └── /dr/users         → DrUserManagement.tsx

未匹配的路径 (*) → 重定向到 /
/（index）      → 重定向到 /tasks
```

### RequireAuth 守卫机制

`RequireAuth` 是一个轻量级高阶组件，定义在 `App.tsx` 中：

```tsx
function RequireAuth({ children }: { children: React.ReactNode }) {
  const token = localStorage.getItem("juma_token");
  if (!token) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
}
```

**工作原理：**

1. 每次渲染时读取 `localStorage` 中的 `juma_token`
2. 若 token 不存在，立即重定向到 `/login`（使用 `replace` 避免留下历史记录）
3. 若 token 存在，正常渲染子组件树（`AdminLayout` 及其子路由）

**注意：** 此守卫仅做客户端存在性检查，不验证 token 有效性。真正的 token 校验由后端在每次 API 请求时完成，无效 token 会触发 401 响应，进而由响应拦截器执行清除和跳转。

### 路由嵌套关系

`AdminLayout` 使用 react-router-dom 的 `<Outlet />` 渲染嵌套子路由。所有业务页面都是 `AdminLayout` 的子路由，因此它们天然共享侧边栏和顶部栏，无需重复引入布局组件。

---

## 4. 认证流程

### 完整流程图

```
用户输入账号密码
        ↓
POST /api/auth/login
        ↓
后端返回 { code: 200, data: { token, username } }
        ↓
写入 localStorage:
  - juma_token   ← Bearer Token
  - juma_username ← 显示在侧边栏底部
        ↓
navigate("/tasks")  ← 进入管理后台
        ↓
后续每个 API 请求
  → 请求拦截器读取 juma_token
  → 注入 Authorization: Bearer <token>
        ↓
后端返回 401（token 过期/无效）
  → 响应拦截器清除 juma_token、juma_username
  → window.location.href = "/login"（强制跳转）
```

### localStorage 键说明

| 键名 | 值 | 用途 |
|------|----|------|
| `juma_token` | Bearer Token 字符串 | 认证凭据，注入所有 API 请求 |
| `juma_username` | 用户名字符串 | 显示在侧边栏底部，无认证作用 |

### 登出流程

主动登出（点击侧边栏"退出"按钮）：

```
handleLogout()
  → localStorage.removeItem("juma_token")
  → localStorage.removeItem("juma_username")
  → navigate("/login")
```

被动登出（401 响应）：

```
响应拦截器 error handler
  → localStorage.removeItem("juma_token")
  → localStorage.removeItem("juma_username")
  → window.location.href = "/login"  ← 使用原生跳转，强制刷新页面状态
```

被动登出使用 `window.location.href` 而非 `navigate()`，是为了确保 React 状态完全重置，防止敏感数据残留在内存中。

---

## 5. 构建配置

### Vite 配置（`vite.config.ts`）

```ts
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
    },
  },
});
```

**关键配置说明：**

- **开发端口**：固定为 `5173`
- **API 代理**：开发模式下，所有 `/api/*` 请求被转发到 `http://localhost:3001`（后端服务）。这避免了跨域问题，并且无需在前端硬编码后端地址
- **`changeOrigin: true`**：代理时修改请求的 `Host` 头为目标地址，兼容后端的 Host 校验

### TypeScript 配置（`tsconfig.app.json`）

编译目标为 `ES2022`，启用了以下严格模式选项：

| 选项 | 作用 |
|------|------|
| `strict: true` | 启用所有严格类型检查（包括 `strictNullChecks`、`noImplicitAny` 等） |
| `noUnusedLocals` | 禁止未使用的局部变量 |
| `noUnusedParameters` | 禁止未使用的函数参数 |
| `noFallthroughCasesInSwitch` | 禁止 switch case 穿透 |
| `erasableSyntaxOnly` | 仅允许可擦除语法（禁止 `const enum` 等） |

JSX 使用 `react-jsx` 转换（React 17+ 新 JSX transform），无需在每个文件显式 `import React`。

### 构建产物

执行 `npm run build` 后，产物输出到 `dist/` 目录，为标准静态文件（HTML + JS + CSS），可部署到任何静态文件服务器或 CDN。

---

## 6. 与后端的交互方式

### API 请求路径约定

所有 API 请求均以 `/api/` 开头，分为两类前缀：

| 前缀 | 用途 | 认证方式 |
|------|------|----------|
| `/api/auth/` | 认证相关（登录） | 无需 token |
| `/api/admin/` | 管理后台操作 | Bearer Token |
| `/api/v1/` | 面向客户端的公开 API（ApiPlayground 展示与测试） | MD5 签名（x-timestamp + x-sign） |

### 开发环境

开发时启动 `npm run dev`，Vite 开发服务器在 `5173` 端口运行，所有 `/api/*` 请求通过内置代理转发到 `localhost:3001`（后端）。前端代码中的 `VITE_API_BASE_URL` 为空字符串，Axios 的 `baseURL` 为空，请求路径为相对路径（如 `/api/admin/tasks`），由 Vite 代理拦截处理。

### 生产环境

生产部署时，通常将 admin-ui 的静态产物放置在与后端同源的路径下（或通过 Nginx 反向代理），使 `/api/*` 请求直接到达后端，无需额外代理配置。若需要跨域部署，可通过 `VITE_API_BASE_URL` 环境变量指定后端完整地址。

---

## 7. Ant Design 主题配置

主题配置在 `App.tsx` 的 `<ConfigProvider>` 中定义，采用低饱和度的灰色系风格：

### 全局 Token

| Token | 值 | 效果 |
|-------|----|------|
| `colorPrimary` | `#333` | 主色调为深灰色，非蓝色 |
| `borderRadius` | `4` | 统一使用 4px 圆角 |
| `colorBgContainer` | `#fff` | 容器背景为纯白 |
| `colorBorder` | `#e8e8e8` | 边框为浅灰色 |
| `colorText` | `#333` | 主文字为深灰色 |
| `colorTextSecondary` | `#999` | 次要文字为中灰色 |
| `fontSize` | `14` | 基础字号 14px |

### 组件级覆盖

**Menu（侧边栏导航）：**
- 选中项背景：`#f0f0f0`（浅灰）
- 普通项颜色：`#666`，悬停变为 `#333`
- 背景透明，与侧边栏白色底色融合

**Table（数据表格）：**
- 表头背景：`#fafafa`，颜色：`#666`
- 行悬停背景：`#f9f9f9`
- 边框颜色：`#f0f0f0`（极浅）

**Button（按钮）：**
- 默认按钮边框：`#e0e0e0`
- Primary 按钮文字：`#fff`（白色）

### 语言设置

使用 `locale={zhCN}`，Ant Design 组件（日期选择器、分页器等）的内置文字全部显示为中文。

---

## 8. 环境变量

### VITE_API_BASE_URL

| 属性 | 值 |
|------|----|
| 变量名 | `VITE_API_BASE_URL` |
| 类型 | 字符串 |
| 默认值 | `""` （空字符串） |
| 使用位置 | `src/api/client.ts` |

**配置方式：**

在项目根目录创建 `.env.local` 文件（该文件不应提交到 Git）：

```env
# 开发环境（通常留空，使用 Vite 代理）
VITE_API_BASE_URL=

# 生产或跨域环境（指向后端完整地址）
VITE_API_BASE_URL=https://api.example.com
```

**工作原理：**

```ts
// src/api/client.ts
const BASE_URL = import.meta.env.VITE_API_BASE_URL || "";

const adminClient = axios.create({
  baseURL: BASE_URL,
  // ...
});
```

- 当 `VITE_API_BASE_URL` 为空时，`baseURL` 为空字符串，所有请求使用相对路径，由 Vite 代理或 Nginx 处理
- 当 `VITE_API_BASE_URL` 设置为完整 URL 时，Axios 会将其作为所有请求的基础地址前缀

**注意：** 所有暴露给前端的 Vite 环境变量必须以 `VITE_` 前缀开头，否则不会被注入到浏览器运行时。
