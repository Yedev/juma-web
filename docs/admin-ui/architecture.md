# admin-ui 架构文档

## 模块职责概述

`admin-ui` 是 JUMA 项目的管理后台前端模块，是一个基于 React 的单页应用（SPA）。其核心职责包括：

- **系统配置管理**：通过 Monaco 编辑器提供多 key 的 JSON 配置读写能力，支持格式化与校验
- **任务调度管理**：查看、创建、触发、删除分布式任务，查看任务执行日志与执行器客户端状态
- **API 文档与调试**：内置交互式 API 文档，支持自动签名注入和在线测试
- **DeepRead 内容管理**：管理 DeepRead 应用的空间、频道、文章和用户数据

整个应用无需服务端渲染，所有数据通过 Axios 调用后端 REST API 获取，认证状态通过 `localStorage` 中的 JWT Token 维持。

---

## 目录结构

```
admin-ui/
├── public/                  # 静态资源（favicon 等）
├── src/
│   ├── api/
│   │   └── client.ts        # Axios 实例，含请求/响应拦截器
│   ├── assets/              # 图片、SVG 等静态资源
│   ├── layouts/
│   │   └── AdminLayout.tsx  # 左侧导航栏 + 顶部标题栏 + 内容区布局
│   ├── pages/
│   │   ├── Login.tsx              # 登录页
│   │   ├── TaskManagement.tsx     # 任务管理页
│   │   ├── ConfigManagement.tsx   # 配置管理页
│   │   ├── ApiPlayground.tsx      # API 文档与调试页
│   │   ├── DrSpaceManagement.tsx  # DeepRead 空间管理
│   │   ├── DrChannelManagement.tsx # DeepRead 频道管理
│   │   ├── DrArticleManagement.tsx # DeepRead 文章管理
│   │   └── DrUserManagement.tsx   # DeepRead 用户管理
│   ├── utils/
│   │   └── sign.ts          # 签名生成工具（generateSign）
│   ├── App.tsx              # 路由配置、主题配置、RequireAuth 守卫
│   ├── main.tsx             # React 应用入口，挂载到 #root
│   └── index.css            # 全局基础样式
├── index.html               # Vite HTML 模板
├── vite.config.ts           # Vite 构建配置
├── tsconfig.json            # TypeScript 根配置
├── tsconfig.app.json        # 应用代码的 TypeScript 配置（严格模式）
├── tsconfig.node.json       # Vite 配置文件的 TypeScript 配置
├── package.json             # 依赖与脚本
└── eslint.config.js         # ESLint 配置
```

---

## 路由架构

### 路由树

```
/login                     → Login（不需要认证）
/                          → AdminLayout（RequireAuth 守卫包裹）
├── /                      → 重定向到 /tasks
├── /tasks                 → TaskManagement
├── /config                → ConfigManagement
├── /api-playground        → ApiPlayground
├── /dr/spaces             → DrSpaceManagement
├── /dr/channels           → DrChannelManagement
├── /dr/articles           → DrArticleManagement
└── /dr/users              → DrUserManagement
/*                         → 重定向到 /（兜底规则）
```

### 路由实现方式

路由使用 `react-router-dom v7` 的 `BrowserRouter` + `Routes` + `Route` 嵌套结构实现。`AdminLayout` 作为父路由的 `element`，其内部通过 `<Outlet />` 渲染子路由的页面组件。

### RequireAuth 守卫机制

`RequireAuth` 是定义在 `App.tsx` 中的一个简单守卫组件：

```tsx
function RequireAuth({ children }: { children: React.ReactNode }) {
  const token = localStorage.getItem("juma_token");
  if (!token) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
}
```

工作原理：
1. 每次渲染时从 `localStorage` 读取 `juma_token`
2. Token 不存在则立即重定向到 `/login`（使用 `replace` 以避免留下历史记录）
3. Token 存在则正常渲染子组件（即 `AdminLayout` 及其内部路由）

此守卫只做前端层面的跳转保护；真正的权限验证由后端通过 401 响应来实施（由 Axios 响应拦截器处理）。

---

## 认证流程

```
用户填写账号密码
        ↓
POST /api/auth/login
        ↓
后端返回 { code: 200, data: { token, username } }
        ↓
localStorage.setItem("juma_token", token)
localStorage.setItem("juma_username", username)
        ↓
navigate("/tasks")
        ↓
后续所有请求：Axios 请求拦截器自动读取 juma_token
并注入 Authorization: Bearer <token> 请求头
        ↓
后端返回 401（token 过期或无效）
        ↓
Axios 响应拦截器：
  localStorage.removeItem("juma_token")
  localStorage.removeItem("juma_username")
  window.location.href = "/login"
```

**关键存储键**：

| 键名 | 内容 | 用途 |
|---|---|---|
| `juma_token` | JWT Token 字符串 | 接口鉴权，Axios 自动注入 |
| `juma_username` | 用户名字符串 | 侧边栏底部显示当前用户名 |

