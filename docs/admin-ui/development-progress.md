# admin-ui 开发进度与规范

## 当前版本页面完成状态

> 最后更新：2026-03-21

| 页面 | 路由 | 列表 | 新建 | 编辑 | 删除 | 搜索/筛选 | 分页 | 状态 |
|---|---|---|---|---|---|---|---|---|
| Login | `/login` | - | - | - | - | - | - | 完成 |
| TaskManagement | `/tasks` | 完成 | 完成 | - | 完成 | 完成（状态筛选） | 未分页 | 完成 |
| ConfigManagement | `/config` | 完成 | 完成 | 完成 | 完成 | - | - | 完成 |
| ApiPlayground | `/api-playground` | 完成 | - | - | - | - | - | 完成 |
| DrSpaceManagement | `/dr/spaces` | 完成 | 完成 | 完成 | 完成 | - | 未分页 | 完成 |
| DrChannelManagement | `/dr/channels` | 完成 | 完成 | 完成 | 完成 | 完成（空间筛选） | 未分页 | 完成 |
| DrArticleManagement | `/dr/articles` | 完成 | 完成 | 完成 | 完成 | 完成（空间/频道） | 完成 | 完成 |
| DrUserManagement | `/dr/users` | 完成 | 只读 | 只读 | 只读 | - | 完成 | 完成 |

---

## 各页面功能详细完成情况

### Login.tsx

- [x] 账号密码表单
- [x] 登录成功写入 localStorage（token + username）
- [x] 登录失败显示后端错误信息
- [x] 提交中 loading 防重复
- [ ] 记住密码功能
- [ ] 登录失败次数限制 / 验证码

### TaskManagement.tsx

- [x] 任务列表展示（状态、类型、时间、执行信息）
- [x] 状态筛选 Select（queued / running / error / completed）
- [x] 手动刷新列表
- [x] 新建任务 Modal（支持 server_task 和 client_task）
- [x] 触发已注册任务（从注册列表选择 + 自动填充参数）
- [x] 删除任务（Popconfirm 确认）
- [x] 查看执行日志 Modal
- [x] 状态附加信息展示（进度条、排队位置、错误信息、产物链接）
- [x] 执行器客户端状态面板（在线状态、心跳时间、任务统计）
- [ ] 任务列表分页（当前无分页，任务数量多时性能下降）
- [ ] 实时状态刷新（WebSocket 订阅任务状态变化）
- [ ] 任务搜索（按 taskId 或 taskName 模糊搜索）
- [ ] 批量删除已完成/错误任务

### ConfigManagement.tsx

- [x] 配置键列表（加载、显示 updatedAt）
- [x] 新建配置键（内联输入框 + 回车确认）
- [x] 删除配置键（Modal.confirm 确认）
- [x] Monaco 编辑器（JSON 语法高亮、错误标注）
- [x] 格式化功能（JSON pretty-print）
- [x] 保存并发布（保存前 JSON 校验）
- [ ] 配置历史版本查看与回滚
- [ ] 配置值 diff 对比
- [ ] 配置导入/导出（JSON 文件上传下载）

### ApiPlayground.tsx

- [x] 已注册 API 文档展示（GET/POST/PUT 接口）
- [x] curl 示例（含签名生成脚本）
- [x] 在线测试面板（参数填写 + 发送）
- [x] 自动签名注入（x-timestamp + x-sign）
- [x] Monaco 编辑器展示响应 JSON
- [ ] 动态从后端拉取 API 定义（当前为前端硬编码）
- [ ] 请求历史记录
- [ ] 支持 PUT/DELETE 方法测试

### DrSpaceManagement.tsx

- [x] 空间列表（含成员数、频道数、文章数统计）
- [x] 新建/编辑空间 Modal
- [x] 删除空间（Popconfirm）
- [x] 邀请码列表（含使用次数、过期时间、加入用户展开）
- [x] 创建邀请码（标签、最大使用次数、过期时间）
- [x] 禁用/启用邀请码
- [x] 复制邀请码到剪贴板
- [x] 成员列表 Modal（角色、加入时间）
- [ ] 踢出成员功能
- [ ] 空间转让（更换 owner）
- [ ] 空间列表分页（当前无分页）

### DrChannelManagement.tsx

