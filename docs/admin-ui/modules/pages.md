# admin-ui 页面模块详解

本文档对 `admin-ui` 中的全部 8 个页面进行详细说明，包括功能描述、使用的 API 接口、关键交互逻辑和组件状态管理。

---

## 1. Login.tsx — 登录页

**路由**：`/login`（不受 RequireAuth 守卫保护）

### 功能描述

登录页是整个管理后台的入口，提供账号密码登录表单。页面以居中卡片形式展示，背景为浅灰色（`#f5f5f5`），卡片宽度固定 360px。

### 页面结构

- 顶部 JUMA 标志 + 副标题"应用后台管理系统"
- Ant Design `Form` 表单，包含：
  - `username` 字段（必填，账号输入框）
  - `password` 字段（必填，密码输入框，使用 `Input.Password`）
  - 登录按钮（深灰色 `#333`，全宽，加载中状态）

### 使用的 API

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/auth/login` | 登录验证，返回 token 和 username |

请求体：
```json
{ "username": "admin", "password": "xxxx" }
```

成功响应：
```json
{ "code": 200, "data": { "token": "eyJ...", "username": "admin" } }
```

### 关键逻辑

1. 表单提交后调用 `adminClient.post("/api/auth/login", values)`
2. 响应 `code === 200` 时将 `token` 和 `username` 写入 `localStorage`
3. 调用 `navigate("/tasks")` 跳转到任务管理页
4. 登录失败时显示后端返回的 `message` 字段，或兜底提示"登录失败"
5. 整个提交过程由 `loading` state 控制按钮的 loading 态，防止重复提交

---

## 2. TaskManagement.tsx — 任务管理页

**路由**：`/tasks`

### 功能描述

任务管理是功能最复杂的页面，提供对后端分布式任务系统的完整管理界面，分为上下两个区域：

- **上方**：任务列表表格，支持筛选、创建、触发、删除任务，以及查看执行日志
- **下方**：执行器客户端状态面板，展示当前在线的 Executor Client 信息

### 任务列表功能

**任务状态**（`status` 字段）：
| 状态 | 显示文字 | 颜色 |
|---|---|---|
| `queued` | 排队中 | 灰色 |
| `running` | 执行中 | 蓝色（含旋转图标） |
| `error` | 执行错误 | 红色 |
| `completed` | 执行完成 | 绿色 |

**任务类型**（`taskType` 字段）：
| 类型 | 显示文字 | 颜色 |
|---|---|---|
| `server_task` | 服务器执行 | 紫色 `#722ed1` |
| `client_task` | 客户端执行 | 蓝色 `#1677ff` |

**StatusExtra 组件**：根据任务状态和 `statusInfo` 字段显示不同的辅助信息：
- `queued` + `queue_position`：显示"前方排队 N 个"
- `running` + `current_step`：显示当前执行步骤名称和进度条
- `running` + 客户端执行器：显示"客户端 {clientId} 执行中"
- `error` + `error`：显示错误摘要（Tooltip 悬浮完整错误信息）
- `completed` + `output_json`：显示"查看服务返回 JSON"（Tooltip 显示完整 JSON）
- `completed` + `output_url`：显示产物链接、文件大小、行数等

**状态筛选**：顶部 Select 下拉可按状态筛选任务列表（选项包括全部 + 4 种状态）

**刷新**：顶部刷新按钮手动触发列表重新加载

### 创建任务

点击"新建任务"按钮，打开 Modal 对话框：
- 选择任务名称（来自已注册任务列表 `registeredTasks`，下拉选择后自动填充示例参数）
- 任务类型（自动联动展示，不可手动选择）
- 目标客户端 ID（`client_task` 类型时可选，指定特定执行器）
- 任务参数 JSON（文本框，自动填充 `exampleTaskPayload`，可手动修改）
- 附加参数 JSON（可选，透传到执行器的额外参数）
- 最大重试次数（InputNumber，默认 0）

提交前校验任务参数和附加参数必须是合法 JSON 对象（`parseJsonObject` 函数）。

### 触发已注册任务

"触发任务"按钮打开另一个 Modal，从已注册的任务定义中选择 task，自动填充参数定义表格和 `exampleTaskPayload`，一键触发创建。

### 删除任务

每行末尾有 `Popconfirm` 确认删除按钮（`DeleteOutlined`），确认后调用删除接口。

### 日志弹窗

每行末尾有查看日志按钮（`FileTextOutlined`），点击后打开 Modal 展示该任务的 `executionLog` 原始文本，使用等宽字体（`monospace`）显示，支持滚动。

### 执行器客户端状态面板

