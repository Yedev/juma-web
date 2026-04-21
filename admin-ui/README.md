# admin-ui

juma-web 管理后台前端，基于 React 19 + Vite 7 + Ant Design 6 + TypeScript。

## 开发

```bash
npm install
npm run dev    # http://localhost:5173，自动代理 /api 到 :3001
```

后端服务需先启动（`cd ../server && npm run dev`）。

## 构建

```bash
npm run build  # 输出到 dist/
```

## 主要页面

| 页面 | 说明 |
|------|------|
| TaskManagement | 任务管理、执行、日志 |
| ConfigManagement | JSON 配置编辑 |
| ApiPlayground | 交互式 API 测试 |
| DrSpaceManagement / DrSpaceDetail | DeepRead 空间与首页模块 |
| DrChannelManagement | 频道管理 |
| DrArticleManagement | 文章管理 |
| DrUserManagement | 用户管理 |
| DrCollectionManagement | 合集管理 |
| DrDailyPicksManagement | 每日精选 |
| DrAiConfig / DrAiQuotaManagement | AI 配置与配额 |
| AnalyticsEventManagement | 分析事件 |
| ImageHosting | 图片上传到 Aliyun OSS |

## 技术栈

| 库 | 用途 |
|----|------|
| React 19 | UI 框架 |
| Ant Design 6 | 组件库 |
| react-router-dom 7 | 路由 |
| axios | HTTP 客户端（JWT 自动注入） |
| Monaco Editor | 代码/HTML 编辑器 |
| react-markdown | Markdown 渲染 |
