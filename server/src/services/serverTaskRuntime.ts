import { inferTaskTypeFromName } from "./taskNaming";

export interface TaskParamDefinition {
  name: string;
  type: "string" | "number" | "boolean" | "object" | "array";
  required: boolean;
  description: string;
  defaultValue?: unknown;
}

export interface ServerTaskDefinition {
  taskName: string;
  title: string;
  description: string;
  params: TaskParamDefinition[];
  exampleTaskPayload: Record<string, unknown>;
}

export interface ServerTaskRunContext {
  taskId: string;
  executionName?: string;
  log: (line: string) => void;
}

export abstract class ServerTaskBase<TPayload extends object = Record<string, unknown>> {
  abstract readonly taskName: string;
  abstract readonly title: string;
  abstract readonly description: string;
  abstract readonly params: TaskParamDefinition[];
  abstract readonly exampleTaskPayload: Record<string, unknown>;

  normalizePayload(payload: Record<string, unknown>): TPayload {
    return payload as TPayload;
  }

  abstract run(payload: TPayload, context: ServerTaskRunContext): Promise<unknown>;

  getDefinition(): ServerTaskDefinition {
    return {
      taskName: this.taskName,
      title: this.title,
      description: this.description,
      params: this.params.map((item) => ({ ...item })),
      exampleTaskPayload: JSON.parse(JSON.stringify(this.exampleTaskPayload)) as Record<string, unknown>,
    };
  }
}

function pickString(input: Record<string, unknown>, key: string, fallback: string, maxLen = 400): string {
  const value = input[key];
  if (typeof value !== "string") return fallback;
  const normalized = value.trim();
  if (!normalized) return fallback;
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

interface ServerEchoPayload {
  message: string;
  repeat: number;
  sleep_ms: number;
}

class ServerEchoTask extends ServerTaskBase<ServerEchoPayload> {
  readonly taskName = "server.echo";
  readonly title = "服务端回显示例任务";
  readonly description = "服务端执行纯 task 逻辑，不依赖脚本。";
  readonly params: TaskParamDefinition[] = [
    {
      name: "message",
      type: "string",
      required: false,
      description: "回显日志内容",
      defaultValue: "hello from server task",
    },
    {
      name: "repeat",
      type: "number",
      required: false,
      description: "循环次数 (1-20)",
      defaultValue: 3,
    },
    {
      name: "sleep_ms",
      type: "number",
      required: false,
      description: "每次循环等待毫秒数",
      defaultValue: 400,
    },
  ];
  readonly exampleTaskPayload = {
    message: "同步商品索引",
    repeat: 3,
    sleep_ms: 400,
  };

  override normalizePayload(payload: Record<string, unknown>): ServerEchoPayload {
    return {
      message: pickString(payload, "message", "hello from server task", 300),
      repeat: pickNumber(payload, "repeat", 3, 1, 20),
      sleep_ms: pickNumber(payload, "sleep_ms", 400, 0, 10000),
    };
  }

  async run(payload: ServerEchoPayload, context: ServerTaskRunContext): Promise<unknown> {
    context.log(
      `[${this.taskName}] start, execution_name=${context.executionName || "-"}, repeat=${payload.repeat}, sleep_ms=${payload.sleep_ms}`
    );
    for (let i = 1; i <= payload.repeat; i += 1) {
      context.log(`[${this.taskName}] ${i}/${payload.repeat}: ${payload.message}`);
      if (payload.sleep_ms > 0) {
        await sleep(payload.sleep_ms);
      }
    }
    context.log(`[${this.taskName}] done`);
    return {
      ok: true,
      repeated: payload.repeat,
      echoed_message: payload.message,
    };
  }
}

const serverTaskInstances = [new ServerEchoTask()];
const serverTaskMap = new Map<string, ServerTaskBase<object>>(serverTaskInstances.map((item) => [item.taskName, item]));

export function listServerTaskDefinitions(): ServerTaskDefinition[] {
  return serverTaskInstances.map((item) => item.getDefinition());
}

export function normalizeServerTaskPayloadByName(
  taskName: string,
  payload: Record<string, unknown>
): Record<string, unknown> | null {
  const task = serverTaskMap.get(taskName);
  if (!task) return null;
  return task.normalizePayload(payload) as Record<string, unknown>;
}

export function hasServerTask(taskName: string): boolean {
  return serverTaskMap.has(taskName);
}

export async function executeServerTaskByName(
  taskName: string,
  payload: Record<string, unknown>,
  context: ServerTaskRunContext
): Promise<unknown> {
  const task = serverTaskMap.get(taskName);
  if (!task) {
    throw new Error(`未注册的服务端任务: ${taskName}`);
  }
  const inferredType = inferTaskTypeFromName(taskName);
  if (inferredType !== "server_task") {
    throw new Error(`任务命名非法，服务端任务必须为 server.name: ${taskName}`);
  }
  return task.run(task.normalizePayload(payload), context);
}

