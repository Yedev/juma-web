# 任务执行模块详解

本文档详细说明 `mac-mini-client` 的任务系统，包括任务的接收、路由、执行、状态上报、内置任务实现，以及如何添加自定义任务。

---

## 任务系统架构概览

```
client.js
    │
    │  收到 task.assign
    ▼
executeTask(payload)
    │
    ├── 查询 getRegisteredTask(task_name)
    │         │
    │         ▼
    │    tasks/registry.js  ← ClientTaskRegistry
    │    (Map: taskName → taskInstance)
    │
    ├── 发送 task.update(running)
    │
    ├── 调用 taskInstance.run(payload, context)
    │         │
    │         ├── context.log(line)  → 日志缓冲 → task.log
    │         └── 返回 output 对象
    │
    ├── 成功 → 发送 task.update(completed)
    └── 异常 → 发送 task.log(错误堆栈) + task.update(error)
```

---

## task.assign 消息接收与解析

### 消息格式

```json
{
  "type": "task.assign",
  "payload": {
    "task_id": "T-abc123def456",
    "task_name": "client.mock3s",
    "task_payload": {
      "some_param": "value"
    },
    "execution_name": "我的测试任务",
    "max_retries": 0
  }
}
```

### 各字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| `task_id` | string | 任务唯一标识，由服务端生成。所有回报消息（`task.update`、`task.log`）必须携带此 ID |
| `task_name` | string | 任务类型名称，格式为 `client.<name>`，用于在注册表中查找对应实现 |
| `task_payload` | object | 任务执行参数，内容由具体任务定义解析，不合法的参数由各任务的 `normalizePayload` 处理 |
| `execution_name` | string | 此次执行的可读名称，用于日志标注，不影响执行逻辑 |
| `max_retries` | number | 最大重试次数（当前客户端实现中未使用此字段，重试逻辑在服务端） |

### 解析与路由

```javascript
function handleMessage(raw) {
  const envelope = JSON.parse(String(raw));
  const { type, payload } = envelope;

  if (type === "task.assign") {
    if (runningTaskId) {
      // 当前有任务在运行，拒绝新任务
      console.warn(`skip task ${payload.task_id}, another task is running`);
      return;
    }
    void executeTask(payload);
  }
}
```

**单任务并发限制：** 客户端通过 `runningTaskId` 全局变量跟踪当前是否有任务在执行。若收到新的 `task.assign` 时已有任务在运行，新任务会被**静默丢弃**（打印警告）。服务端应确保不向已繁忙的客户端分配任务。

---

## 任务路由机制

### 注册表 ClientTaskRegistry

`tasks/registry.js` 中的 `ClientTaskRegistry` 是一个简单的 Map 包装：

```javascript
class ClientTaskRegistry {
  constructor() {
    this.taskMap = new Map();  // Map<taskName, taskInstance>
  }

  register(taskInstance) {
    const taskName = taskInstance?.taskName;
    if (this.taskMap.has(taskName)) {
      throw new Error(`duplicated client task registration: ${taskName}`);
    }
    this.taskMap.set(taskName, taskInstance);
  }

  get(taskName) {
    return this.taskMap.get(taskName);
  }

  listDefinitions() {
    return Array.from(this.taskMap.values()).map(task => task.getDefinition());
  }
}
```

特点：
- **防重名**：同名任务注册两次会直接抛出异常，在启动时即暴露问题
- **按名称查找**：O(1) Map 查找，`getRegisteredTask(taskName)` 返回对应实例或 `undefined`

### 未找到任务时的处理

```javascript
const taskInstance = getRegisteredTask(taskName);
if (!taskInstance) {
  updateTask(taskId, "error", {
    error: `任务未注册: ${taskName}`,
    finished_at: nowIso(),
    executor: "client_task_runtime_ws",
    client_id: CLIENT_ID,
    task_name: taskName,
    execution_name: executionName,
  }, -1);
  return;
}
```

直接回报 `error` 状态，`result_code` 为 `-1`，`status_info.error` 描述具体原因。

---

## 任务执行上下文

每个任务实例的 `run()` 方法接收两个参数：`payload`（任务参数）和 `context`（执行上下文）。

### context 对象结构

```javascript
const context = {
  taskId: "T-abc123",          // 当前任务 ID
  taskName: "client.mock3s",   // 任务类型名称
  executionName: "我的测试",    // 执行名称（可读标注）
  clientId: "macmini-MyMac-a1b2c3d4",  // 本客户端 ID
  log: (line) => { ... },      // 写入日志缓冲区的函数
};
```

### context.log() 的使用

`log` 是任务输出日志的唯一标准方式：