页面下方固定高度区域，展示所有注册的 Executor Client：
- 客户端 ID、名称、平台、版本、IP 地址、标签（Tags）
- 支持的任务列表（`tasks` 数组）
- 在线状态（`status` 字段）
- 最后心跳时间
- 累计认领/成功/失败任务计数

### 使用的 API

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/admin/tasks` | 获取任务列表（可选 `status` 筛选参数） |
| POST | `/api/admin/tasks` | 创建新任务 |
| DELETE | `/api/admin/tasks/:taskId` | 删除任务 |
| GET | `/api/admin/tasks/:taskId/log` | 获取任务执行日志 |
| GET | `/api/admin/executor-clients` | 获取执行器客户端列表 |
| GET | `/api/admin/registered-tasks` | 获取已注册的任务定义列表 |
| POST | `/api/admin/tasks/trigger` | 触发已注册任务 |

---

## 3. ConfigManagement.tsx — 配置管理页

**路由**：`/config`

### 功能描述

配置管理页提供后台系统配置的 CRUD 操作，采用左右分栏布局：左侧为配置键名列表，右侧为 Monaco 编辑器展示和编辑对应键的 JSON 值。

### 左侧：配置键列表

- 页面加载时自动获取所有配置键（`GET /api/admin/configs`），渲染为可点击列表
- 默认自动选中第一个键并加载其值
- 列表顶部有"新建"按钮（`PlusOutlined`），点击后在列表顶部显示内联输入框
- 新建键：在输入框输入键名后按回车，调用 PUT 接口以空对象 `{}` 为初始值创建
- 删除键：鼠标悬停列表项时右侧出现删除图标（`DeleteOutlined`），点击后弹出 `Modal.confirm` 二次确认，确认后调用删除接口
- 切换键：点击列表项触发 `handleSelectKey`，加载对应键的 JSON 值

### 右侧：Monaco 编辑器

使用 `@monaco-editor/react` 的 `Editor` 组件，配置如下：
- 语言模式：`json`（语法高亮 + 内置 JSON 错误提示）
- 关闭缩略图（`minimap: { enabled: false }`）
- 字体：SF Mono / Fira Code / Menlo 等等宽字体，字号 13px
- Tab 缩进 2 个空格
- `formatOnPaste: true`（粘贴时自动格式化）
- 滚动条细化（宽度 6px）

### 工具栏操作

右侧编辑区顶部工具栏：

| 操作 | 说明 |
|---|---|
| 格式化 | 调用 `JSON.parse` + `JSON.stringify(…, null, 2)` 格式化当前内容；若 JSON 不合法则提示错误 |
| 保存并发布 | 校验 JSON 合法性 → 调用 PUT 接口保存 → 成功后刷新左侧列表（更新 `updatedAt`） |

保存前强制校验 JSON 格式，不合法则阻止提交并提示"JSON 格式不合法，请修正后再保存"。

### 使用的 API

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/admin/configs` | 获取配置键列表（含 id、configKey、updatedAt） |
| GET | `/api/admin/config/:key` | 获取指定键的 JSON 值 |
| PUT | `/api/admin/config/:key` | 创建或更新指定键的值，body 为 `{ configValue: "..." }` |
| DELETE | `/api/admin/config/:key` | 删除指定键 |

key 在路径中使用 `encodeURIComponent` 编码，支持含特殊字符的键名。

---

## 4. ApiPlayground.tsx — API 接口说明页

**路由**：`/api-playground`

### 功能描述

API Playground 是一个内置的交互式 API 文档与测试工具，无需外部 Swagger/Postman，直接在管理后台内提供：
- 所有公开 API 的文档说明（路径、方法、参数、curl 示例）
- 在线测试面板（填写参数 → 自动注入签名 → 发送请求 → 显示响应）

### 页面布局

左右两栏布局：
- **左侧**：API 列表，点击展开/折叠各接口的详情（手风琴样式，`expandedKey` 控制）
- **右侧**：测试面板，包含选中接口的参数填写表单和响应结果显示（Monaco 编辑器展示 JSON 响应）

### 已内置的 API 定义（`apiList`）

| key | 方法 | 路径 | 说明 |
|---|---|---|---|
| 1 | GET | `/api/v1/app/config` | 获取应用配置（按 key） |
| 2 | GET | `/api/v1/app/task/catalog` | 查询支持任务列表 |
| 3 | POST | `/api/v1/app/task/execute` | 任务执行触发器 |

每个接口定义包含：`method`、`path`、`title`、`description`、`headers`、`params`（含参数名、类型、说明、位置 query/body）、`bodyExample`、`curlExample`。

### 自动签名注入原理

所有 `/api/v1/app/` 公开接口需要签名验证，测试面板在发送请求前自动调用 `generateSign()`：

