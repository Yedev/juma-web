# Services 模块文档

`server/src/services/` 目录包含五个服务文件，共同实现了任务系统的完整生命周期管理。

---

## 1. taskNaming.ts — 任务命名规则

### 职责

定义并校验任务名称的命名规范，是整个任务系统的基础。

### 命名规则

任务名称必须匹配正则表达式：

```
/^(server|client)\.[a-zA-Z0-9_-]+$/
```

- **前缀 `server.`**：该任务在服务器本地执行（server_task）
- **前缀 `client.`**：该任务需要分发到远程执行器客户端执行（client_task）

**合法示例**：
- `server.echo` → `server_task`
- `server.sync_index` → `server_task`
- `client.echo` → `client_task`
- `client.build_ios` → `client_task`
- `client.mock3s` → `client_task`

**非法示例**：
- `echo`（无前缀）
- `server_echo`（分隔符错误）
- `SERVER.echo`（大写前缀，但实际测试中 `server` 需小写）
- `client.`（`.` 后为空）

### 导出函数

```typescript
// 推断任务类型，不合法返回 null
export function inferTaskTypeFromName(taskName: string): TaskType | null

// 简单校验是否合法
export function isValidTaskName(taskName: string): boolean

// 规范化任务名（去首尾空格）
export function normalizeTaskName(taskName: string): string

// 返回错误提示文本
export function taskNameRuleText(): string
// → "task_name 命名必须是 server.name 或 client.name"
```

### TaskType 类型

```typescript
export type TaskType = "server_task" | "client_task";
```

---

## 2. serverTaskRuntime.ts — 服务端任务运行时

### 职责

定义服务端任务的抽象基类和具体实现，管理所有已注册的 server_task，并提供执行入口。

### 核心抽象类

```typescript
export abstract class ServerTaskBase<TPayload extends object = Record<string, unknown>> {
  abstract readonly taskName: string;        // 任务名，格式 server.xxx
  abstract readonly title: string;           // 人类可读标题
  abstract readonly description: string;     // 功能描述
  abstract readonly params: TaskParamDefinition[];        // 参数定义
  abstract readonly exampleTaskPayload: Record<string, unknown>; // 示例 payload

  // 可选重写：对原始 payload 进行类型安全的规范化
  normalizePayload(payload: Record<string, unknown>): TPayload

  // 必须实现：执行任务逻辑
  abstract run(payload: TPayload, context: ServerTaskRunContext): Promise<unknown>

  getDefinition(): ServerTaskDefinition   // 获取任务定义（用于注册）
}
```

### ServerTaskRunContext 接口

```typescript
export interface ServerTaskRunContext {
  taskId: string;          // 任务的唯一 ID（taskId 字符串，非数据库自增 id）
  executionName?: string;  // 可选的执行标签（由调用方传入）
  log: (line: string) => void; // 写入执行日志的回调函数
}
```

任务实现通过 `context.log()` 追加日志行，日志最终会被 `executionEngine.ts` 截断到 64KB 上限后存入数据库。

### TaskParamDefinition 接口

```typescript
export interface TaskParamDefinition {
  name: string;
  type: "string" | "number" | "boolean" | "object" | "array";
  required: boolean;
  description: string;
  defaultValue?: unknown;
}
```

### 内置任务：server.echo

唯一内置的 server_task，用于测试和演示。

**参数定义**：

| 参数名 | 类型 | 必填 | 默认值 | 说明 |
|--------|------|------|--------|------|
| `message` | string | 否 | `"hello from server task"` | 每次循环打印的内容（最大 300 字符） |
| `repeat` | number | 否 | `3` | 循环次数，范围 1–20 |
| `sleep_ms` | number | 否 | `400` | 每次循环等待时长（毫秒），范围 0–10000 |

**执行逻辑**：
```
1. log("[server.echo] start, execution_name=..., repeat=..., sleep_ms=...")
2. for i = 1 to repeat:
     log("[server.echo] {i}/{repeat}: {message}")
     sleep(sleep_ms)
3. log("[server.echo] done")
4. return { ok: true, repeated: repeat, echoed_message: message }
```

返回值存储在 `statusInfo.output_json` 字段中。

**示例 payload**：
```json
{ "message": "同步商品索引", "repeat": 3, "sleep_ms": 400 }
```

### 导出函数

