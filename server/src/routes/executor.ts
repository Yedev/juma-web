import { NextFunction, Request, Response, Router } from "express";
import { PrismaClient, Prisma, Task } from "@prisma/client";
import { inferTaskTypeFromName } from "../services/taskNaming";

const router = Router();
const prisma = new PrismaClient();

const EXECUTOR_SHARED_KEY = process.env.EXECUTOR_SHARED_KEY || "juma_executor_2026";
const MAX_LOG_BYTES = parseInt(process.env.TASK_LOG_MAX_BYTES || "65536", 10);
const DEFAULT_POLL_MS = parseInt(process.env.EXECUTOR_POLL_INTERVAL_MS || "4000", 10);
const DEFAULT_HEARTBEAT_MS = parseInt(process.env.EXECUTOR_HEARTBEAT_INTERVAL_MS || "10000", 10);

type JsonObj = Record<string, unknown>;

interface RegisterBody {
  client_id?: unknown;
  name?: unknown;
  platform?: unknown;
  app_version?: unknown;
  tags?: unknown;
  capabilities?: unknown;
  tasks?: unknown;
  services?: unknown;
}

interface TaskDef {
  name: string;
  version?: string;
  description?: string;
}

interface ParsedTaskEnvelope {
  taskPayload: JsonObj;
  requiredTags: string[];
  executionName?: string;
}

function parseJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function trimLog(raw: string): string {
  if (Buffer.byteLength(raw, "utf8") <= MAX_LOG_BYTES) return raw;
  const marker = "\n... [truncated]\n";
  const markerBytes = Buffer.byteLength(marker, "utf8");
  const available = Math.max(0, MAX_LOG_BYTES - markerBytes);
  let tail = "";
  let bytes = 0;
  for (let i = raw.length - 1; i >= 0; i -= 1) {
    const ch = raw[i];
    const b = Buffer.byteLength(ch, "utf8");
    if (bytes + b > available) break;
    tail = ch + tail;
    bytes += b;
  }
  return `${marker}${tail}`;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v) => typeof v === "string")
    .map((v) => (v as string).trim())
    .filter(Boolean);
}

function normalizeObject(value: unknown): JsonObj {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as JsonObj;
}

function normalizeTasks(value: unknown): TaskDef[] {
  if (!Array.isArray(value)) return [];
  const dedupe = new Map<string, TaskDef>();
  value.forEach((item) => {
    if (typeof item === "string") {
      const name = item.trim();
      if (!name) return;
      if (inferTaskTypeFromName(name) !== "client_task") return;
      dedupe.set(name, { name });
      return;
    }
    if (!item || typeof item !== "object" || Array.isArray(item)) return;
    const obj = item as Record<string, unknown>;
    const name = typeof obj.name === "string" ? obj.name.trim() : "";
    if (!name) return;
    if (inferTaskTypeFromName(name) !== "client_task") return;
    const def: TaskDef = { name };
    if (typeof obj.version === "string" && obj.version.trim()) def.version = obj.version.trim();
    if (typeof obj.description === "string" && obj.description.trim()) def.description = obj.description.trim();
    dedupe.set(name, def);
  });
  return Array.from(dedupe.values());
}

function mergeCapabilities(base: JsonObj, latest: JsonObj, tasks: TaskDef[]): JsonObj {
  return {
    ...base,
    ...latest,
    tasks,
    // 兼容旧页面/旧客户端结构
    services: tasks,
    task_protocol_version: "1.0",
  };
}

function parseTaskEnvelope(task: Task): ParsedTaskEnvelope {
  const params = parseJson<JsonObj>(task.taskParams, {});
  const taskPayload = normalizeObject(params.task_payload ?? params.taskPayload ?? params.payload);
  const requiredTags = toStringArray(params.required_tags ?? params.requiredTags);
  const executionNameRaw = params.execution_name ?? params.executionName;
  const executionName =
    typeof executionNameRaw === "string" && executionNameRaw.trim() ? executionNameRaw.trim().slice(0, 120) : undefined;
  return { taskPayload, requiredTags, executionName };
}

function getClientIp(req: Request): string {
  const xfwd = req.headers["x-forwarded-for"];
  if (Array.isArray(xfwd)) return xfwd[0];
  if (typeof xfwd === "string") return xfwd.split(",")[0].trim();
  return req.socket.remoteAddress || "unknown";
}

function authExecutor(req: Request, res: Response, next: NextFunction): void {
  const key = req.headers["x-executor-key"] as string | undefined;
  if (!key || key !== EXECUTOR_SHARED_KEY) {
    res.status(401).json({ code: 401, message: "Unauthorized executor key" });
    return;
  }
  next();
}

