import { spawn } from "child_process";
import { PrismaClient, Task } from "@prisma/client";

const LOCAL_EXECUTOR_ID = "server-local";
const LOCAL_POLL_INTERVAL_MS = parseInt(process.env.LOCAL_EXECUTOR_POLL_MS || "2000", 10);
const LOCAL_CONCURRENCY = Math.max(1, parseInt(process.env.LOCAL_EXECUTOR_CONCURRENCY || "1", 10));
const OFFLINE_SWEEP_INTERVAL_MS = parseInt(process.env.EXECUTOR_SWEEP_INTERVAL_MS || "10000", 10);
const OFFLINE_TIMEOUT_MS = parseInt(process.env.EXECUTOR_OFFLINE_TIMEOUT_MS || "60000", 10);
const REMOTE_TASK_STALE_TIMEOUT_MS = parseInt(process.env.REMOTE_TASK_STALE_TIMEOUT_MS || "300000", 10);
const MAX_LOG_BYTES = parseInt(process.env.TASK_LOG_MAX_BYTES || "65536", 10);

interface ParsedTaskParams {
  script: string;
  timeoutSec: number;
  env: Record<string, string>;
  cwd?: string;
}

interface ExecutionResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
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

function getTaskParams(task: Task): ParsedTaskParams | null {
  const parsed = parseJson<Record<string, unknown>>(task.taskParams, {});
  const script = typeof parsed.script === "string" ? parsed.script : "";
  if (!script.trim()) return null;

  const timeoutSec =
    typeof parsed.timeout_sec === "number" && Number.isFinite(parsed.timeout_sec)
      ? Math.max(1, Math.min(3600, Math.floor(parsed.timeout_sec)))
      : typeof parsed.timeoutSec === "number" && Number.isFinite(parsed.timeoutSec)
        ? Math.max(1, Math.min(3600, Math.floor(parsed.timeoutSec)))
        : 300;

  const envRaw = typeof parsed.env === "object" && parsed.env != null ? (parsed.env as Record<string, unknown>) : {};
  const env: Record<string, string> = {};
  Object.entries(envRaw).forEach(([k, v]) => {
    if (typeof v === "string") env[k] = v;
    else if (typeof v === "number" || typeof v === "boolean") env[k] = String(v);
  });

  const cwd = typeof parsed.cwd === "string" && parsed.cwd.trim() ? parsed.cwd : undefined;
  return { script, timeoutSec, env, cwd };
}

function executeScript(params: ParsedTaskParams): Promise<ExecutionResult> {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];
    let timedOut = false;

    const child = spawn("bash", ["-lc", params.script], {
      env: { ...process.env, ...params.env },
      cwd: params.cwd,
    });

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, params.timeoutSec * 1000);

    child.stdout.on("data", (chunk: Buffer | string) => {
      stdoutChunks.push(chunk.toString());
    });
    child.stderr.on("data", (chunk: Buffer | string) => {
      stderrChunks.push(chunk.toString());
    });

    child.on("close", (code: number | null, signal: NodeJS.Signals | null) => {
      clearTimeout(timeout);
      resolve({
        code,
        signal,
        stdout: stdoutChunks.join(""),
        stderr: stderrChunks.join(""),
        timedOut,
        durationMs: Date.now() - startedAt,
      });
    });
  });
}

async function markTaskError(prisma: PrismaClient, taskId: number, message: string): Promise<void> {
  const now = new Date();
  await prisma.task.update({
    where: { id: taskId },
    data: {
      status: "error",
      statusInfo: JSON.stringify({
        executor: "server",
        error: message,
        finished_at: now.toISOString(),
      }),
      finishedAt: now,
    },
  });
}

async function executeLocalTask(prisma: PrismaClient, task: Task): Promise<void> {
  const params = getTaskParams(task);
  if (!params) {
    await markTaskError(prisma, task.id, "taskParams.script 不能为空");
    return;
  }

  const result = await executeScript(params);
  const now = new Date();
  const fullLog = [
    "[stdout]",
    result.stdout || "(empty)",
    "",
    "[stderr]",
    result.stderr || "(empty)",
  ].join("\n");

  const nextStatus = !result.timedOut && result.code === 0 ? "completed" : "error";
  const statusInfo = nextStatus === "completed"
    ? {
        executor: "server",
        duration_ms: result.durationMs,
        result_code: result.code,
        finished_at: now.toISOString(),
      }
    : {
        executor: "server",
        duration_ms: result.durationMs,
        result_code: result.code,
        signal: result.signal,
        timeout: result.timedOut,
        error: result.timedOut ? "执行超时" : "脚本执行失败",
        finished_at: now.toISOString(),
      };

  await prisma.task.update({
    where: { id: task.id },
    data: {
      status: nextStatus,
      resultCode: result.code ?? -1,
      statusInfo: JSON.stringify(statusInfo),
      executionLog: trimLog(fullLog),
      finishedAt: now,
    },
  });
}

async function claimNextLocalTask(prisma: PrismaClient): Promise<Task | null> {
  const candidates = await prisma.task.findMany({
    where: {
      status: "queued",
      taskType: "server_script",
    },
    orderBy: { createdAt: "asc" },
    take: 50,
  });

  if (candidates.length === 0) return null;
  const task = candidates.find((item) => {
    const parsed = getTaskParams(item);
    return !!parsed?.script.trim();
  });
  if (!task) return null;

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
        executor: "server",
        started_at: now.toISOString(),
      }),
    },
  });

  if (claimed.count === 0) return null;
  return prisma.task.findUnique({ where: { id: task.id } });
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
      taskType: "remote_mac",
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
            task_type: "remote_mac",
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
          executor: "remote_mac",
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

  void scheduleLocalTasks(prisma);
  void refreshExecutorStatus(prisma);
  void recoverStaleRemoteTasks(prisma);

  setInterval(() => {
    void scheduleLocalTasks(prisma);
  }, LOCAL_POLL_INTERVAL_MS);

  setInterval(() => {
    void refreshExecutorStatus(prisma);
    void recoverStaleRemoteTasks(prisma);
  }, OFFLINE_SWEEP_INTERVAL_MS);
}