```typescript
// 列出所有已注册的 server_task 定义
export function listServerTaskDefinitions(): ServerTaskDefinition[]

// 对指定任务的 payload 进行规范化（类型安全处理）
export function normalizeServerTaskPayloadByName(
  taskName: string,
  payload: Record<string, unknown>
): Record<string, unknown> | null

// 判断某个任务名是否已注册
export function hasServerTask(taskName: string): boolean

// 执行指定的 server_task（由 executionEngine.ts 调用）
export async function executeServerTaskByName(
  taskName: string,
  payload: Record<string, unknown>,
  context: ServerTaskRunContext
): Promise<unknown>
```

### 添加新的 server_task

1. 在 `serverTaskRuntime.ts` 中创建新类继承 `ServerTaskBase`
2. 实现 `taskName`、`title`、`description`、`params`、`exampleTaskPayload`
3. 实现 `normalizePayload()` 和 `run()` 方法
4. 将实例添加到 `serverTaskInstances` 数组

```typescript
class MyNewTask extends ServerTaskBase<{ url: string }> {
  readonly taskName = "server.my_new_task";
  readonly title = "我的新任务";
  readonly description = "做一些事情";
  readonly params: TaskParamDefinition[] = [
    { name: "url", type: "string", required: true, description: "目标 URL" }
  ];
  readonly exampleTaskPayload = { url: "https://example.com" };

  override normalizePayload(payload: Record<string, unknown>) {
    return { url: typeof payload.url === "string" ? payload.url : "" };
  }

  async run(payload: { url: string }, context: ServerTaskRunContext) {
    context.log(`Fetching ${payload.url}`);
    // ... 业务逻辑
    return { ok: true };
  }
}

const serverTaskInstances = [new ServerEchoTask(), new MyNewTask()];
```

---

## 3. taskRegistry.ts — 任务注册表

### 职责

整合 server_task 和 client_task 的定义，提供统一的任务查找和 payload 准备接口，是路由层与底层执行层之间的桥梁。

### RegisteredTaskDefinition 接口

```typescript
export interface RegisteredTaskDefinition {
  taskName: string;
  title: string;
  description: string;
  taskType: TaskType;                      // "server_task" | "client_task"
  executeMode: "task";                     // 固定值，预留扩展
  params: RegisteredTaskParamDef[];        // 参数定义列表
  exampleTaskPayload: Record<string, unknown>;
}

export interface RegisteredTaskParamDef {
  name: string;
  type: "string" | "number" | "boolean" | "object" | "array";
  required: boolean;
  description: string;
  defaultValue?: unknown;
}
```

### 已注册的任务列表

| 任务名 | 类型 | 标题 |
|--------|------|------|
| `server.echo` | server_task | 服务端回显示例任务 |
| `client.echo` | client_task | 客户端回显示例任务 |
| `client.mock3s` | client_task | 客户端 mock3s 示例任务 |
| `client.fail_demo` | client_task | 客户端异常处理示例任务 |

### client_task 参数说明

**client.echo 参数**：

| 参数名 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `message` | string | `"hello from client task"` | 日志输出内容（最大 300 字符） |
| `repeat` | number | `1` | 循环次数（1–20） |
| `sleep_ms` | number | `500` | 每次循环等待时长（0–30000 毫秒） |
| `target_client_id` | string | 无 | 指定执行器客户端 ID |
| `required_tags` | array | `[]` | 客户端标签过滤（AND 匹配） |
| `max_retries` | number | `1` | 最大重试次数（0–10） |

**client.mock3s 参数**：

| 参数名 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `payload` | object | `{ demo: true }` | 传给客户端处理器的入参对象 |
| `target_client_id` | string | 无 | 指定执行器客户端 ID |
| `required_tags` | array | `[]` | 客户端标签过滤 |

**client.fail_demo 参数**：

| 参数名 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `message` | string | `"client.fail_demo 人工触发异常"` | 异常消息文本 |
| `before_fail_ms` | number | `1200` | 触发异常前等待时长（0–60000 毫秒） |
| `fail_at_step` | number | `2` | 第几步触发异常（1–5） |
| `total_steps` | number | `4` | 总步骤数（1–10） |
| `target_client_id` | string | 无 | 指定执行器客户端 ID |
| `required_tags` | array | `[]` | 客户端标签过滤 |
| `max_retries` | number | `0` | 最大重试次数（默认 0，失败即报错） |