router.use(authExecutor);

router.post("/register", async (req: Request, res: Response): Promise<void> => {
  try {
    const body = req.body as RegisterBody;
    const clientId = typeof body.client_id === "string" ? body.client_id.trim() : "";
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const platform = typeof body.platform === "string" && body.platform.trim() ? body.platform.trim() : "darwin";
    const appVersion =
      typeof body.app_version === "string" && body.app_version.trim() ? body.app_version.trim() : "unknown";
    const tags = toStringArray(body.tags);
    const capabilities = normalizeObject(body.capabilities);
    const tasks = normalizeTasks(body.tasks ?? body.services ?? capabilities.tasks ?? capabilities.services);

    if (!clientId) {
      res.status(400).json({ code: 400, message: "client_id is required" });
      return;
    }
    if (!name) {
      res.status(400).json({ code: 400, message: "name is required" });
      return;
    }

    const now = new Date();
    const client = await prisma.executorClient.upsert({
      where: { clientId },
      update: {
        name,
        platform,
        appVersion,
        tags: JSON.stringify(tags),
        capabilities: JSON.stringify(mergeCapabilities({}, capabilities, tasks)),
        status: "online",
        ip: getClientIp(req),
        lastHeartbeat: now,
      },
      create: {
        clientId,
        name,
        platform,
        appVersion,
        tags: JSON.stringify(tags),
        capabilities: JSON.stringify(mergeCapabilities({}, capabilities, tasks)),
        status: "online",
        ip: getClientIp(req),
        lastHeartbeat: now,
      },
    });

    res.json({
      code: 200,
      message: "registered",
      data: {
        client_id: client.clientId,
        accepted_tasks: tasks,
        poll_interval_ms: DEFAULT_POLL_MS,
        heartbeat_interval_ms: DEFAULT_HEARTBEAT_MS,
        server_time: now.toISOString(),
      },
    });
  } catch (error) {
    console.error("Executor register error:", error);
    res.status(500).json({ code: 500, message: "服务器内部错误" });
  }
});

router.post("/heartbeat", async (req: Request, res: Response): Promise<void> => {
  try {
    const clientId = typeof req.body?.client_id === "string" ? req.body.client_id.trim() : "";
    const capabilities = normalizeObject(req.body?.capabilities);
    const tasks = normalizeTasks(req.body?.tasks ?? req.body?.services ?? capabilities.tasks ?? capabilities.services);
    if (!clientId) {
      res.status(400).json({ code: 400, message: "client_id is required" });
      return;
    }

    const existing = await prisma.executorClient.findUnique({ where: { clientId } });
    if (!existing) {
      res.status(404).json({ code: 404, message: "client not registered" });
      return;
    }

    await prisma.executorClient.update({
      where: { clientId },
      data: {
        status: "online",
        ip: getClientIp(req),
        lastHeartbeat: new Date(),
        capabilities:
          Object.keys(capabilities).length || tasks.length
            ? JSON.stringify(mergeCapabilities(parseJson<JsonObj>(existing.capabilities, {}), capabilities, tasks))
            : existing.capabilities,
      },
    });

    res.json({ code: 200, message: "ok" });
  } catch (error) {
    console.error("Executor heartbeat error:", error);
    res.status(500).json({ code: 500, message: "服务器内部错误" });
  }
});

