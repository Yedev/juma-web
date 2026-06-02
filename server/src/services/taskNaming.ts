export type TaskType = "server_task" | "client_task";

const TASK_NAME_PATTERN = /^(server|client)\.[a-zA-Z0-9_-]+$/;

export function normalizeTaskName(taskName: string): string {
  return taskName.trim();
}

export function inferTaskTypeFromName(taskName: string): TaskType | null {
  const normalized = normalizeTaskName(taskName);
  if (!TASK_NAME_PATTERN.test(normalized)) return null;
  if (normalized.startsWith("server.")) return "server_task";
  return "client_task";
}

export function taskNameRuleText(): string {
  return "task_name 命名必须是 server.name 或 client.name";
}

