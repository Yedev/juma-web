# 产品需求文档 (PRD) - 应用后台管理系统 V1.0

## 1. 产品概述
### 1.1 背景与目的
为配合移动端应用的任务调度与动态配置更新，需开发一套轻量级的后端服务与Web后台管理界面。系统采用**全栈 TypeScript** 架构，底层使用轻量级 **SQLite** 数据库。

### 1.2 核心目标
*   提供安全的Web后台管理（需登录认证）。
*   提供管理后台：查看所有任务状态、在线编辑JSON配置、**提供可视化API说明与在线测试面板**。
*   提供移动端API：获取JSON配置、任务触发、任务状态查询。
*   保障接口安全：使用**动态签名机制 (Sign)** 防止接口被恶意抓包和重放攻击。

---

## 2. 技术栈规范 (Technology Stack)
本项目要求采用全栈 TypeScript 开发：
*   **前端 (Web Admin)**：`Vite` + `React` + `TypeScript` + UI组件库 (推荐 `Ant Design` 或 `MUI`)。
*   **后端 (API Server)**：`Node.js` + `TypeScript` 框架 (推荐 `Express` 或 `NestJS`)。
*   **数据库**：`SQLite3` (使用 Prisma 或 TypeORM 作为 ORM 工具)。

---

## 3. 核心功能需求 (Functional Requirements)

### 3.1 权限与登录模块
*   **功能描述**：保护后台数据，拦截未授权访问。
*   **交互说明**：
    *   访问后台任何页面，若无登录态（Token/Session），重定向至 `/login`。
    *   输入账号密码登录，成功后跳转至【任务管理】页。
*   **预设数据**：
    *   **初始账号**：`juma`
    *   **初始密码**：`juma2026`

### 3.2 Web后台管理端
后台采用经典的“左侧菜单 + 右侧内容”布局。左侧导航菜单包含：【任务管理】、【配置管理】、【API接口说明】。

#### 3.2.1 任务管理 (Task Management)
*   **功能描述**：以只读列表形式展示移动端触发的所有任务记录。
*   **页面元素**：
    *   **数据表格**：列出 `任务ID`、`任务名称`、`任务参数`、`执行状态` (等待中/执行中/成功/失败)、`创建时间`、`更新时间`。
    *   **操作**：顶部提供【刷新列表】按钮。暂不提供删除和修改功能，保证日志的真实性。
    *   **分页**：单页显示 20 条。

#### 3.2.2 配置管理 (Configuration Management)
*   **功能描述**：用于在线查看和编辑提供给移动端的全局 JSON 配置。
*   **页面元素**：
    *   **JSON编辑器**：提供具有代码高亮、自动缩进和基础语法检查的代码编辑器组件（如 `Monaco Editor` 或 `react-json-view`）。
    *   **操作按钮**：【格式化】、【保存并发布】。
*   **交互逻辑**：
    *   点击保存时，前端需先进行 JSON 格式合法性校验，格式错误禁止提交并弹窗提示。

#### 3.2.3 API接口说明与调试 (API Docs & Playground) 🌟 *新增*
*   **功能描述**：类似轻量版 Swagger/Postman，供管理员/开发者查看接口文档，并直接在页面上模拟移动端发起调用。
*   **页面元素**：
    *   **接口列表**：折叠面板展示 3 个提供给移动端的接口。
    *   **接口详情**：展示请求 Method、URL、Header 要求及参数说明。
    *   **在线调试区**：
        *   提供表单输入请求参数。
        *   点击【发送请求】按钮。
        *   **黑科技功能**：前端在发送测试请求时，**自动根据当前时间计算并注入 `x-timestamp` 和 `x-sign` 请求头**，无需管理员手动计算 MD5。
        *   **响应展示区**：以 JSON 格式展示后端的返回结果及 HTTP 状态码。

---

## 4. 移动端接口与安全规范 (API & Security)

### 4.1 App端接口鉴权规范 (动态签名机制)
为了防止接口被抓包后无限刷库，所有提供给 App 的 `/api/v1/app/*` 接口必须在 HTTP Header 中携带签名。