router.post("/next-task", async (req: Request, res: Response): Promise<void> => {
  try {
    const clientId = typeof req.body?.client_id === "string" ? req.body.client_id.trim() : "";
    if (!clientId) {
      res.status(400).json({ code: 400, message: "client_id is required" });
      return;
    }

    const client = await prisma.executorClient.findUnique({ where: { clientId } });
    if (!client) {
      res.status(404).json({ code: 404, message: "client not registered" });
      return;
    }

    const clientTags = toStringArray(parseJson<unknown[]>(client.tags, []));
    const parsedCapabilities = parseJson<JsonObj>(client.capabilities, {});
    const clientTasks = normalizeTasks(parsedCapabilities.tasks ?? parsedCapabilities.services);
    const clientTaskNames = new Set(clientTasks.map((item) => item.name));

    await prisma.executorClient.update({
      where: { clientId },
      data: {
        status: "online",
        ip: getClientIp(req),
        lastHeartbeat: new Date(),
      },
    });

    const candidates = await prisma.task.findMany({
      where: {
        status: "queued",
        taskType: "client_task",
      },
      orderBy: { createdAt: "asc" },
      take: 50,
    });

    for (const task of candidates) {
      if (inferTaskTypeFromName(task.taskName) !== "client_task") {
        await prisma.task.update({
          where: { id: task.id },
          data: {
            status: "error",
            statusInfo: JSON.stringify({
              executor: "client_task_runtime",
              error: "task_name 命名非法，客户端任务必须是 client.name",
            }),
            finishedAt: new Date(),
          },
        });
        continue;
      }

      if (task.targetClientId && task.targetClientId !== clientId) {
        continue;
      }

      const envelope = parseTaskEnvelope(task);
      if (envelope.requiredTags.length > 0) {
        const matched = envelope.requiredTags.every((tag) => clientTags.includes(tag));
        if (!matched) continue;
      }
      if (!clientTaskNames.has(task.taskName)) {
        continue;
      }

      const now = new Date();
      const claimed = await prisma.task.updateMany({
        where: {
          id: task.id,
          status: "queued",
        },
        data: {
          status: "running",
          claimedByClientId: clientId,
          claimedAt: now,
          startedAt: now,
          statusInfo: JSON.stringify({
            executor: "client_task_runtime",
            client_id: clientId,
            started_at: now.toISOString(),
          }),
        },
      });
      if (claimed.count === 0) continue;

      await prisma.executorClient.update({
        where: { clientId },
        data: { tasksClaimed: { increment: 1 } },
      });

      res.json({
        code: 200,
        message: "task_assigned",
        data: {
          task_id: task.taskId,
          task_name: task.taskName,
          task_payload: envelope.taskPayload,
          execution_name: envelope.executionName,
        },
      });
      return;
    }

    res.json({ code: 200, message: "no_task", data: null });
  } catch (error) {
    console.error("Executor next-task error:", error);
    res.status(500).json({ code: 500, message: "服务器内部错误" });
  }
});

router.post("/task-update", async (req: Request, res: Response): Promise<void> => {
  try {
    const clientId = typeof req.body?.client_id === "string" ? req.body.client_id.trim() : "";
    const taskId = typeof req.body?.task_id === "string" ? req.body.task_id.trim() : "";
    const status = typeof req.body?.status === "string" ? req.body.status.trim() : "";
    const appendLog = typeof req.body?.append_log === "string" ? req.body.append_log : "";
    const resultCode = typeof req.body?.result_code === "number" ? req.body.result_code : null;
    const statusInfoRaw = normalizeObject(req.body?.status_info);

    if (!clientId || !taskId || !status) {
      res.status(400).json({ code: 400, message: "client_id, task_id, status are required" });
      return;
    }

    if (!["running", "completed", "error"].includes(status)) {
      res.status(400).json({ code: 400, message: "status must be running/completed/error" });
      return;
    }

    const task = await prisma.task.findUnique({ where: { taskId } });
    if (!task) {
      res.status(404).json({ code: 404, message: "task not found" });
      return;
    }

    if (task.taskType !== "client_task") {
      res.status(400).json({ code: 400, message: "task type mismatch" });
      return;
    }

    if (task.claimedByClientId && task.claimedByClientId !== clientId) {
      res.status(403).json({ code: 403, message: "task not claimed by this client" });
      return;
    }

    const now = new Date();
    const oldInfo = parseJson<JsonObj>(task.statusInfo, {});
    const mergedInfo: JsonObj = {
      ...oldInfo,
      ...statusInfoRaw,
      executor: "client_task_runtime",
      client_id: clientId,
      reported_at: now.toISOString(),
    };

    const data: Prisma.TaskUpdateInput = {
      status,
      statusInfo: JSON.stringify(mergedInfo),
    };

    if (appendLog) {
      data.executionLog = trimLog(task.executionLog ? `${task.executionLog}\n${appendLog}` : appendLog);
    }
    if (status === "running" && !task.startedAt) {
      data.startedAt = now;
    }
    if (status === "completed" || status === "error") {
      data.finishedAt = now;
      if (resultCode != null) data.resultCode = resultCode;
    }

    await prisma.task.update({
      where: { taskId },
      data,
    });

    if (status === "completed") {
      await prisma.executorClient.update({
        where: { clientId },
        data: { tasksSuccess: { increment: 1 } },
      });
    } else if (status === "error") {
      await prisma.executorClient.update({
        where: { clientId },
        data: { tasksFailed: { increment: 1 } },
      });
    }

    await prisma.executorClient.update({
      where: { clientId },
      data: { status: "online", lastHeartbeat: now },
    });

    res.json({ code: 200, message: "ok" });
  } catch (error) {
    console.error("Executor task-update error:", error);
    res.status(500).json({ code: 500, message: "服务器内部错误" });
  }
});

export default router;

