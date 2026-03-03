# Mac Mini 执行客户端（WebSocket）

用于无公网 IP 的 Mac Mini 主动连接服务器执行任务（WS 长连接推送模式）。

## 运行要求

- Node.js 22+
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
| `WORK_DIR` | 任务执行目录 | 当前目录 |
| `HEARTBEAT_INTERVAL_MS` | 心跳间隔 | `10000` |
| `RECONNECT_DELAY_MS` | 断线重连间隔 | `3000` |
| `LOG_FLUSH_INTERVAL_MS` | 日志上报最短间隔 | `2000` |
| `LOG_FLUSH_SIZE` | 日志上报最小批量字节数 | `2048` |
| `DEMO_TASK_DELAY_MS` | 示例任务 `client.mock3s` 的模拟处理时长 | `3000` |

## WebSocket 协议流程

1. 客户端连接 `ws://<host>/ws/executor?key=<EXECUTOR_KEY>`
2. 连接成功后发送 `client.hello`
3. 服务端返回 `server.hello`
4. 服务端推送 `task.assign`
5. 客户端执行任务并通过 `task.update` 上报 `running/completed/error` 状态
6. 客户端通过 `task.log` 持续上报执行日志
7. 客户端定时发送 `client.heartbeat`

## 能力协商协议（Tasks Protocol）

客户端在 `client.hello` 与 `client.heartbeat` 中会上报：

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

服务端会据此分发 `client_task` 任务，仅下发客户端声明支持的 `task_name`。

## 示例任务

客户端内置：

- `client.echo`
- `client.mock3s`
