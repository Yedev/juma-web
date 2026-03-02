type TaskType = "server_script" | "remote_mac";
type ExecuteMode = "script" | "service";

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
  executeMode: ExecuteMode;
  serviceName?: string;
  params: RegisteredTaskParamDef[];
  exampleTaskParams: Record<string, unknown>;
}

interface PreparedTaskPayload {
  taskType: TaskType;
  executeMode: ExecuteMode;
  taskParams: Record<string, unknown>;
  targetClientId?: string;
  maxRetries?: number;
}

interface RegisteredTaskInternal extends RegisteredTaskDefinition {
  buildTaskPayload: (taskParams: Record<string, unknown>) => PreparedTaskPayload;
}

export type PrepareRegisteredTaskResult =
  | {
      ok: true;
      definition: RegisteredTaskDefinition;
      payload: PreparedTaskPayload;
    }
  | {
      ok: false;
      code: 404;
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

function pickOptionalString(input: Record<string, unknown>, key: string, maxLen = 100): string | undefined {
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

function pickEnv(input: Record<string, unknown>, key: string): Record<string, string> {
  const value = normalizeObject(input[key]);
  const env: Record<string, string> = {};
  Object.entries(value).forEach(([envKey, envValue]) => {
    if (typeof envValue === "string") env[envKey] = envValue;
    else if (typeof envValue === "number" || typeof envValue === "boolean") env[envKey] = String(envValue);
  });
  return env;
}

function buildEchoScript(prefix: string, message: string, repeat: number, sleepSec: number): string {
  const messageBase64 = Buffer.from(message, "utf8").toString("base64");
  return [
    "set -euo pipefail",
    `MESSAGE_BASE64="${messageBase64}"`,
    `REPEAT=${repeat}`,
    `SLEEP_SEC=${sleepSec}`,
    'MESSAGE="$(printf "%s" "$MESSAGE_BASE64" | base64 -d)"',
    `echo "[${prefix}] start at $(date -Iseconds)"`,
    'for i in $(seq 1 "$REPEAT"); do',
    `  echo "[${prefix}] $i/$REPEAT: $MESSAGE"`,
    '  if [ "$SLEEP_SEC" -gt 0 ]; then',
    '    sleep "$SLEEP_SEC"',
    "  fi",
    "done",
    `echo "[${prefix}] done"`,
  ].join("\n");
}

function cloneDefinition(definition: RegisteredTaskInternal): RegisteredTaskDefinition {
  return {
    taskName: definition.taskName,
    title: definition.title,
    description: definition.description,
    taskType: definition.taskType,
    executeMode: definition.executeMode,
    serviceName: definition.serviceName,
    params: definition.params.map((item) => ({ ...item })),
    exampleTaskParams: JSON.parse(JSON.stringify(definition.exampleTaskParams)) as Record<string, unknown>,
  };
}

function buildServerEchoTask(input: Record<string, unknown>): PreparedTaskPayload {
  const message = pickString(input, "message", "hello from server demo task", 300);
  const repeat = pickNumber(input, "repeat", 3, 1, 20);
  const sleepSec = pickNumber(input, "sleep_sec", 1, 0, 10);
  const timeoutSec = pickNumber(input, "timeout_sec", Math.max(60, repeat * (sleepSec + 1) + 30), 10, 3600);
  const cwd = pickOptionalString(input, "cwd", 300);
  const envName = pickString(input, "env_name", "demo", 64);
  const customEnv = pickEnv(input, "env");

  const env: Record<string, string> = {
    DEMO_ENV_NAME: envName,
    ...customEnv,
  };

  const script = [
    "set -euo pipefail",
    `echo "[demo.server.echo] env DEMO_ENV_NAME=\${DEMO_ENV_NAME:-unset}"`,
    buildEchoScript("demo.server.echo", message, repeat, sleepSec),
  ].join("\n");

  const taskParams: Record<string, unknown> = {
    script,
    timeout_sec: timeoutSec,
    env,
  };
  if (cwd) taskParams.cwd = cwd;

  return {
    taskType: "server_script",
    executeMode: "script",
    taskParams,
    maxRetries: 0,
  };
}

function buildRemoteScriptTask(input: Record<string, unknown>): PreparedTaskPayload {
  const message = pickString(input, "message", "hello from remote script demo", 300);
  const sleepSec = pickNumber(input, "sleep_sec", 2, 0, 20);
  const timeoutSec = pickNumber(input, "timeout_sec", Math.max(90, sleepSec + 30), 10, 3600);
  const cwd = pickOptionalString(input, "cwd", 300);
  const targetClientId = pickOptionalString(input, "target_client_id", 120);
  const requiredTags = pickStringArray(input, "required_tags");
  const customEnv = pickEnv(input, "env");
  const maxRetries = pickNumber(input, "max_retries", 1, 0, 10);

  const script = buildEchoScript("demo.client.scriptEcho", message, 1, sleepSec);
  const taskParams: Record<string, unknown> = {
    script,
    timeout_sec: timeoutSec,
    env: customEnv,
  };
  if (cwd) taskParams.cwd = cwd;
  if (requiredTags.length > 0) taskParams.required_tags = requiredTags;

  return {
    taskType: "remote_mac",
    executeMode: "script",
    taskParams,
    targetClientId,
    maxRetries,
  };
}

function buildRemoteServiceTask(input: Record<string, unknown>): PreparedTaskPayload {
  const payload = input.payload ?? input.service_payload ?? { demo: true };
  const timeoutSec = pickNumber(input, "timeout_sec", 120, 10, 3600);
  const targetClientId = pickOptionalString(input, "target_client_id", 120);
  const requiredTags = pickStringArray(input, "required_tags");
  const maxRetries = pickNumber(input, "max_retries", 1, 0, 10);

  const taskParams: Record<string, unknown> = {
    service_name: "demo.mock3s",
    service_payload: payload,
    timeout_sec: timeoutSec,
  };
  if (requiredTags.length > 0) taskParams.required_tags = requiredTags;

  return {
    taskType: "remote_mac",
    executeMode: "service",
    taskParams,
    targetClientId,
    maxRetries,
  };
}

const registeredTasks: RegisteredTaskInternal[] = [
  {
    taskName: "demo.server.echo",
    title: "服务器执行示例任务",
    description: "服务端本地脚本示例：按参数输出日志，便于验证日志展示与任务调度。",
    taskType: "server_script",
    executeMode: "script",
    params: [
      {
        name: "message",
        type: "string",
        required: false,
        description: "日志输出内容",
        defaultValue: "hello from server demo task",
      },
      {
        name: "repeat",
        type: "number",
        required: false,
        description: "循环输出次数 (1-20)",
        defaultValue: 3,
      },
      {
        name: "sleep_sec",
        type: "number",
        required: false,
        description: "每次输出后的等待秒数",
        defaultValue: 1,
      },
      {
        name: "env_name",
        type: "string",
        required: false,
        description: "写入环境变量 DEMO_ENV_NAME 的值",
        defaultValue: "demo",
      },
      {
        name: "timeout_sec",
        type: "number",
        required: false,
        description: "任务超时时间（秒）",
        defaultValue: 120,
      },
    ],
    exampleTaskParams: {
      message: "同步商品索引",
      repeat: 3,
      sleep_sec: 1,
      env_name: "prod",
    },
    buildTaskPayload: buildServerEchoTask,
  },
  {
    taskName: "demo.client.scriptEcho",
    title: "客户端脚本示例任务",
    description: "分发到 Mac Mini 客户端执行脚本，输出日志后返回完成状态。",
    taskType: "remote_mac",
    executeMode: "script",
    params: [
      {
        name: "message",
        type: "string",
        required: false,
        description: "客户端脚本日志内容",
        defaultValue: "hello from remote script demo",
      },
      {
        name: "sleep_sec",
        type: "number",
        required: false,
        description: "脚本等待秒数",
        defaultValue: 2,
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
        description: "客户端标签过滤（如 ['xcode']）",
      },
      {
        name: "env",
        type: "object",
        required: false,
        description: "脚本环境变量对象",
      },
    ],
    exampleTaskParams: {
      message: "执行客户端脚本构建前检查",
      sleep_sec: 2,
      required_tags: ["xcode"],
    },
    buildTaskPayload: buildRemoteScriptTask,
  },
  {
    taskName: "demo.client.mock3s",
    title: "客户端服务示例任务",
    description: "调用客户端已注册服务 demo.mock3s，服务执行完成后返回 output_json。",
    taskType: "remote_mac",
    executeMode: "service",
    serviceName: "demo.mock3s",
    params: [
      {
        name: "payload",
        type: "object",
        required: false,
        description: "传给客户端服务的入参对象",
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
      {
        name: "timeout_sec",
        type: "number",
        required: false,
        description: "任务超时时间（秒）",
        defaultValue: 120,
      },
    ],
    exampleTaskParams: {
      payload: {
        build_id: "build-20260302-001",
        branch: "main",
        notify: true,
      },
      required_tags: ["xcode"],
    },
    buildTaskPayload: buildRemoteServiceTask,
  },
];

const taskMap = new Map<string, RegisteredTaskInternal>(registeredTasks.map((item) => [item.taskName, item]));

export function listRegisteredTasks(): RegisteredTaskDefinition[] {
  return registeredTasks.map(cloneDefinition);
}

export function prepareRegisteredTask(taskName: string, taskParams: unknown): PrepareRegisteredTaskResult {
  const normalizedTaskName = taskName.trim();
  const matched = taskMap.get(normalizedTaskName);
  if (!matched) {
    return {
      ok: false,
      code: 404,
      message: `任务不存在: ${taskName}`,
    };
  }

  const paramsObj = normalizeObject(taskParams);
  const payload = matched.buildTaskPayload(paramsObj);
  return {
    ok: true,
    definition: cloneDefinition(matched),
    payload,
  };
}