*   **约定密钥**：客户端与服务端内置同一个固定的 `APP_SECRET`（如：`juma2026_secret`）。
*   **Header 要求**：
    1.  `x-timestamp`: 13位毫秒级时间戳 (例如 `1709000000000`)。
    2.  `x-sign`: 签名字符串，计算公式为 **`MD5(APP_SECRET + x-timestamp)`**，输出 32 位小写字母。
*   **后端校验逻辑 (Middleware拦截器)**：
    1.  校验 `x-timestamp` 是否存在，且与服务器当前时间误差不超过 **5分钟**，超过则返回 `403 Forbidden` (防重放攻击)。
    2.  后端用相同的 `APP_SECRET` 和接收到的 `x-timestamp` 计算 MD5，若与传入的 `x-sign` 不一致，则返回 `401 Unauthorized`。

### 4.2 移动端 API 列表

#### API 1: 获取应用配置
*   **URL**: `GET /api/v1/app/config`
*   **Header**: 需携带 `x-timestamp`, `x-sign`
*   **响应成功示例**:
    ```json
    {
      "code": 200,
      "message": "success",
      "data": { "version": "1.0", "theme": "dark" } // 数据库中读取的JSON
    }
    ```

#### API 2: 任务执行 (触发器)
*   **URL**: `POST /api/v1/app/task/execute`
*   **Header**: 需携带 `x-timestamp`, `x-sign`
*   **Body 参数**:
    ```json
    {
      "task_name": "数据分析任务",
      "task_params": { "target": "user_data" }
    }
    ```
*   **后端逻辑**：验证签名后，将任务插入 SQLite 数据库，状态设为 `pending` 或 `running`，返回新生成的 `task_id`。（目前阶段不需要写真正的执行逻辑代码）。
*   **响应成功示例**:
    ```json
    {
      "code": 200,
      "message": "任务已受理",
      "data": { "task_id": "T1709001234" }
    }
    ```

#### API 3: 任务状态查询
*   **URL**: `GET /api/v1/app/task/status`
*   **Header**: 需携带 `x-timestamp`, `x-sign`
*   **Query 参数**: `?task_id=T1709001234`
*   **响应成功示例**:
    ```json
    {
      "code": 200,
      "message": "success",
      "data": {
        "task_id": "T1709001234",
        "status": "running" // pending / running / success / failed
      }
    }
    ```

---

## 5. 数据库设计 (Database Schema - SQLite)

### 表1：`admin_users` (管理员用户表)
| 字段名 | 类型 | 说明 |
| :--- | :--- | :--- |
| `id` | INTEGER | 主键，自增 |
| `username` | VARCHAR | 账号 |
| `password` | VARCHAR | 密码哈希值 (使用 bcrypt 或 md5 存储) |
| `created_at`| DATETIME| 创建时间 |

### 表2：`app_configs` (应用配置表)
| 字段名 | 类型 | 说明 |
| :--- | :--- | :--- |
| `id` | INTEGER | 主键 |
| `config_key` | VARCHAR | 配置键名 (唯一，如 'global_json') |
| `config_value`| TEXT | JSON格式的字符串内容 |
| `updated_at`| DATETIME| 更新时间 |

### 表3：`tasks` (任务记录表)
| 字段名 | 类型 | 说明 |
| :--- | :--- | :--- |
| `id` | INTEGER | 主键，自增 |
| `task_id` | VARCHAR | 对外展示的唯一任务号 (如 T+时间戳+随机数) |
| `task_name` | VARCHAR | 任务名称 |
| `task_params` | TEXT | 任务参数 (JSON序列化存储) |
| `status` | VARCHAR | 状态: pending/running/success/failed |
| `created_at`| DATETIME| 任务创建时间 |
| `updated_at`| DATETIME| 任务更新时间 |

---

## 6. 开发实施建议
1.  **脚手架初始化**：
    *   前端：`npm create vite@latest admin-ui -- --template react-ts`
    *   后端：推荐直接使用 `Express` + `TypeScript` + `Prisma`（Prisma 对 SQLite 支持极好，且自动生成 TS 类型）。
2.  **API测试页面实现技巧**：前端可引入 `axios`，并封装一个专门用于 API 面板测试的实例，请求拦截器里引入 `md5` 库（如 `crypto-js`），拦截时自动追加 `x-timestamp` 和 `x-sign` 即可实现一键测试。