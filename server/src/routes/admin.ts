import { Router, Response } from "express";
import { PrismaClient } from "@prisma/client";
import { authMiddleware, AuthRequest } from "../middleware/auth";

const router = Router();
const prisma = new PrismaClient();
const validTaskStatuses = ["queued", "running", "error", "completed"] as const;

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

router.use(authMiddleware);

// ── Tasks ───────────────────────────────────────────────

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
    const { taskName, taskParams } = req.body as { taskName?: unknown; taskParams?: unknown };

    if (typeof taskName !== "string" || !taskName.trim()) {
      res.status(400).json({ code: 400, message: "taskName 不能为空" });
      return;
    }

    const parsedParams = parseObjectField(taskParams, "taskParams");
    if (!parsedParams.ok) {
      res.status(400).json({ code: 400, message: parsedParams.message });
      return;
    }

    const queueCount = await prisma.task.count({
      where: { status: "queued" },
    });

    const created = await prisma.task.create({
      data: {
        taskId: generateTaskId(),
        taskName: taskName.trim(),
        taskParams: JSON.stringify(parsedParams.data),
        status: "queued",
        statusInfo: JSON.stringify({ queue_position: queueCount + 1 }),
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
        status,
        statusInfo: JSON.stringify(parsedStatusInfo.data),
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