```javascript
// 正确用法
context.log("开始下载依赖包");
context.log(`当前进度: ${percent}%`);
context.log(`警告: 文件 ${file} 不存在，跳过`);

// 错误用法（不应直接 console.log，日志不会上报到服务端）
console.log("这条日志只在本地可见，不会发送给服务端");
```

`log` 函数内部将文本追加到 `logBuffer`，并触发 `flushLogs()` 检查是否需要发送。每条日志末尾自动添加换行符 `\n`。

---

## task.update 消息发送

任务状态通过 `task.update` 消息回报，贯穿任务的整个生命周期。

### 状态流转

```
task.assign 收到
      │
      ▼
  running        ← 任务开始执行（sendWs 立即发送）
      │
      ├──(成功)──► completed    ← 任务执行完成
      │
      └──(异常)──► error        ← 任务抛出异常或未找到任务实现
```

### running 状态消息

```json
{
  "type": "task.update",
  "payload": {
    "task_id": "T-abc123",
    "status": "running",
    "result_code": null,
    "status_info": {
      "current_step": "开始执行 client.mock3s",
      "progress": 5,
      "started_at": "2026-03-21T10:00:00.000Z",
      "executor": "client_task_runtime_ws",
      "client_id": "macmini-MyMac-a1b2c3d4",
      "task_name": "client.mock3s",
      "execution_name": "测试执行"
    }
  },
  "ts": 1711000000000
}
```

### completed 状态消息

```json
{
  "type": "task.update",
  "payload": {
    "task_id": "T-abc123",
    "status": "completed",
    "result_code": null,
    "status_info": {
      "current_step": "执行完成",
      "progress": 100,
      "duration_ms": 3051,
      "finished_at": "2026-03-21T10:00:03.051Z",
      "executor": "client_task_runtime_ws",
      "client_id": "macmini-MyMac-a1b2c3d4",
      "task_name": "client.mock3s",
      "execution_name": "测试执行",
      "output_json": {
        "ok": true,
        "task_name": "client.mock3s",
        "handled_at": "2026-03-21T10:00:03.050Z",
        "delay_ms": 3000,
        "received": {}
      }
    }
  },
  "ts": 1711000003051
}
```

`output_json` 字段包含任务 `run()` 方法的返回值，内容因任务不同而异。

### error 状态消息

```json
{
  "type": "task.update",
  "payload": {
    "task_id": "T-abc123",
    "status": "error",
    "result_code": -1,
    "status_info": {
      "error": "client.fail_demo 人工触发异常 (step=2)",
      "finished_at": "2026-03-21T10:00:01.200Z",
      "executor": "client_task_runtime_ws",
      "client_id": "macmini-MyMac-a1b2c3d4",
      "task_name": "client.fail_demo",
      "execution_name": "异常演练"
    }
  },
  "ts": 1711000001200
}
```

error 状态下 `result_code` 固定为 `-1`，`status_info.error` 包含异常的 `message`。错误的完整堆栈通过 `task.log` 单独发送。

---

## task.log 消息发送

日志的详细格式见 `websocket.md`，此处补充任务执行层面的细节。

### 日志收集与发送时序

```
T=0ms    任务开始，context.log("step 1")     → logBuffer="step 1\n"
T=100ms  context.log("step 2")               → logBuffer="step 1\nstep 2\n"
T=200ms  context.log("step 3")               → logBuffer="step 1\nstep 2\nstep 3\n"
...
T=2000ms LOG_FLUSH_INTERVAL_MS 到期
         → flushLogs() 触发，发送 task.log("step 1\nstep 2\nstep 3\n...")
         → logBuffer="" 清空

T=3000ms 任务完成，await flushLogs(true)
         → 强制刷新剩余日志
         发送 task.update(completed)
```

### 任务异常时的日志处理

```javascript
} catch (error) {
  const fallbackLog = error?.stack || String(error);
  appendTaskLog(taskId, fallbackLog);   // 先发送错误堆栈作为日志
  updateTask(taskId, "error", { ... }, -1);  // 再发送 error 状态
}
```

异常情况下，`logBuffer` 中可能还有未刷新的日志。这些日志会在 `catch` 块中通过 `fallbackLog` 一并发出（注意：当前实现中 `catch` 块不调用 `flushLogs(true)`，logBuffer 中的内容可能丢失，仅发送 error.stack）。

---

## 任务基类 ClientTaskBase

所有任务必须继承 `ClientTaskBase`，位于 `tasks/base.js`：