**注销流程**：点击侧边栏底部"退出"按钮，`AdminLayout` 调用 `handleLogout`，清除两个 localStorage 键，并通过 `navigate("/login")` 跳转到登录页。

---

## 构建配置

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

- 开发服务器固定监听 **5173** 端口
- 所有 `/api/*` 路径在开发模式下通过 Vite 代理转发到 `http://localhost:3001`（后端服务）
- 生产构建使用 `tsc -b && vite build`，先进行 TypeScript 类型检查再打包

### TypeScript 配置（`tsconfig.app.json`）

启用了完整的严格模式组合：

| 选项 | 值 | 说明 |
|---|---|---|
| `strict` | `true` | 启用所有严格类型检查 |
| `noUnusedLocals` | `true` | 禁止未使用的局部变量 |
| `noUnusedParameters` | `true` | 禁止未使用的函数参数 |
| `noFallthroughCasesInSwitch` | `true` | switch 语句必须有 break/return |
| `erasableSyntaxOnly` | `true` | 仅允许可擦除的 TS 语法 |
| `noUncheckedSideEffectImports` | `true` | 禁止有副作用的无类型导入 |
| `target` | `ES2022` | 输出目标为现代浏览器 |
| `moduleResolution` | `bundler` | 适配 Vite 的模块解析方式 |

构建命令：
```bash
npm run dev      # 启动开发服务器（热更新）
npm run build    # 生产构建（先 tsc 类型检查，再 vite build）
npm run lint     # ESLint 检查
npm run preview  # 预览生产构建产物
```

---

## 与后端的交互方式

### 开发环境

所有请求路径以 `/api/` 开头，Vite devServer 通过代理转发到 `http://localhost:3001`：

```
浏览器 → localhost:5173/api/admin/configs
      → (Vite Proxy) → localhost:3001/api/admin/configs
```

### 生产环境

生产部署时，nginx 或其他反向代理负责将 `/api/*` 请求转发到后端服务。前端构建产物为纯静态文件，通过 `VITE_API_BASE_URL` 环境变量控制 API 根地址。

### API 路径规范

| 路径前缀 | 用途 |
|---|---|
| `/api/auth/` | 认证相关（登录） |
| `/api/admin/` | 后台管理接口（需 Bearer Token） |
| `/api/v1/app/` | 应用公开接口（需 x-timestamp + x-sign 签名） |

---

## Ant Design 主题配置

在 `App.tsx` 中通过 `ConfigProvider` 配置全局主题，整体风格为**低调灰色调**，避免使用 Ant Design 默认的蓝色主色：

```tsx
<ConfigProvider
  locale={zhCN}    // 全局中文语言包
  theme={{
    token: {
      colorPrimary: "#333",        // 主色调改为深灰
      borderRadius: 4,             // 统一圆角 4px
      colorBgContainer: "#fff",
      colorBorder: "#e8e8e8",
      colorText: "#333",
      colorTextSecondary: "#999",
      fontSize: 14,
    },
    components: {
      Menu: {
        itemBg: "transparent",
        itemSelectedBg: "#f0f0f0",
        itemSelectedColor: "#333",
        itemColor: "#666",
      },
      Table: {
        headerBg: "#fafafa",
        headerColor: "#666",
        rowHoverBg: "#f9f9f9",
        borderColor: "#f0f0f0",
      },
      Button: {
        defaultBorderColor: "#e0e0e0",
        primaryColor: "#fff",
      },
    },
  }}
>
```

locale 设置为 `zhCN`（`antd/locale/zh_CN`），使 DatePicker、Modal 确认/取消等组件自动显示中文。

---

## 环境变量

| 变量名 | 默认值 | 说明 |
|---|---|---|
| `VITE_API_BASE_URL` | `""` (空字符串) | Axios 实例的 baseURL，空字符串表示使用相对路径（适配 Vite proxy） |

在 `src/api/client.ts` 中读取：
```ts
const BASE_URL = import.meta.env.VITE_API_BASE_URL || "";
```

**开发时**：不需要配置此变量，Vite proxy 会处理 `/api` 转发。

**生产部署时**：若前端与后端不同域，需在构建前配置 `.env.production`：
```
VITE_API_BASE_URL=https://api.example.com
```

若同域部署（nginx 在同一域名下分流 `/api` 请求），保持空字符串即可，nginx 负责代理转发。

---

## 技术栈版本一览

| 技术 | 版本 | 说明 |
|---|---|---|
| React | 19.2.0 | 使用 StrictMode，函数式组件 + Hooks |
| Vite | 7.3.1 | 构建工具，开发服务器 |
| TypeScript | 5.9.3 | 完整严格模式 |
| Ant Design | 6.3.1 | UI 组件库，自定义灰色主题 |
| @ant-design/icons | 6.1.0 | 图标库 |
| react-router-dom | 7.13.1 | 客户端路由 |
| axios | 1.13.5 | HTTP 客户端 |
| @monaco-editor/react | 4.7.0 | 代码编辑器（Monaco） |
| crypto-js | 4.2.0 | MD5 签名生成 |