- [x] 频道列表（含所属空间、排序权重、文章数）
- [x] 空间联动筛选（Select 过滤）
- [x] 新建/编辑频道 Modal（名称、所属空间、排序权重）
- [x] 删除频道（Popconfirm）
- [ ] 频道排序拖拽（当前只能手动填数字）
- [ ] 频道列表分页（当前无分页）

### DrArticleManagement.tsx

- [x] 文章列表（标题、摘要、作者、阅读数、收藏数）
- [x] 空间 + 频道级联筛选
- [x] 分页（每页 20 条，显示总数）
- [x] 新建/编辑文章 Drawer（含 Monaco HTML 编辑器）
- [x] 删除文章（Popconfirm）
- [x] 封面图 URL 字段
- [ ] 封面图上传（当前只支持填写 URL）
- [ ] 文章发布/下架状态切换
- [ ] 富文本编辑器替代方案（Monaco HTML 较底层）
- [ ] 文章预览功能

### DrUserManagement.tsx

- [x] 用户列表（手机号、昵称、空间数、高亮数）
- [x] 分页（每页 20 条）
- [x] 展开查看已加入空间（懒加载 + 缓存）
- [x] 展开行显示角色和加入时间
- [ ] 用户搜索（按手机号或昵称）
- [ ] 用户封禁功能
- [ ] 强制退出用户的所有会话

---

## 已知限制

### 架构层面

1. **无全局状态管理**：应用未引入 Redux、Zustand 或 React Context 等全局状态管理方案。各页面组件完全独立，在 `useEffect` 中各自 fetch 数据，导致：
   - 切换页面后数据不缓存，每次进入都重新请求
   - 跨页面共享数据（如空间列表）需要各页面分别请求
   - 不适合未来大量跨页面共享状态的场景

2. **无分页记忆**：翻页后切换到其他页面再返回，分页状态不保留（重置到第 1 页）

3. **无请求取消**：页面快速切换或组件卸载时，正在进行的请求不会被取消，可能触发已卸载组件更新 state 的 React 警告

4. **任务列表无实时更新**：任务状态（queued → running → completed）需要手动点击刷新按钮，无 WebSocket 推送

5. **API 文档为前端硬编码**：`ApiPlayground.tsx` 中的接口定义是静态的，后端新增 API 后需要手动在前端同步更新

### UI 层面

1. **无移动端适配**：布局为固定宽度的桌面端设计（左侧导航 200px），移动设备上无法正常使用
2. **无暗色模式**：Ant Design 主题固定为亮色，不支持跟随系统暗色模式切换
3. **无面包屑导航**：顶部标题栏仅显示当前页面名称，不显示层级路径

---

## 待开发功能建议

### 近期优先

| 功能 | 优先级 | 说明 |
|---|---|---|
| 任务列表分页 | 高 | 任务量增长后性能问题 |
| 用户搜索 | 高 | 用户量增长后必需 |
| 文章发布状态管理 | 高 | 内容运营基本需求 |
| 任务搜索 | 中 | 按 taskId/taskName 搜索 |
| 封面图上传 | 中 | 当前只能填 URL |

### 中期规划

| 功能 | 优先级 | 说明 |
|---|---|---|
| WebSocket 实时任务状态 | 中 | 自动刷新任务状态，无需手动点击 |
| 配置版本历史 | 中 | 防止误操作导致配置丢失 |
| 暗色模式 | 低 | Ant Design 支持切换，改造成本低 |
| 移动端响应式布局 | 低 | 侧边栏改为抽屉式 |
| 全局状态管理（Zustand） | 低 | 引入后可缓存常用数据减少请求 |

### 长期规划

| 功能 | 说明 |
|---|---|
| 操作审计日志 | 记录管理员的每次操作（创建/修改/删除） |
| 多管理员角色权限 | 超级管理员 / 内容管理员等角色分级 |
| 数据统计看板 | 任务执行趋势、用户增长趋势图表 |
| API 文档动态化 | 后端自动生成 OpenAPI 规范，前端动态渲染 |

---

## 开发规范

### 如何添加新页面

1. **创建页面文件**：在 `src/pages/` 下新建 `XxxManagement.tsx`，导出默认函数组件