```javascript
class ClientTaskBase {
  constructor({ taskName, version = "1.0.0", description = "" }) {
    // taskName 必须符合格式 client.<name>
    if (!/^client\.[a-zA-Z0-9_-]+$/.test(taskName.trim())) {
      throw new Error(`invalid client task name: ${taskName}`);
    }
    this.taskName = taskName.trim();
    this.version = version;
    this.description = description;
  }

  normalizePayload(payload) { ... }  // 基础参数清洗，返回安全的 object
  getDefinition() { ... }             // 返回 { name, version, description }
  async run(payload, context) { ... } // 子类必须重写，否则抛出异常
}
```

**任务命名规范：** 任务名必须以 `client.` 为前缀，后接字母、数字、下划线或连字符，例如 `client.build_ios`、`client.run-tests`。

---

## 内置任务说明

### client.echo — 回显示例任务

**用途：** 功能验证、连接测试。将指定消息重复输出 N 次，每次之间可设置睡眠时间。

**payload 参数：**

| 参数 | 类型 | 默认值 | 范围 | 说明 |
|------|------|--------|------|------|
| `message` | string | `"hello from client task"` | 最多 300 字符 | 要回显的消息文本 |
| `repeat` | number | `1` | 1 ~ 20 | 重复次数 |
| `sleep_ms` | number | `500` | 0 ~ 30000 | 每次输出之间的等待时间（毫秒） |

**执行逻辑：**

```
log("start, repeat=N")
循环 repeat 次：
  log("i/N: <message>")
  sleep(sleep_ms)
log("done")
return { ok: true, repeated: N, echoed_message: "<message>" }
```

**返回值示例：**

```json
{
  "ok": true,
  "repeated": 3,
  "echoed_message": "hello from client task"
}
```

---

### client.mock3s — 3秒模拟任务

**用途：** 模拟一个耗时操作（默认 3 秒），用于测试任务分发、状态流转和前端展示效果。延迟时间可通过 `DEMO_TASK_DELAY_MS` 环境变量调整。

**payload 参数：** 接受任意 object，透传到返回值的 `received` 字段，但不会影响执行逻辑。

**执行逻辑：**

```
log("processing for <delayMs>ms")
sleep(delayMs)
log("done")
return { ok: true, task_name, handled_at, delay_ms, received: payload }
```

**返回值示例：**

```json
{
  "ok": true,
  "task_name": "client.mock3s",
  "handled_at": "2026-03-21T10:00:03.050Z",
  "delay_ms": 3000,
  "received": {}
}
```

---

### client.fail_demo — 异常演练任务

**用途：** 专门用于验证异常处理流程，包括日志上报是否正常、`error` 状态是否正确回传、管理界面是否正确展示失败信息。

**payload 参数：**

| 参数 | 类型 | 默认值 | 范围 | 说明 |
|------|------|--------|------|------|
| `message` | string | `"client.fail_demo 人工触发异常"` | 最多 300 字符 | 异常消息文本 |
| `before_fail_ms` | number | `1200` | 0 ~ 60000 | 任务总运行时间（均匀分配到各步骤） |
| `fail_at_step` | number | `2` | 1 ~ 5 | 在第几步抛出异常 |
| `total_steps` | number | `4` | 1 ~ 10 | 总步骤数 |

**执行逻辑：**

```
log("begin, fail_at_step=2/4")
步骤 1: log("step 1/4"), sleep(300ms)
步骤 2: log("step 2/4"), sleep(300ms)
        throw new Error("client.fail_demo 人工触发异常 (step=2)")
（步骤 3、4 不会执行）
```

**异常后的处理流程：**
1. `run()` 抛出异常，被 `executeTask` 的 `catch` 块捕获
2. 发送 `task.log(error.stack)`（完整堆栈）
3. 发送 `task.update(error, result_code=-1)`

---

## 如何添加新的客户端任务

以下是添加自定义任务 `client.build_ios` 的完整步骤示例。

### 步骤 1：在 tasks/ 目录创建新文件

创建 `mac-mini-client/tasks/clientBuildIosTask.js`：

