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
| `DEMO_SERVICE_DELAY_MS` | 示例服务 `demo.mock3s` 的模拟处理时长 | `3000` |

## 任务执行流程

1. 客户端注册 `/api/executor/register`
2. 定时心跳 `/api/executor/heartbeat`
3. 主动拉取任务 `/api/executor/next-task`
4. 执行 task 后回传 `/api/executor/task-update`（状态/日志/结果）

## 能力协商协议（Tasks Protocol）

客户端在 `register/heartbeat` 时会上报：

- `capabilities`: 机器能力（CPU、内存、loadavg 等）
- `tasks`: 可提供的任务列表，例如：

```json
[
  {
    "name": "client.mock3s",
    "version": "1.0.0",
    "description": "示例任务：模拟处理3秒并返回JSON"
  }
]
```

服务端会据此分发 `client_task` 任务：

- 下发字段：`task_name + task_payload + execution_name`

## 示例任务

客户端内置：

- `client.echo`
- `client.mock3s`

## 已注册任务名（服务端）

`/api/v1/app/task/execute` 仅支持服务端已注册的 task 名称，当前示例包括：

- `server.echo`（服务端执行）
- `client.echo`（客户端执行）
- `client.mock3s`（客户端执行）

如果调用未注册 task（例如 `demo.not-exists`），服务端会返回 `404` 和“任务不存在”。

