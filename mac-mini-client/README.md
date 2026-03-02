# Mac Mini 执行客户端

用于无公网 IP 的 Mac Mini 主动连接服务器执行任务。

## 运行要求

- Node.js 18+
- 能访问后端地址（例如 `http://your-server:3001`）

## 启动

```bash
cd mac-mini-client
npm start
```

## 环境变量

| 变量名 | 说明 | 默认值 |
|---|---|---|
| `SERVER_URL` | 服务端地址 | `http://localhost:3001` |
| `EXECUTOR_KEY` | 执行器共享密钥（需与服务端一致） | `juma_executor_2026` |
| `CLIENT_ID` | 客户端唯一 ID | `macmini-主机名-随机后缀` |
| `CLIENT_NAME` | 客户端显示名称 | 主机名 |
| `CLIENT_TAGS` | 客户端标签，逗号分隔（如 `xcode,ios`） | 空 |
| `CLIENT_VERSION` | 客户端版本号 | `1.0.0` |
| `WORK_DIR` | 脚本执行目录 | 当前目录 |
| `POLL_INTERVAL_MS` | 拉任务间隔 | `4000` |
| `HEARTBEAT_INTERVAL_MS` | 心跳间隔 | `10000` |

## 任务执行流程

1. 客户端注册 `/api/executor/register`
2. 定时心跳 `/api/executor/heartbeat`
3. 主动拉取任务 `/api/executor/next-task`
4. 执行脚本后回传 `/api/executor/task-update`（状态/日志/结果）