```javascript
const { ClientTaskBase } = require("./base");
const { execSync } = require("child_process");

class ClientBuildIosTask extends ClientTaskBase {
  constructor() {
    super({
      taskName: "client.build_ios",
      version: "1.0.0",
      description: "iOS Xcode 编译任务",
    });
  }

  normalizePayload(payload) {
    const input = super.normalizePayload(payload);
    return {
      scheme: typeof input.scheme === "string" ? input.scheme.trim() : "MyApp",
      configuration: typeof input.configuration === "string"
        ? input.configuration.trim()
        : "Release",
      project_path: typeof input.project_path === "string"
        ? input.project_path.trim()
        : "",
    };
  }

  async run(payload, context) {
    const { scheme, configuration, project_path } = this.normalizePayload(payload);

    context.log(`[${this.taskName}] 开始编译: scheme=${scheme}, config=${configuration}`);

    if (!project_path) {
      throw new Error("project_path 未指定");
    }

    // 示例：调用 xcodebuild
    const cmd = [
      "xcodebuild",
      `-project "${project_path}"`,
      `-scheme "${scheme}"`,
      `-configuration "${configuration}"`,
      "build",
    ].join(" ");

    context.log(`[${this.taskName}] 执行命令: ${cmd}`);

    try {
      const output = execSync(cmd, { encoding: "utf8", timeout: 600000 });
      // 将编译输出按行写入日志
      output.split("\n").forEach(line => {
        if (line.trim()) context.log(line);
      });
    } catch (err) {
      throw new Error(`xcodebuild 失败: ${err.message}`);
    }

    context.log(`[${this.taskName}] 编译成功`);
    return { ok: true, scheme, configuration };
  }
}

module.exports = { ClientBuildIosTask };
```

### 步骤 2：在 tasks/index.js 中注册任务

编辑 `mac-mini-client/tasks/index.js`，添加 require 和 register 调用：

```javascript
const { ClientTaskRegistry } = require("./registry");
const { ClientEchoTask } = require("./clientEchoTask");
const { ClientMock3sTask } = require("./clientMock3sTask");
const { ClientFailDemoTask } = require("./clientFailDemoTask");
const { ClientBuildIosTask } = require("./clientBuildIosTask");  // 新增

const registry = new ClientTaskRegistry();

function registerBuiltinTasks() {
  registry.register(new ClientEchoTask());
  registry.register(new ClientMock3sTask(process.env.DEMO_TASK_DELAY_MS || "3000"));
  registry.register(new ClientFailDemoTask());
  registry.register(new ClientBuildIosTask());  // 新增
}
```

### 步骤 3：client.hello 自动声明（无需手动修改）

`client.hello` 和 `client.heartbeat` 中的 `tasks` 列表由 `getRegisteredTaskDefinitions()` 动态生成，只要注册了新任务，连接时会自动上报。

验证方法：启动客户端后查看控制台输出：

```
[2026-03-21T10:00:00.000Z] mac-mini ws client starting
[2026-03-21T10:00:00.001Z] ws=ws://... tasks=client.echo, client.mock3s, client.fail_demo, client.build_ios
```

确认 `client.build_ios` 出现在 tasks 列表中即可。

### 步骤 4：在服务端 taskRegistry 中注册对应定义

服务端需要知道 `client.build_ios` 任务的定义，才能允许通过管理界面创建和分发此任务。

在服务端的 `taskRegistry.ts`（或对应的任务定义文件）中添加：

```typescript
{
  name: "client.build_ios",
  type: "client_task",          // 标记为客户端任务类型
  description: "iOS Xcode 编译任务",
  required_tags: ["xcode"],     // 可选：要求执行此任务的客户端必须有 xcode 标签
  payload_schema: {             // 可选：参数 schema 用于管理界面表单生成
    scheme: { type: "string", required: true },
    configuration: { type: "string", default: "Release" },
    project_path: { type: "string", required: true },
  }
}
```

完成后重启服务端，新任务类型即可在管理界面中使用。

---

## 错误处理与 result_code

### result_code 语义

| result_code | 含义 |
|-------------|------|
| `null` | 任务仍在执行中（running 状态），或成功完成（completed 状态，未设置具体码） |
| `0` | 成功（部分任务可能在 output_json 中使用，客户端框架本身不使用 0） |
| `-1` | 任务执行失败（error 状态，客户端框架固定使用此值） |

### 异常分类建议

在自定义任务中，建议根据异常类型提供不同的错误信息：

```javascript
async run(payload, context) {
  const normalized = this.normalizePayload(payload);

  // 参数校验错误（人为错误，不应重试）
  if (!normalized.project_path) {
    throw new Error("project_path 不能为空");
  }

  // 环境错误（可能是暂时性问题，可以重试）
  try {
    execSync("which xcodebuild");
  } catch {
    throw new Error("xcodebuild 未安装，请确认已安装 Xcode Command Line Tools");
  }

  // 执行错误（记录足够的上下文）
  try {
    // ... 执行编译 ...
  } catch (err) {
    context.log(`编译失败详情:\n${err.stderr || err.message}`);
    throw new Error(`编译失败: ${err.message}`);
  }
}
```

### 关于 max_retries

`task.assign` 消息包含 `max_retries` 字段，但当前客户端实现**不使用此字段**。重试逻辑完全由服务端控制：若服务端检测到任务以 `error` 状态结束且未达到重试上限，会重新发送 `task.assign`。