```ts
import { generateSign } from "../utils/sign";

const { timestamp, sign } = generateSign();
// 注入到请求头：
// x-timestamp: <13位毫秒时间戳>
// x-sign: MD5(APP_SECRET + timestamp)
```

curl 示例代码中也内置了完整的签名生成脚本（shell 版本），方便开发者复制到终端直接运行：

```bash
APP_SECRET="juma2026_secret"
BASE_URL="http://localhost:3001"
TS=$(date +%s%3N)
SIGN=$(printf "%s" "${APP_SECRET}${TS}" | md5sum | awk '{print $1}')
```

### 测试面板交互

1. 在左侧点击某个接口 → 右侧测试面板激活
2. 根据接口定义渲染参数表单（query 参数和 body 参数分组显示）
3. 点击"发送"按钮：
   - 调用 `generateSign()` 生成 `timestamp` 和 `sign`
   - 使用 `axios`（直接导入，非 adminClient）发送请求，注入 `x-timestamp` 和 `x-sign` 请求头
   - 响应结果（JSON）展示在右侧 Monaco 编辑器中（只读模式）
4. 发送失败时将错误响应体也展示在编辑器中，方便调试

注意：测试面板使用 `BASE_URL` 作为请求基础地址（从 `src/api/client.ts` 导出），而非 adminClient，因为公开接口不需要 Bearer Token。

---

## 5. DrSpaceManagement.tsx — DeepRead 空间管理

**路由**：`/dr/spaces`

### 功能描述

管理 DeepRead 应用的"空间"（Space）实体，空间是 DeepRead 内容组织的顶层单位，下属频道和文章。

### 功能列表

**空间 CRUD**：
- 列表展示：spaceId、名称、描述、成员数、频道数、文章数、创建时间
- 新建/编辑：Modal 表单，字段包括名称（必填）和描述
- 删除：`Popconfirm` 二次确认后删除

**邀请码管理**（点击"邀请码"按钮）：
- 打开邀请码列表 Modal，展示该空间的所有邀请码
- 每条邀请码信息：码值（可一键复制）、标签、最大使用次数、已使用次数、过期时间、是否禁用、通过该码加入的用户列表（展开查看）
- 创建新邀请码：嵌套 Modal，填写标签、最大使用次数（可为空=无限制）、过期时间（DatePicker，可为空=永不过期）
- 禁用/启用邀请码：切换 `disabled` 状态
- 复制邀请码：使用 `navigator.clipboard.writeText` 复制到剪贴板，显示 success 提示

**成员查看**（点击"成员"按钮）：
- 打开成员列表 Modal，展示该空间的所有成员
- 信息：用户 ID、手机号、昵称、角色（owner/member 等）、加入时间

### 使用的 API

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/admin/dr/spaces` | 获取空间列表 |
| POST | `/api/admin/dr/spaces` | 创建空间 |
| PUT | `/api/admin/dr/spaces/:spaceId` | 更新空间信息 |
| DELETE | `/api/admin/dr/spaces/:spaceId` | 删除空间 |
| GET | `/api/admin/dr/spaces/:spaceId/members` | 获取空间成员列表 |
| GET | `/api/admin/dr/spaces/:spaceId/invite-codes` | 获取空间邀请码列表 |
| POST | `/api/admin/dr/spaces/:spaceId/invite-codes` | 创建邀请码 |
| PUT | `/api/admin/dr/invite-codes/:codeId` | 更新邀请码（禁用/启用） |

---

## 6. DrChannelManagement.tsx — DeepRead 频道管理

**路由**：`/dr/channels`

### 功能描述

管理 DeepRead 应用的"频道"（Channel）实体。频道属于某个空间，是文章的分类容器，支持排序。

### 功能列表

**空间联动筛选**：
- 页面顶部有空间 Select 下拉，列出所有空间
- 选择空间后，频道列表自动过滤只显示该空间下的频道
- 未选择空间时显示所有频道

**频道 CRUD**：
- 列表展示：channelId、频道名、所属空间（spaceId）、排序权重（sortOrder）、文章数、创建时间
- 新建/编辑：Modal 表单，字段包括：频道名（必填）、所属空间（Select，必填）、排序权重（InputNumber，默认 0）
- 删除：`Popconfirm` 二次确认后删除

**排序权重说明**：`sortOrder` 值越小排序越靠前，可用于控制频道在客户端的展示顺序。

### 使用的 API

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/admin/dr/spaces` | 获取空间列表（用于筛选下拉和表单选择） |
| GET | `/api/admin/dr/channels` | 获取频道列表（可选 `space_id` 查询参数） |
| POST | `/api/admin/dr/channels` | 创建频道 |
| PUT | `/api/admin/dr/channels/:channelId` | 更新频道信息 |
| DELETE | `/api/admin/dr/channels/:channelId` | 删除频道 |

