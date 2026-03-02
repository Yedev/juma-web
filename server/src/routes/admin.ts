import { Router, Response } from "express";
import { PrismaClient } from "@prisma/client";
import { authMiddleware, AuthRequest } from "../middleware/auth";
import { listRegisteredTasks } from "../services/taskRegistry";
import { enqueueTaskByRegisteredName } from "../services/taskEnqueue";
import { inferTaskTypeFromName, taskNameRuleText } from "../services/taskNaming";
import { hasServerTask } from "../services/serverTaskRuntime";

const router = Router();
const prisma = new PrismaClient();
const validTaskStatuses = ["queued", "running", "error", "completed"] as const;

type TaskStatus = (typeof validTaskStatuses)[number];

function parseObjectField(
  value: unknown,
  fieldName: string
): { ok: true; data: Record<string, unknown> } | { ok: false; message: string } {
  if (value == null) {
    return { ok: true, data: {} };
  }

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return { ok: true, data: parsed as Record<string, unknown> };
      }
      return { ok: false, message: `${fieldName} 必须是 JSON 对象` };
    } catch {
      return { ok: false, message: `${fieldName} 不是合法 JSON` };
    }
  }

  if (typeof value === "object" && !Array.isArray(value)) {
    return { ok: true, data: value as Record<string, unknown> };
  }

  return { ok: false, message: `${fieldName} 必须是对象或 JSON 字符串` };
}

function generateTaskId(): string {
  return `T${Date.now()}${Math.floor(Math.random() * 1000)
    .toString()
    .padStart(3, "0")}`;
}

function parseArrayField(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v) => typeof v === "string")
    .map((v) => (v as string).trim())
    .filter(Boolean);
}

function normalizeTaskList(value: unknown): Array<{ name: string; version?: string; description?: string }> {
  if (!Array.isArray(value)) return [];
  const dedupe = new Map<string, { name: string; version?: string; description?: string }>();
  value.forEach((item) => {
    if (typeof item === "string") {
      const name = item.trim();
      if (!name) return;
      dedupe.set(name, { name });
      return;
    }
    if (!item || typeof item !== "object" || Array.isArray(item)) return;
    const obj = item as Record<string, unknown>;
    const name = typeof obj.name === "string" ? obj.name.trim() : "";
    if (!name) return;
    dedupe.set(name, {
      name,
      version: typeof obj.version === "string" && obj.version.trim() ? obj.version.trim() : undefined,
      description:
        typeof obj.description === "string" && obj.description.trim() ? obj.description.trim() : undefined,
    });
  });
  return Array.from(dedupe.values());
}

router.use(authMiddleware);

// ── Tasks ───────────────────────────────────────────────

router.get("/task-definitions", async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const list = listRegisteredTasks();
    res.json({
      code: 200,
      message: "success",
      data: {
        list,
        total: list.length,
      },
    });
  } catch (error) {
    console.error("List task definitions error:", error);
    res.status(500).json({ code: 500, message: "服务器内部错误" });
  }
});

router.post("/tasks/execute-by-name", async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { taskName, taskPayload, executionName } = req.body as {
      taskName?: unknown;
      taskPayload?: unknown;
      executionName?: unknown;
    };
    if (typeof taskName !== "string" || !taskName.trim()) {
      res.status(400).json({ code: 400, message: "taskName 不能为空" });
      return;
    }

    const parsedTaskPayload = parseObjectField(taskPayload, "taskPayload");
    if (!parsedTaskPayload.ok) {
      res.status(400).json({ code: 400, message: parsedTaskPayload.message });
      return;
    }

    const enqueueResult = await enqueueTaskByRegisteredName(prisma, {
      taskName: taskName.trim(),
      taskPayload: parsedTaskPayload.data,
      executionName,
    });
    if (!enqueueResult.ok) {
      res.status(enqueueResult.code).json({ code: enqueueResult.code, message: enqueueResult.message });
      return;
    }

    res.json({
      code: 200,
      message: "任务已创建",
      data: enqueueResult.data,
    });
  } catch (error) {
    console.error("Execute task by name error:", error);
    res.status(500).json({ code: 500, message: "服务器内部错误" });
  }
});

router.get("/tasks", async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const pageSize = parseInt(req.query.pageSize as string) || 20;
    const skip = (page - 1) * pageSize;

    const [tasks, total] = await Promise.all([
      prisma.task.findMany({
        orderBy: { createdAt: "desc" },
        skip,
        take: pageSize,
      }),
      prisma.task.count(),
    ]);

    res.json({
      code: 200,
      message: "success",
      data: { list: tasks, total, page, pageSize },
    });
  } catch (error) {
    console.error("Get tasks error:", error);
    res.status(500).json({ code: 500, message: "服务器内部错误" });
  }
});