### 导出函数

```typescript
// 返回所有注册任务的定义列表（深拷贝，安全）
export function listRegisteredTasks(): RegisteredTaskDefinition[]

// 查找任务定义并准备 payload
export function prepareRegisteredTask(
  taskName: string,
  taskPayload: unknown,
  executionName?: unknown
): PrepareRegisteredTaskResult
```

### PrepareRegisteredTaskResult 类型

```typescript
type PrepareRegisteredTaskResult =
  | {
      ok: true;
      definition: RegisteredTaskDefinition;  // 任务定义
      payload: PreparedTaskPayload;           // 规范化后的执行 payload
    }
  | {
      ok: false;
      code: 400 | 404;
      message: string;
    };
```

**失败场景**：
- code 400：任务名格式不合法（不符合 `server.*` / `client.*`）
- code 404：任务名格式合法但未注册
- code 400：任务类型与 taskName 前缀不一致（内部一致性检查）

---

## 4. taskEnqueue.ts — 任务入队

### 职责

封装从调用方到数据库的完整任务入队流程，确保 taskId 唯一、statusInfo 结构正确。

### enqueueTaskByRegisteredName() 函数

```typescript
export async function enqueueTaskByRegisteredName(
  prisma: PrismaClient,
  input: {
    taskName: string;
    taskPayload: unknown;
    executionName?: unknown;
  }
): Promise<EnqueueByRegisteredNameResult>
```

### 执行流程

```
1. 调用 prepareRegisteredTask(taskName, taskPayload, executionName)
   → 失败：直接返回 { ok: false, code, message }

2. 查询当前队列中 status="queued" 的任务数量
   → queueCount = prisma.task.count({ where: { status: "queued" } })

3. 生成 taskId：T + Date.now() + 随机3位数字
   → 例如：T17111234567890042

4. 创建数据库记录 prisma.task.create({
     taskId,
     taskName: prepared.definition.taskName,
     taskType: prepared.payload.taskType,     // "server_task" | "client_task"
     targetClientId: (client_task 时) prepared.payload.targetClientId ?? null,
     taskParams: JSON.stringify({
       task_payload: prepared.payload.taskPayload,
       required_tags: prepared.payload.requiredTags ?? [],
       execution_name: prepared.payload.executionName,
     }),
     status: "queued",
     statusInfo: JSON.stringify({
       queue_position: queueCount + 1,
       task_type: prepared.payload.taskType,
       registered_task_name: prepared.definition.taskName,
       execution_name: prepared.payload.executionName,
     }),
     maxRetries: prepared.payload.maxRetries ?? 0,
   })

5. 返回 {
     ok: true,
     data: {
       task_id, task_name, task_title, task_type,
       execution_name, queue_position
     }
   }
```

### EnqueueByRegisteredNameResult 类型

```typescript
type EnqueueByRegisteredNameResult =
  | {
      ok: true;
      data: {
        task_id: string;
        task_name: string;
        task_title: string;
        task_type: "server_task" | "client_task";
        execution_name?: string;
        queue_position: number;
      };
    }
  | { ok: false; code: 400 | 404; message: string };
```

---

## 5. executionEngine.ts — 执行引擎

### 职责

负责本地 server_task 的轮询调度与执行，以及客户端状态刷新、远程 client_task 超时恢复。

### 配置常量

| 常量 | 环境变量 | 默认值 | 说明 |
|------|----------|--------|------|
| `LOCAL_EXECUTOR_ID` | — | `"server-local"` | 本地执行器的 claimedByClientId 标识 |
| `LOCAL_POLL_INTERVAL_MS` | `LOCAL_EXECUTOR_POLL_MS` | `2000` | 本地任务轮询间隔 |
| `LOCAL_CONCURRENCY` | `LOCAL_EXECUTOR_CONCURRENCY` | `1` | 本地最大并发数 |
| `OFFLINE_SWEEP_INTERVAL_MS` | `EXECUTOR_SWEEP_INTERVAL_MS` | `10000` | 状态扫描间隔 |
| `OFFLINE_TIMEOUT_MS` | `EXECUTOR_OFFLINE_TIMEOUT_MS` | `60000` | 客户端心跳超时阈值 |
| `REMOTE_TASK_STALE_TIMEOUT_MS` | `REMOTE_TASK_STALE_TIMEOUT_MS` | `300000` | 远程任务超时阈值 |
| `MAX_LOG_BYTES` | `TASK_LOG_MAX_BYTES` | `65536` | 任务日志上限（64KB） |

