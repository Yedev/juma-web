# 开发指南

## 目录

- [本地开发环境搭建](#本地开发环境搭建)
- [开发流程](#开发流程)
- [添加自定义任务](#添加自定义任务)
- [数据库操作](#数据库操作)
- [调试与测试](#调试与测试)
- [代码规范](#代码规范)

---

## 本地开发环境搭建

### 前提条件

| 工具 | 最低版本 | 说明 |
|------|----------|------|
| Node.js | 22.0.0 | 建议使用 LTS 版本 |
| npm | 10.0.0 | 随 Node.js 安装 |
| Git | 2.30+ | 版本控制 |

### 克隆并初始化项目

```bash
git clone <repo-url>
cd juma-web

# 安装后端依赖
cd server
npm install

# 初始化数据库
npx prisma generate      # 生成 Prisma Client
npx prisma db push       # 创建数据库表
npm run db:seed          # 写入种子数据

# 安装前端依赖
cd ../admin-ui
npm install
```

### 启动开发服务器

**方式一：分窗口运行**

```bash
# 终端 1：启动后端（支持热重载）
cd server
npm run dev

# 终端 2：启动前端（支持 HMR）
cd admin-ui
npm run dev
```

**方式二：使用 tmux**

```bash
tmux new-session -d -s juma
tmux send-keys -t juma "cd server && npm run dev" Enter
tmux split-window -t juma
tmux send-keys -t juma "cd admin-ui && npm run dev" Enter
tmux attach -t juma
```

**访问地址：**
- 后端 API：http://localhost:3001
- 管理后台：http://localhost:5173
- 健康检查：http://localhost:3001/api/health

### 可选：启动执行器客户端

```bash
cd mac-mini-client
npm install

# 配置环境变量后启动
SERVER_URL="http://localhost:3001" \
EXECUTOR_KEY="juma_executor_2026" \
CLIENT_ID="dev-executor-01" \
CLIENT_NAME="Dev Executor" \
CLIENT_TAGS="xcode,ios" \
npm start
```

---

## 开发流程

### 后端开发流程

1. **修改路由**（`server/src/routes/`）
2. **修改业务逻辑**（`server/src/services/`）
3. **修改数据库 Schema**（`server/prisma/schema.prisma`）→ 运行 `npx prisma db push`
4. 服务器通过 `tsx watch` 自动热重载

### 前端开发流程

1. **新增页面**：在 `admin-ui/src/pages/` 下创建组件
2. **注册路由**：在 `admin-ui/src/App.tsx` 中添加 `<Route>`
3. **调用 API**：使用 `admin-ui/src/api/client.ts` 中的 axios 实例
4. Vite 支持 HMR，保存即刷新

### API 请求模板（前端）

```typescript
// admin-ui/src/pages/YourPage.tsx
import { useState, useEffect } from 'react'
import api from '../api/client'

interface MyData {
  id: number
  name: string
}

export default function YourPage() {
  const [data, setData] = useState<MyData[]>([])
  const [loading, setLoading] = useState(false)

  const fetchData = async () => {
    setLoading(true)
    try {
      const res = await api.get('/api/admin/your-endpoint')
      setData(res.data.data.items)
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
  }, [])

  return <div>...</div>
}
```

---

## 添加自定义任务

### 1. 添加服务端任务（server.*）

**步骤一：在 `taskRegistry.ts` 中注册任务定义**

```typescript
// server/src/services/taskRegistry.ts

const registeredTasks: RegisteredTaskDefinition[] = [
  // ... 现有任务 ...
  {
    taskName: "server.send_report",
    taskType: "server_task",
    description: "生成并发送日报",
    paramsSchema: {
      report_date: {
        type: "string",
        description: "报告日期（YYYY-MM-DD）",
        example: "2026-03-01"
      },
      recipients: {
        type: "array",
        description: "收件人邮箱列表",
        example: ["admin@example.com"]
      }
    },
    examplePayload: {
      report_date: "2026-03-01",
      recipients: ["admin@example.com"]
    }
  }
]
```

**步骤二：在 `serverTaskRuntime.ts` 中实现执行逻辑**

```typescript
// server/src/services/serverTaskRuntime.ts

export async function executeServerTaskByName(
  taskName: string,
  payload: any,
  logCallback: (log: string) => void
): Promise<{ resultCode: number; statusInfo?: any }> {

  switch (taskName) {
    case 'server.echo':
      return executeEchoTask(payload, logCallback)

    // 新增：
    case 'server.send_report':
      return executeSendReportTask(payload, logCallback)

    default:
      throw new Error(`未知任务: ${taskName}`)
  }
}

async function executeSendReportTask(
  payload: { report_date: string; recipients: string[] },
  log: (msg: string) => void
): Promise<{ resultCode: number; statusInfo?: any }> {
  const { report_date, recipients } = payload

  log(`[${new Date().toISOString()}] 开始生成报告: ${report_date}`)

  // 业务逻辑实现
  // const report = await generateReport(report_date)
  // await sendEmail(recipients, report)

  log(`[${new Date().toISOString()}] 报告已发送至: ${recipients.join(', ')}`)

  return {
    resultCode: 0,
    statusInfo: { sent_to: recipients, report_date }
  }
}
```

### 2. 添加客户端任务（client.*）

**步骤一：在 `taskRegistry.ts` 中注册任务定义**

```typescript
{
  taskName: "client.ios_build",
  taskType: "client_task",
  description: "在 Mac Mini 上触发 iOS 构建",
  paramsSchema: {
    payload: {
      type: "object",
      description: "构建参数",
      example: {
        branch: "main",
        scheme: "MyApp",
        configuration: "Release"
      }
    },
    required_tags: {
      type: "array",
      description: "执行器必须具备的标签",
      example: ["xcode", "ios"]
    }
  },
  examplePayload: {
    payload: { branch: "main", scheme: "MyApp", configuration: "Release" },
    required_tags: ["xcode"]
  }
}
```

**步骤二：在 `mac-mini-client/tasks/` 中实现执行逻辑**

```javascript
// mac-mini-client/tasks/iosBuild.js

module.exports = {
  taskName: 'client.ios_build',

  async execute(payload, { log, updateStatus }) {
    const { branch, scheme, configuration } = payload.payload || {}

    await updateStatus('running', { step: '拉取代码', progress: 10 })
    log(`[INFO] 开始构建: ${scheme} (${configuration})`)

    // 执行构建命令
    // const result = await runCommand(`xcodebuild -scheme ${scheme} ...`)

    log(`[INFO] 构建完成`)
    await updateStatus('completed', {
      step: '完成',
      progress: 100,
      output_json: { success: true, artifact: '/path/to/app.ipa' }
    })
  }
}
```

---

## 数据库操作

### 常用 Prisma 命令

```bash
# 在 server/ 目录下执行

# 修改 schema 后同步到数据库（开发用，会丢失数据）
npx prisma db push

# 生成迁移文件（生产环境推荐）
npx prisma migrate dev --name add_new_field

# 查看数据库内容（可视化）
npx prisma studio
# 打开 http://localhost:5555

# 重新生成 Prisma Client（修改 schema 后）
npx prisma generate

# 运行种子脚本
npm run db:seed
# 等价于: npx prisma db seed
```

### 添加新字段示例

1. **修改 Schema**（`server/prisma/schema.prisma`）：

```prisma
model Task {
  id          Int      @id @default(autoincrement())
  taskId      String   @unique
  // ... 现有字段 ...
  priority    Int      @default(0)    // 新增字段
}
```

2. **同步数据库**：

```bash
cd server
npx prisma db push          # 开发环境
# 或
npx prisma migrate dev --name add_task_priority  # 生产环境
```

3. **更新 Prisma Client**：

```bash
npx prisma generate
```

### 种子数据修改

编辑 `server/src/prisma/seed.ts`，然后：

```bash
cd server
npm run db:seed
```

> 注意：种子脚本会跳过已存在的记录（使用 `upsert`），不会覆盖现有数据。

---

## 调试与测试

### 后端调试

**使用 VS Code 调试器：**

```json
// .vscode/launch.json
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "node",
      "request": "launch",
      "name": "Debug Server",
      "runtimeExecutable": "npx",
      "runtimeArgs": ["tsx", "src/index.ts"],
      "cwd": "${workspaceFolder}/server",
      "env": {
        "NODE_ENV": "development"
      }
    }
  ]
}
```

**查看日志：**
```bash
# 实时查看服务器日志
cd server
npm run dev 2>&1 | tee server.log
```

### 手动测试 API

**使用内置 API Playground：**
1. 访问 http://localhost:5173/api-playground
2. 选择接口类型
3. 填写参数，点击"发送请求"（自动注入签名）

**使用 curl 脚本：**

```bash
# 设置公共变量
APP_SECRET="juma2026_secret"
BASE_URL="http://localhost:3001"

# 获取管理员 Token
ADMIN_TOKEN=$(curl -s -X POST "${BASE_URL}/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"username":"juma","password":"juma2026"}' | \
  python3 -c "import sys,json; print(json.load(sys.stdin)['data']['token'])")

echo "Admin Token: ${ADMIN_TOKEN}"

# 使用 Token 调用管理接口
curl "${BASE_URL}/api/admin/tasks?page=1&page_size=5" \
  -H "Authorization: Bearer ${ADMIN_TOKEN}" | python3 -m json.tool
```

### 测试签名机制

```bash
# 测试 x-sign
APP_SECRET="juma2026_secret"
TS=$(date +%s%3N)
SIGN=$(printf "%s" "${APP_SECRET}${TS}" | md5sum | awk '{print $1}')

echo "Timestamp: ${TS}"
echo "Sign: ${SIGN}"

curl "${BASE_URL}/api/v1/app/config" \
  -H "x-timestamp: ${TS}" \
  -H "x-sign: ${SIGN}"

# 测试过期时间戳（应返回 403）
OLD_TS=1000000000000
OLD_SIGN=$(printf "%s" "${APP_SECRET}${OLD_TS}" | md5sum | awk '{print $1}')
curl "${BASE_URL}/api/v1/app/config" \
  -H "x-timestamp: ${OLD_TS}" \
  -H "x-sign: ${OLD_SIGN}"
```

### WebSocket 调试

```javascript
// 在浏览器控制台或 Node.js 中测试 WebSocket 连接
const ws = new WebSocket('ws://localhost:3001/ws/executor?key=juma_executor_2026')

ws.onopen = () => {
  console.log('Connected!')
  ws.send(JSON.stringify({
    type: 'client.hello',
    payload: {
      client_id: 'debug-client-01',
      client_name: 'Debug Client',
      platform: 'darwin',
      app_version: '1.0.0',
      tasks: ['client.echo', 'client.mock3s'],
      tags: ['debug'],
      capabilities: {}
    }
  }))
}

ws.onmessage = (e) => {
  console.log('Received:', JSON.parse(e.data))
}

ws.onerror = (e) => console.error('Error:', e)
```

---

## 代码规范

### TypeScript 规范

- 所有新代码使用 TypeScript，开启严格模式
- 接口定义放在使用文件顶部或单独的 `types.ts` 文件
- 避免使用 `any`，使用 `unknown` 配合类型守卫

### API 路由规范

- 路由处理函数保持精简，业务逻辑抽取到 `services/`
- 错误统一使用 `try-catch`，返回标准格式：
  ```typescript
  res.json({ code: 500, message: '服务器错误', data: null })
  ```
- 数据库查询放在路由函数内（避免过度抽象）

### 任务命名规范

| 类型 | 格式 | 示例 |
|------|------|------|
| 服务端任务 | `server.<动词>_<名词>` | `server.send_report`, `server.sync_index` |
| 客户端任务 | `client.<动词>_<名词>` | `client.ios_build`, `client.run_tests` |

### Git 提交规范

```
feat: 添加 iOS 构建任务
fix: 修复签名验证时区问题
docs: 更新 API 文档
refactor: 重构任务执行引擎
chore: 升级 Prisma 依赖
```

### 环境变量规范

- 所有敏感配置通过环境变量注入，不硬编码
- 在 `src/index.ts` 或各模块顶部读取环境变量，提供合理默认值
- 生产环境必须覆盖所有默认密钥