---

## 7. DrArticleManagement.tsx — DeepRead 文章管理

**路由**：`/dr/articles`

### 功能描述

管理 DeepRead 应用的"文章"（Article）实体，功能最丰富的 DeepRead 管理页，支持分页、级联筛选和 Monaco HTML 编辑器。

### 功能列表

**空间/频道级联筛选**：
- 顶部有两个 Select：空间筛选 + 频道筛选
- 选择空间后，频道 Select 自动加载该空间下的频道列表（级联联动）
- 可单独按空间筛选，也可同时按空间+频道筛选
- 筛选条件变化时重新加载列表并重置分页到第 1 页

**文章列表**（带分页）：
- 展示：articleId、标题（`title`）、摘要（`summary`，截断显示）、封面图（`coverUrl`）、布局类型（`layoutType`）、作者、阅读数、收藏数、发布时间
- 支持分页（`page` + `page_size`），默认每页 20 条，显示总数

**文章 CRUD**（使用 Drawer 侧抽屉而非 Modal，因为编辑内容较多）：
- 新建/编辑时打开右侧 Drawer
- 表单字段：标题、摘要、作者、封面 URL、所属空间（必填，Select）、所属频道（必填，Select，联动空间）、布局类型（`default` 等）
- **HTML 内容编辑器**：Drawer 下方嵌入 Monaco Editor，语言模式为 `html`，高度 400px，用于编辑 `contentHtml` 字段

**Monaco HTML 编辑器配置**：
```ts
<Editor
  height="400px"
  defaultLanguage="html"
  value={formContentHtml}
  onChange={(v) => setFormContentHtml(v || "")}
  options={{
    minimap: { enabled: false },
    fontSize: 13,
    fontFamily: "'SF Mono', 'Fira Code', 'Menlo', monospace",
    wordWrap: "on",
    tabSize: 2,
  }}
/>
```

- 删除：列表行内 `Popconfirm` 二次确认

### 使用的 API

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/admin/dr/spaces` | 获取空间列表 |
| GET | `/api/admin/dr/channels` | 获取频道列表（含 `space_id` 参数） |
| GET | `/api/admin/dr/articles` | 获取文章列表（可选 `space_id`、`channel_id`、`page`、`page_size`） |
| GET | `/api/admin/dr/articles/:articleId` | 获取文章详情（含 `contentHtml`） |
| POST | `/api/admin/dr/articles` | 创建文章 |
| PUT | `/api/admin/dr/articles/:articleId` | 更新文章 |
| DELETE | `/api/admin/dr/articles/:articleId` | 删除文章 |

---

## 8. DrUserManagement.tsx — DeepRead 用户管理

**路由**：`/dr/users`

### 功能描述

DeepRead 用户管理页面为**只读**模式，不提供创建、编辑或删除用户的操作，仅用于查看用户信息。这是因为用户账号由用户自主通过 DeepRead 客户端注册，管理员不应直接创建或修改用户数据。

### 功能列表

**用户列表**（带分页）：
- 字段展示：用户 ID（`id`）、手机号（`phone`）、昵称（`nickname`）、头像（`avatar`，URL）、加入空间数（`spaceCount`）、高亮数（`highlightCount`）、注册时间
- 分页：每页 20 条，显示总数

**展开查看已加入空间**：
- 每行支持展开（`expandedRowRender`）
- 展开时触发 `handleExpand`，懒加载该用户的空间列表（`GET /api/admin/dr/users/:id`）
- 已加载过的用户空间数据缓存在 `expandedSpaces` state 中，再次展开不重复请求
- 展示信息：空间 ID（`spaceId`）、空间名称（`spaceName`）、用户在该空间的角色（`role`）、加入时间（`joinedAt`）
- 加载中状态由 `expandLoading` state 独立控制每行

### 使用的 API

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/admin/dr/users` | 获取用户列表（`page`、`page_size` 分页参数） |
| GET | `/api/admin/dr/users/:id` | 获取用户详情（含已加入的空间列表） |

### 状态管理细节

```ts
const [expandedSpaces, setExpandedSpaces] = useState<Record<number, UserSpace[]>>({});
const [expandLoading, setExpandLoading] = useState<Record<number, boolean>>({});
```

两个 `Record<number, ...>` 类型的 state 分别以用户 `id` 为键，实现按行的懒加载与缓存。展开时检查 `expandedSpaces[record.id]` 是否已存在，若存在则跳过请求直接渲染。