router.post("/tasks", async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const {
      taskName,
      taskPayload,
      executionName,
      targetClientId,
      requiredTags,
      maxRetries,
    } = req.body as {
      taskName?: unknown;
      taskPayload?: unknown;
      executionName?: unknown;
      targetClientId?: unknown;
      requiredTags?: unknown;
      maxRetries?: unknown;
    };

    if (typeof taskName !== "string" || !taskName.trim()) {
      res.status(400).json({ code: 400, message: "taskName 不能为空" });
      return;
    }

    const normalizedTaskName = taskName.trim();
    const inferredTaskType = inferTaskTypeFromName(normalizedTaskName);
    if (!inferredTaskType) {
      res.status(400).json({ code: 400, message: taskNameRuleText() });
      return;
    }
    if (inferredTaskType === "server_task" && !hasServerTask(normalizedTaskName)) {
      res.status(400).json({ code: 400, message: `未注册的服务端任务: ${normalizedTaskName}` });
      return;
    }

    const normalizedMaxRetries =
      typeof maxRetries === "number" && Number.isFinite(maxRetries)
        ? Math.max(0, Math.min(10, Math.floor(maxRetries)))
        : 0;

    const parsedTaskPayload = parseObjectField(taskPayload, "taskPayload");
    if (!parsedTaskPayload.ok) {
      res.status(400).json({ code: 400, message: parsedTaskPayload.message });
      return;
    }

    const normalizedExecutionName =
      typeof executionName === "string" && executionName.trim() ? executionName.trim().slice(0, 120) : undefined;
    const normalizedTargetClientId =
      typeof targetClientId === "string" && targetClientId.trim()
        ? targetClientId.trim()
        : undefined;
    const normalizedRequiredTags = parseArrayField(requiredTags);

    const normalizedTaskParams: Record<string, unknown> = {
      task_payload: parsedTaskPayload.data,
      required_tags: normalizedRequiredTags,
    };
    if (normalizedExecutionName) normalizedTaskParams.execution_name = normalizedExecutionName;

    const queueCount = await prisma.task.count({
      where: { status: "queued" },
    });

    const queueInfo: Record<string, unknown> = {
      queue_position: queueCount + 1,
      task_type: inferredTaskType,
      execution_name: normalizedExecutionName,
    };
    if (inferredTaskType === "client_task" && normalizedTargetClientId) {
      queueInfo.target_client_id = normalizedTargetClientId;
    }
    if (inferredTaskType === "client_task" && normalizedRequiredTags.length > 0) queueInfo.required_tags = normalizedRequiredTags;

    const created = await prisma.task.create({
      data: {
        taskId: generateTaskId(),
        taskName: normalizedTaskName,
        taskType: inferredTaskType,
        targetClientId: inferredTaskType === "client_task" ? normalizedTargetClientId : null,
        taskParams: JSON.stringify(normalizedTaskParams),
        status: "queued",
        statusInfo: JSON.stringify(queueInfo),
        maxRetries: inferredTaskType === "client_task" ? normalizedMaxRetries : 0,
      },
    });

    res.json({
      code: 200,
      message: "任务已创建",
      data: created,
    });
  } catch (error) {
    console.error("Create task error:", error);
    res.status(500).json({ code: 500, message: "服务器内部错误" });
  }
});

router.put("/tasks/:taskId/status", async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const taskId = req.params.taskId as string;
    const { status, statusInfo } = req.body as { status?: unknown; statusInfo?: unknown };

    if (typeof status !== "string" || !validTaskStatuses.includes(status as (typeof validTaskStatuses)[number])) {
      res.status(400).json({
        code: 400,
        message: `status 必须是以下之一: ${validTaskStatuses.join(", ")}`,
      });
      return;
    }

    const parsedStatusInfo = parseObjectField(statusInfo, "statusInfo");
    if (!parsedStatusInfo.ok) {
      res.status(400).json({ code: 400, message: parsedStatusInfo.message });
      return;
    }

    const existing = await prisma.task.findUnique({ where: { taskId } });
    if (!existing) {
      res.status(404).json({ code: 404, message: "任务不存在" });
      return;
    }

    const updated = await prisma.task.update({
      where: { taskId },
      data: {
        status: status as TaskStatus,
        statusInfo: JSON.stringify(parsedStatusInfo.data),
        startedAt: status === "running" ? existing.startedAt || new Date() : existing.startedAt,
        finishedAt: status === "completed" || status === "error" ? new Date() : null,
      },
    });

    res.json({
      code: 200,
      message: "任务状态已更新",
      data: updated,
    });
  } catch (error) {
    console.error("Update task status error:", error);
    res.status(500).json({ code: 500, message: "服务器内部错误" });
  }
});

