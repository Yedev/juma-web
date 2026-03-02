import { listServerTaskDefinitions, normalizeServerTaskPayloadByName } from "./serverTaskRuntime";
import { inferTaskTypeFromName, TaskType } from "./taskNaming";

export interface RegisteredTaskParamDef {
  name: string;
  type: "string" | "number" | "boolean" | "object" | "array";
  required: boolean;
  description: string;
  defaultValue?: unknown;
}

export interface RegisteredTaskDefinition {
  taskName: string;
  title: string;
  description: string;
  taskType: TaskType;
  executeMode: "task";
  params: RegisteredTaskParamDef[];
  exampleTaskPayload: Record<string, unknown>;
}

interface PreparedTaskPayload {
  taskType: TaskType;
  taskPayload: Record<string, unknown>;
  targetClientId?: string;
  requiredTags?: string[];
  maxRetries?: number;
  executionName?: string;
}

interface RegisteredTaskInternal extends RegisteredTaskDefinition {
  buildTaskPayload: (
    taskPayload: Record<string, unknown>,
    executionName?: string
  ) => PreparedTaskPayload;
}

export type PrepareRegisteredTaskResult =
  | {
      ok: true;
      definition: RegisteredTaskDefinition;
      payload: PreparedTaskPayload;
    }
  | {
      ok: false;
      code: 400 | 404;
      message: string;
    };

function normalizeObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function pickString(
  input: Record<string, unknown>,
  key: string,
  fallback: string,
  maxLen = 500
): string {
  const value = input[key];
  if (typeof value !== "string") return fallback;
  const normalized = value.trim();
  if (!normalized) return fallback;
  return normalized.slice(0, maxLen);
}

function pickOptionalString(
  input: Record<string, unknown>,
  key: string,
  maxLen = 100
): string | undefined {
  const value = input[key];
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  if (!normalized) return undefined;
  return normalized.slice(0, maxLen);
}

function pickNumber(
  input: Record<string, unknown>,
  key: string,
  fallback: number,
  min: number,
  max: number
): number {
  const value = input[key];
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function pickStringArray(input: Record<string, unknown>, key: string, maxItems = 20): string[] {
  const value = input[key];
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => typeof item === "string")
    .map((item) => (item as string).trim())
    .filter(Boolean)
    .slice(0, maxItems);
}

function cloneDefinition(definition: RegisteredTaskInternal): RegisteredTaskDefinition {
  return {
    taskName: definition.taskName,
    title: definition.title,
    description: definition.description,
    taskType: definition.taskType,
    executeMode: "task",
    params: definition.params.map((item) => ({ ...item })),
    exampleTaskPayload: JSON.parse(JSON.stringify(definition.exampleTaskPayload)) as Record<string, unknown>,
  };
}

function normalizeExecutionName(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  if (!normalized) return undefined;
  return normalized.slice(0, 120);
}

function buildClientEchoTask(input: Record<string, unknown>, executionName?: string): PreparedTaskPayload {
  const message = pickString(input, "message", "hello from client task", 300);
  const repeat = pickNumber(input, "repeat", 1, 1, 20);
  const sleepMs = pickNumber(input, "sleep_ms", 500, 0, 30000);
  const targetClientId = pickOptionalString(input, "target_client_id", 120);
  const requiredTags = pickStringArray(input, "required_tags");
  const maxRetries = pickNumber(input, "max_retries", 1, 0, 10);

  return {
    taskType: "client_task",
    taskPayload: {
      message,
      repeat,
      sleep_ms: sleepMs,
    },
    targetClientId,
    requiredTags,
    maxRetries,
    executionName,
  };
}

function buildClientMock3sTask(input: Record<string, unknown>, executionName?: string): PreparedTaskPayload {
  const payload = normalizeObject(input.payload);
  const targetClientId = pickOptionalString(input, "target_client_id", 120);
  const requiredTags = pickStringArray(input, "required_tags");
  const maxRetries = pickNumber(input, "max_retries", 1, 0, 10);

  return {
    taskType: "client_task",
    taskPayload: payload,
    targetClientId,
    requiredTags,
    maxRetries,
    executionName,
  };
}

