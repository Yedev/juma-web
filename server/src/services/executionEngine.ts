import { PrismaClient, Task } from "@prisma/client";
import { executeServerTaskByName, hasServerTask } from "./serverTaskRuntime";

const LOCAL_EXECUTOR_ID = "server-local";
const LOCAL_POLL_INTERVAL_MS = parseInt(process.env.LOCAL_EXECUTOR_POLL_MS || "2000", 10);
const LOCAL_CONCURRENCY = Math.max(1, parseInt(process.env.LOCAL_EXECUTOR_CONCURRENCY || "1", 10));
const OFFLINE_SWEEP_INTERVAL_MS = parseInt(process.env.EXECUTOR_SWEEP_INTERVAL_MS || "10000", 10);
const OFFLINE_TIMEOUT_MS = parseInt(process.env.EXECUTOR_OFFLINE_TIMEOUT_MS || "60000", 10);
const REMOTE_TASK_STALE_TIMEOUT_MS = parseInt(process.env.REMOTE_TASK_STALE_TIMEOUT_MS || "300000", 10);
const MAX_LOG_BYTES = parseInt(process.env.TASK_LOG_MAX_BYTES || "65536", 10);

interface ParsedTaskEnvelope {
  taskPayload: Record<string, unknown>;
  executionName?: string;
}

let started = false;
let processingLocalQueue = false;
let localRunningCount = 0;

function parseJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function normalizeObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function trimLog(input: string): string {
  if (Buffer.byteLength(input, "utf8") <= MAX_LOG_BYTES) return input;
  const marker = "\n... [truncated]\n";
  const available = Math.max(0, MAX_LOG_BYTES - Buffer.byteLength(marker, "utf8"));
  let output = "";
  let bytes = 0;
  for (let i = input.length - 1; i >= 0; i -= 1) {
    const ch = input[i];
    const chBytes = Buffer.byteLength(ch, "utf8");
    if (bytes + chBytes > available) break;
    output = ch + output;
    bytes += chBytes;
  }
  return `${marker}${output}`;
}

function parseTaskEnvelope(task: Task): ParsedTaskEnvelope {
  const parsed = parseJson<Record<string, unknown>>(task.taskParams, {});
  const payload = normalizeObject(parsed.task_payload ?? parsed.taskPayload ?? parsed.payload);
  const executionNameRaw = parsed.execution_name ?? parsed.executionName;
  const executionName =
    typeof executionNameRaw === "string" && executionNameRaw.trim() ? executionNameRaw.trim().slice(0, 120) : undefined;
  return {
    taskPayload: payload,
    executionName,
  };
}

async function markTaskError(prisma: PrismaClient, taskId: number, message: string): Promise<void> {
  const now = new Date();
  await prisma.task.update({
    where: { id: taskId },
    data: {
      status: "error",
      resultCode: -1,
      statusInfo: JSON.stringify({
        executor: "server_task_runtime",
        error: message,
        finished_at: now.toISOString(),
      }),
      finishedAt: now,
    },
  });
}

async function executeLocalTask(prisma: PrismaClient, task: Task): Promise<void> {
  if (!hasServerTask(task.taskName)) {
    await markTaskError(prisma, task.id, `未注册的服务端任务: ${task.taskName}`);
    return;
  }

  const envelope = parseTaskEnvelope(task);
  const startedAt = Date.now();
  const logs: string[] = [];
  const writeLog = (line: string): void => {
    logs.push(line);
  };

  try {
    const output = await executeServerTaskByName(task.taskName, envelope.taskPayload, {
      taskId: task.taskId,
      executionName: envelope.executionName,
      log: writeLog,
    });
    const now = new Date();
    await prisma.task.update({
      where: { id: task.id },
      data: {
        status: "completed",
        resultCode: 0,
        executionLog: trimLog(logs.join("\n")),
        statusInfo: JSON.stringify({
          executor: "server_task_runtime",
          duration_ms: Date.now() - startedAt,
          task_name: task.taskName,
          execution_name: envelope.executionName,
          output_json: output,
          finished_at: now.toISOString(),
        }),
        finishedAt: now,
      },
    });
  } catch (error) {
    const now = new Date();
    const errorObj = error as { message?: string; stack?: string };
    const errorMessage = errorObj?.message || "服务端任务执行失败";
    const logText = [logs.join("\n"), errorObj?.stack || errorMessage].filter(Boolean).join("\n\n");
    await prisma.task.update({
      where: { id: task.id },
      data: {
        status: "error",
        resultCode: -1,
        executionLog: trimLog(logText),
        statusInfo: JSON.stringify({
          executor: "server_task_runtime",
          duration_ms: Date.now() - startedAt,
          task_name: task.taskName,
          execution_name: envelope.executionName,
          error: errorMessage,
          finished_at: now.toISOString(),
        }),
        finishedAt: now,
      },
    });
  }
}