### 启动流程

```typescript
export function startExecutionEngine(prisma: PrismaClient): void
```

使用 `started` 标志防止重复启动：

```
1. 立即执行：
   - failLegacyQueuedTasks()    // 将旧版任务类型标记为 error
   - scheduleLocalTasks()       // 首次调度本地任务
   - refreshExecutorStatus()    // 首次刷新客户端状态
   - recoverStaleRemoteTasks()  // 首次恢复超时远程任务

2. 定时器 1（LOCAL_POLL_INTERVAL_MS = 2000ms）：
   - failLegacyQueuedTasks()
   - scheduleLocalTasks()

3. 定时器 2（OFFLINE_SWEEP_INTERVAL_MS = 10000ms）：
   - refreshExecutorStatus()
   - recoverStaleRemoteTasks()
```

### 本地任务调度（scheduleLocalTasks）

使用 `processingLocalQueue` 标志防止并发进入：

```
while (localRunningCount < LOCAL_CONCURRENCY):
  task = claimNextLocalTask()   // 乐观锁抢占
  if !task: break
  
  localRunningCount++
  executeLocalTask(task)
    .finally(() => {
      localRunningCount--
      scheduleLocalTasks()      // 任务完成后递归调度
    })
```

### 乐观锁抢占（claimNextLocalTask）

防止多个执行器同时抢占同一个任务：

```
1. 查询最多 50 条 status="queued" AND taskType="server_task" 的任务（按 createdAt 升序）
2. 取第一条 task
3. 执行 updateMany({ where: { id: task.id, status: "queued" }, data: { status: "running", claimedByClientId: "server-local", ... } })
4. 如果 claimed.count === 0，说明已被其他执行器抢占，返回 null
5. 重新 findUnique 获取最新记录后返回
```

### 任务执行（executeLocalTask）

```
1. 检查任务是否已注册（hasServerTask）
2. 解析 taskParams（JSON）获取 taskPayload 和 executionName
3. 初始化 logs 数组，创建 writeLog 回调
4. 调用 executeServerTaskByName(taskName, payload, { taskId, executionName, log: writeLog })
5. 成功：更新 status="completed", resultCode=0, executionLog=trimLog(logs.join('\n')), statusInfo
6. 失败：更新 status="error", resultCode=-1, executionLog=trimLog(logs+stack), statusInfo.error
```

### 日志截断（trimLog）

当日志超过 `MAX_LOG_BYTES`（64KB）时，保留尾部内容：

```
marker = "\n... [truncated]\n"
从尾部向前扫描，保留不超过 (MAX_LOG_BYTES - marker长度) 字节的内容
最终格式："\n... [truncated]\n{尾部内容}"
```

这样确保最近的日志始终可见，牺牲早期日志。

### 客户端状态刷新（refreshExecutorStatus）

```
cutoff = now - OFFLINE_TIMEOUT_MS (60秒)

1. 将 lastHeartbeat < cutoff 且 status != "offline" 的客户端标记为 offline
2. 将 lastHeartbeat >= cutoff 且 status = "offline" 的客户端标记为 online
```

### 远程任务恢复（recoverStaleRemoteTasks）

处理因客户端离线导致的僵尸任务：

```
staleCutoff = now - REMOTE_TASK_STALE_TIMEOUT_MS (5分钟)
offlineCutoff = now - OFFLINE_TIMEOUT_MS (60秒)

查询 taskType="client_task" AND status="running" AND claimedAt < staleCutoff 的任务

对每个僵尸任务：
  获取对应客户端的最新状态

  if 客户端在线（lastHeartbeat >= offlineCutoff）:
    跳过（任务可能还在执行）

  else 客户端离线:
    if retryCount < maxRetries:
      → 重置为 queued，retryCount+1，清除 claimedByClientId
    else:
      → 标记为 error（客户端离线且超过最大重试次数）
```

### 遗留任务处理（failLegacyQueuedTasks）

将旧版任务类型（`server_script`、`remote_mac`）标记为 error，不再支持这些模式。