router.delete("/tasks/:taskId", async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const taskId = req.params.taskId as string;

    const existing = await prisma.task.findUnique({ where: { taskId } });
    if (!existing) {
      res.status(404).json({ code: 404, message: "任务不存在" });
      return;
    }

    await prisma.task.delete({ where: { taskId } });

    res.json({ code: 200, message: "任务已删除" });
  } catch (error) {
    console.error("Delete task error:", error);
    res.status(500).json({ code: 500, message: "服务器内部错误" });
  }
});

router.get("/executor/clients", async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const clients = await prisma.executorClient.findMany({
      orderBy: [{ status: "asc" }, { lastHeartbeat: "desc" }],
    });

    res.json({
      code: 200,
      message: "success",
      data: clients.map((client) => ({
        id: client.id,
        clientId: client.clientId,
        name: client.name,
        platform: client.platform,
        appVersion: client.appVersion,
        tags: (() => {
          try {
            return JSON.parse(client.tags);
          } catch {
            return [];
          }
        })(),
        capabilities: (() => {
          try {
            return JSON.parse(client.capabilities);
          } catch {
            return {};
          }
        })(),
        tasks: (() => {
          try {
            const capabilities = JSON.parse(client.capabilities) as { tasks?: unknown };
            return normalizeTaskList(capabilities.tasks);
          } catch {
            return [];
          }
        })(),
        status: client.status,
        ip: client.ip,
        lastHeartbeat: client.lastHeartbeat,
        tasksClaimed: client.tasksClaimed,
        tasksSuccess: client.tasksSuccess,
        tasksFailed: client.tasksFailed,
        createdAt: client.createdAt,
        updatedAt: client.updatedAt,
      })),
    });
  } catch (error) {
    console.error("List executor clients error:", error);
    res.status(500).json({ code: 500, message: "服务器内部错误" });
  }
});

router.delete("/executor/clients/:clientId", async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const clientId = req.params.clientId as string;
    const existing = await prisma.executorClient.findUnique({ where: { clientId } });
    if (!existing) {
      res.status(404).json({ code: 404, message: "客户端不存在" });
      return;
    }

    await prisma.executorClient.delete({ where: { clientId } });
    res.json({ code: 200, message: "客户端已删除" });
  } catch (error) {
    console.error("Delete executor client error:", error);
    res.status(500).json({ code: 500, message: "服务器内部错误" });
  }
});

// ── Configs (multi-key) ─────────────────────────────────

router.get("/configs", async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const configs = await prisma.appConfig.findMany({
      orderBy: { updatedAt: "desc" },
    });

    res.json({
      code: 200,
      message: "success",
      data: configs.map((c) => ({
        id: c.id,
        configKey: c.configKey,
        updatedAt: c.updatedAt,
      })),
    });
  } catch (error) {
    console.error("List configs error:", error);
    res.status(500).json({ code: 500, message: "服务器内部错误" });
  }
});

router.get("/config/:key", async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const key = req.params.key as string;
    const config = await prisma.appConfig.findUnique({
      where: { configKey: key },
    });

    if (!config) {
      res.status(404).json({ code: 404, message: "配置不存在" });
      return;
    }

    res.json({
      code: 200,
      message: "success",
      data: {
        configKey: config.configKey,
        configValue: config.configValue,
        updatedAt: config.updatedAt,
      },
    });
  } catch (error) {
    console.error("Get config error:", error);
    res.status(500).json({ code: 500, message: "服务器内部错误" });
  }
});

router.put("/config/:key", async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const key = req.params.key as string;
    const { configValue } = req.body;

    if (typeof configValue !== "string") {
      res.status(400).json({ code: 400, message: "configValue 必须是字符串" });
      return;
    }

    try {
      JSON.parse(configValue);
    } catch {
      res.status(400).json({ code: 400, message: "JSON 格式不合法" });
      return;
    }

    const updated = await prisma.appConfig.upsert({
      where: { configKey: key },
      update: { configValue },
      create: { configKey: key, configValue },
    });

    res.json({
      code: 200,
      message: "配置已保存并发布",
      data: {
        configKey: updated.configKey,
        configValue: updated.configValue,
        updatedAt: updated.updatedAt,
      },
    });
  } catch (error) {
    console.error("Update config error:", error);
    res.status(500).json({ code: 500, message: "服务器内部错误" });
  }
});

router.delete("/config/:key", async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const key = req.params.key as string;

    const existing = await prisma.appConfig.findUnique({
      where: { configKey: key },
    });

    if (!existing) {
      res.status(404).json({ code: 404, message: "配置不存在" });
      return;
    }

    await prisma.appConfig.delete({ where: { configKey: key } });

    res.json({ code: 200, message: "配置已删除" });
  } catch (error) {
    console.error("Delete config error:", error);
    res.status(500).json({ code: 500, message: "服务器内部错误" });
  }
});

export default router;