function buildRegisteredTasks(): RegisteredTaskInternal[] {
  const serverTasks: RegisteredTaskInternal[] = listServerTaskDefinitions().map((task) => ({
    taskName: task.taskName,
    title: task.title,
    description: task.description,
    taskType: "server_task",
    executeMode: "task",
    params: task.params.map((item) => ({ ...item })),
    exampleTaskPayload: JSON.parse(JSON.stringify(task.exampleTaskPayload)) as Record<string, unknown>,
    buildTaskPayload: (input, executionName) => ({
      taskType: "server_task",
      taskPayload: normalizeServerTaskPayloadByName(task.taskName, input) ?? {},
      maxRetries: 0,
      executionName,
    }),
  }));

  const clientTasks: RegisteredTaskInternal[] = [
    {
      taskName: "client.echo",
      title: "客户端回显示例任务",
      description: "分发到客户端，由客户端注册任务处理器执行。",
      taskType: "client_task",
      executeMode: "task",
      params: [
        {
          name: "message",
          type: "string",
          required: false,
          description: "客户端日志输出内容",
          defaultValue: "hello from client task",
        },
        {
          name: "repeat",
          type: "number",
          required: false,
          description: "循环次数 (1-20)",
          defaultValue: 1,
        },
        {
          name: "sleep_ms",
          type: "number",
          required: false,
          description: "每次循环等待毫秒数",
          defaultValue: 500,
        },
        {
          name: "target_client_id",
          type: "string",
          required: false,
          description: "指定客户端 ID（可选）",
        },
        {
          name: "required_tags",
          type: "array",
          required: false,
          description: "客户端标签过滤（可选）",
        },
      ],
      exampleTaskPayload: {
        message: "执行客户端回显任务",
        repeat: 2,
        sleep_ms: 500,
      },
      buildTaskPayload: buildClientEchoTask,
    },
    {
      taskName: "client.mock3s",
      title: "客户端 mock3s 示例任务",
      description: "分发到客户端，模拟处理并返回 output_json。",
      taskType: "client_task",
      executeMode: "task",
      params: [
        {
          name: "payload",
          type: "object",
          required: false,
          description: "传给客户端任务处理器的入参对象",
          defaultValue: { demo: true },
        },
        {
          name: "target_client_id",
          type: "string",
          required: false,
          description: "指定客户端 ID（可选）",
        },
        {
          name: "required_tags",
          type: "array",
          required: false,
          description: "客户端标签过滤（可选）",
        },
      ],
      exampleTaskPayload: {
        payload: {
          build_id: "build-20260302-001",
          branch: "main",
          notify: true,
        },
      },
      buildTaskPayload: buildClientMock3sTask,
    },
  ];

  return [...serverTasks, ...clientTasks];
}

const registeredTasks = buildRegisteredTasks();
const taskMap = new Map<string, RegisteredTaskInternal>(registeredTasks.map((item) => [item.taskName, item]));

export function listRegisteredTasks(): RegisteredTaskDefinition[] {
  return registeredTasks.map(cloneDefinition);
}

export function prepareRegisteredTask(
  taskName: string,
  taskPayload: unknown,
  executionName?: unknown
): PrepareRegisteredTaskResult {
  const normalizedTaskName = taskName.trim();
  const inferredType = inferTaskTypeFromName(normalizedTaskName);
  if (!inferredType) {
    return {
      ok: false,
      code: 400,
      message: "task_name 命名必须是 server.name 或 client.name",
    };
  }

  const matched = taskMap.get(normalizedTaskName);
  if (!matched) {
    return {
      ok: false,
      code: 404,
      message: `任务不存在: ${taskName}`,
    };
  }

  const payloadObj = normalizeObject(taskPayload);
  const normalizedExecutionName = normalizeExecutionName(executionName);
  const payload = matched.buildTaskPayload(payloadObj, normalizedExecutionName);
  if (payload.taskType !== inferredType) {
    return {
      ok: false,
      code: 400,
      message: `任务类型与 task_name 前缀不一致: ${taskName}`,
    };
  }

  return {
    ok: true,
    definition: cloneDefinition(matched),
    payload,
  };
}