async function claimNextLocalTask(prisma: PrismaClient): Promise<Task | null> {
  const candidates = await prisma.task.findMany({
    where: {
      status: "queued",
      taskType: "server_task",
    },
    orderBy: { createdAt: "asc" },
    take: 50,
  });

  if (candidates.length === 0) return null;
  const task = candidates[0];

  const now = new Date();
  const claimed = await prisma.task.updateMany({
    where: {
      id: task.id,
      status: "queued",
    },
    data: {
      status: "running",
      claimedByClientId: LOCAL_EXECUTOR_ID,
      claimedAt: now,
      startedAt: now,
      statusInfo: JSON.stringify({
        executor: "server_task_runtime",
        started_at: now.toISOString(),
      }),
    },
  });

  if (claimed.count === 0) return null;
  return prisma.task.findUnique({ where: { id: task.id } });
}

async function failLegacyQueuedTasks(prisma: PrismaClient): Promise<void> {
  const legacy = await prisma.task.findMany({
    where: {
      status: "queued",
      taskType: {
        in: ["server_script", "remote_mac"],
      },
    },
    orderBy: { createdAt: "asc" },
    take: 100,
  });
  if (legacy.length === 0) return;

  const now = new Date();
  for (const item of legacy) {
    await prisma.task.update({
      where: { id: item.id },
      data: {
        status: "error",
        resultCode: -1,
        finishedAt: now,
        statusInfo: JSON.stringify({
          executor: "task_runtime",
          error: "脚本/服务模式已下线，仅支持 task_name + task_payload",
          finished_at: now.toISOString(),
        }),
      },
    });
  }
}

async function scheduleLocalTasks(prisma: PrismaClient): Promise<void> {
  if (processingLocalQueue) return;
  processingLocalQueue = true;
  try {
    while (localRunningCount < LOCAL_CONCURRENCY) {
      const task = await claimNextLocalTask(prisma);
      if (!task) break;

      localRunningCount += 1;
      void executeLocalTask(prisma, task)
        .catch((error: unknown) => {
          console.error("Local task execute error:", error);
        })
        .finally(() => {
          localRunningCount -= 1;
          void scheduleLocalTasks(prisma);
        });
    }
  } finally {
    processingLocalQueue = false;
  }
}

async function refreshExecutorStatus(prisma: PrismaClient): Promise<void> {
  const cutoff = new Date(Date.now() - OFFLINE_TIMEOUT_MS);
  await prisma.executorClient.updateMany({
    where: {
      lastHeartbeat: { lt: cutoff },
      status: { not: "offline" },
    },
    data: { status: "offline" },
  });
  await prisma.executorClient.updateMany({
    where: {
      lastHeartbeat: { gte: cutoff },
      status: "offline",
    },
    data: { status: "online" },
  });
}

async function recoverStaleRemoteTasks(prisma: PrismaClient): Promise<void> {
  const staleCutoff = new Date(Date.now() - REMOTE_TASK_STALE_TIMEOUT_MS);
  const offlineCutoff = new Date(Date.now() - OFFLINE_TIMEOUT_MS);

  const staleTasks = await prisma.task.findMany({
    where: {
      taskType: "client_task",
      status: "running",
      claimedAt: { lt: staleCutoff },
    },
    take: 100,
    orderBy: { claimedAt: "asc" },
  });
  if (staleTasks.length === 0) return;

  const clientIds = Array.from(
    new Set(staleTasks.map((task) => task.claimedByClientId).filter((id): id is string => Boolean(id)))
  );
  const clients = clientIds.length
    ? await prisma.executorClient.findMany({
        where: { clientId: { in: clientIds } },
      })
    : [];
  const clientMap = new Map(clients.map((client) => [client.clientId, client]));

  for (const task of staleTasks) {
    const clientId = task.claimedByClientId;
    const client = clientId ? clientMap.get(clientId) : null;
    const offline =
      !client ||
      client.status === "offline" ||
      client.lastHeartbeat.getTime() < offlineCutoff.getTime();

    if (!offline) {
      continue;
    }

    if (task.retryCount < task.maxRetries) {
      await prisma.task.update({
        where: { id: task.id },
        data: {
          status: "queued",
          claimedByClientId: null,
          claimedAt: null,
          startedAt: null,
          retryCount: { increment: 1 },
          statusInfo: JSON.stringify({
            queue_position: 0,
            task_type: "client_task",
            requeued: true,
            reason: "client offline while running",
            previous_client_id: clientId,
            retry_count: task.retryCount + 1,
          }),
        },
      });
      continue;
    }

    await prisma.task.update({
      where: { id: task.id },
      data: {
        status: "error",
        finishedAt: new Date(),
        statusInfo: JSON.stringify({
          executor: "client_task_runtime",
          error: "客户端离线且超过最大重试次数",
          previous_client_id: clientId,
          retry_count: task.retryCount,
        }),
      },
    });
  }
}

export function startExecutionEngine(prisma: PrismaClient): void {
  if (started) return;
  started = true;

  void failLegacyQueuedTasks(prisma);
  void scheduleLocalTasks(prisma);
  void refreshExecutorStatus(prisma);
  void recoverStaleRemoteTasks(prisma);

  setInterval(() => {
    void failLegacyQueuedTasks(prisma);
    void scheduleLocalTasks(prisma);
  }, LOCAL_POLL_INTERVAL_MS);

  setInterval(() => {
    void refreshExecutorStatus(prisma);
    void recoverStaleRemoteTasks(prisma);
  }, OFFLINE_SWEEP_INTERVAL_MS);
}