2. **注册路由**：在 `src/App.tsx` 中导入组件，并在 `AdminLayout` 路由下添加子路由：
   ```tsx
   import XxxManagement from "./pages/XxxManagement";
   // ...
   <Route path="xxx" element={<XxxManagement />} />
   ```

3. **添加导航菜单项**：在 `src/layouts/AdminLayout.tsx` 的 `menuItems` 数组中添加条目：
   ```ts
   { key: "/xxx", icon: <SomeOutlined />, label: "Xxx管理" }
   ```
   并在 `pageTitle` 对象中添加对应的标题：
   ```ts
   "/xxx": "Xxx管理"
   ```

4. **添加 DeepRead 分组下的菜单项**：若属于 DeepRead 模块，在 `{ type: "divider", label: "DeepRead" }` 之后插入

### 如何调用 API

参见 `src/api/client.ts` 规范：
- 使用 `adminClient`（从 `../api/client` 导入）
- 采用 `useCallback` 包裹 fetch 函数，放入 `useEffect` 依赖数组
- 统一使用 `try/catch/finally` 模式管理 loading 状态
- 使用 `message.success/error` 显示操作反馈

### 组件规范

- **所有组件均为函数式组件**，不使用类组件
- **状态管理使用 React Hooks**（`useState`、`useEffect`、`useCallback`、`useMemo`）
- **类型定义**：每个页面顶部定义本页使用的 TypeScript interface，如 `SpaceRecord`、`ChannelRecord` 等
- **样式方案**：使用内联 `style` 对象 + Ant Design 组件属性，不使用 CSS 文件（保持组件自包含）
- **图标使用**：从 `@ant-design/icons` 按需导入，图标名称必须以 `Outlined` 结尾（使用描线风格）

### 新增 API 定义到 ApiPlayground

在 `src/pages/ApiPlayground.tsx` 的 `apiList` 数组中添加新的 `ApiDef` 对象：
```ts
{
  key: "N",              // 唯一字符串键
  method: "GET",         // 请求方法
  path: "/api/v1/app/new-endpoint",
  title: "接口标题",
  description: "接口说明",
  headers: "x-timestamp, x-sign",
  params: [
    { name: "param1", type: "string", desc: "参数说明", location: "query" }
  ],
  curlExample: `${signInitScript}\n\ncurl ...`,
}
```

---

## 依赖版本说明

### React 19.x 注意事项

- `React 19` 对 `StrictMode` 行为有调整：开发模式下 `useEffect` 会运行两次（mount → unmount → mount），确保副作用函数幂等
- `createRoot` 替代了旧的 `ReactDOM.render`，已在 `main.tsx` 中正确使用
- 无需导入 `React`（JSX transform 自动处理），但需要在使用 `React.ReactNode` 类型时导入

### Ant Design 6.x 注意事项

- Ant Design v6 与 v5 在 API 上有若干 Breaking Changes，组件属性命名更统一
- `ConfigProvider` 的 `theme` 配置结构与 v5 相同，`token` 和 `components` 分别对应全局 Token 和组件级覆盖
- `message` API 在 v6 中建议使用 `App.useApp()` 获取，但当前项目直接使用 `import { message } from "antd"` 的静态方法，功能正常，属于简化用法

### Monaco Editor 4.x 注意事项

- `@monaco-editor/react` 4.x 封装了 `monaco-editor` 核心，首次加载会通过 CDN 加载 Monaco Worker 文件（生产环境需确保网络可访问 CDN 或配置本地化）
- `Editor` 组件的 `onChange` 回调参数可能为 `undefined`（当编辑器内容被清空时），需要 `onChange={(v) => setValue(v || "")}` 处理
- `defaultLanguage` 和 `language` 的区别：`defaultLanguage` 仅初始化时生效（不响应后续变化），`language` 响应式更新

### TypeScript 5.9.x 注意事项

- `erasableSyntaxOnly: true` 要求不使用 `const enum`（使用普通 `enum` 或 `as const` 对象替代）
- `noUnusedLocals` 和 `noUnusedParameters` 在开发时可能较严格，需要在声明变量/参数时确保使用，未使用的可以加下划线前缀 `_` 来豁免
- `verbatimModuleSyntax: true` 要求类型导入使用 `import type { Foo }` 而非 `import { Foo }`（当仅导入类型时）
