import { Router, Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import { signMiddleware } from "../middleware/sign";
import { listRegisteredTasks } from "../services/taskRegistry";
import { enqueueTaskByRegisteredName } from "../services/taskEnqueue";

const router = Router();
const prisma = new PrismaClient();

router.use(signMiddleware);

function parseJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function parseObjectInput(value: unknown): { ok: true; data: Record<string, unknown> } | { ok: false; message: string } {
  if (value == null) return { ok: true, data: {} };
  if (typeof value === "object" && !Array.isArray(value)) {
    return { ok: true, data: value as Record<string, unknown> };
  }
  return { ok: false, message: "task_payload must be object" };
}

router.get("/config", async (req: Request, res: Response): Promise<void> => {
  try {
    const key = (req.query.key as string) || "global_json";

    const config = await prisma.appConfig.findUnique({
      where: { configKey: key },
    });

    if (!config) {
      res.status(404).json({ code: 404, message: `配置 '${key}' 不存在` });
      return;
    }

    const data = JSON.parse(config.configValue);

    res.json({ code: 200, message: "success", data });
  } catch (error) {
    console.error("App get config error:", error);
    res.status(500).json({ code: 500, message: "服务器内部错误" });
  }
});

router.get("/task/catalog", async (_req: Request, res: Response): Promise<void> => {
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
    console.error("Task catalog error:", error);
    res.status(500).json({ code: 500, message: "服务器内部错误" });
  }
});

router.post("/task/execute", async (req: Request, res: Response): Promise<void> => {
  try {
    const taskNameRaw = typeof req.body?.task_name === "string" ? req.body.task_name : "";
    const taskName = taskNameRaw.trim();
    const taskPayloadResult = parseObjectInput(req.body?.task_payload ?? req.body?.task_params);
    const executionName =
      typeof req.body?.execution_name === "string" && req.body.execution_name.trim()
        ? req.body.execution_name.trim().slice(0, 120)
        : undefined;

    if (!taskName) {
      res.status(400).json({ code: 400, message: "task_name is required" });
      return;
    }
    if (!taskPayloadResult.ok) {
      res.status(400).json({ code: 400, message: taskPayloadResult.message });
      return;
    }

    const enqueueResult = await enqueueTaskByRegisteredName(prisma, {
      taskName,
      taskPayload: taskPayloadResult.data,
      executionName,
    });
    if (!enqueueResult.ok) {
      res.status(enqueueResult.code).json({ code: enqueueResult.code, message: enqueueResult.message });
      return;
    }

    res.json({
      code: 200,
      message: "任务已受理",
      data: enqueueResult.data,
    });
  } catch (error) {
    console.error("Task execute error:", error);
    res.status(500).json({ code: 500, message: "服务器内部错误" });
  }
});

router.put("/task/status", async (req: Request, res: Response): Promise<void> => {
  try {
    const { task_id, status, status_info } = req.body;

    if (!task_id) {
      res.status(400).json({ code: 400, message: "task_id is required" });
      return;
    }

    const validStatuses = ["queued", "running", "error", "completed"];
    if (!status || !validStatuses.includes(status)) {
      res.status(400).json({
        code: 400,
        message: `status must be one of: ${validStatuses.join(", ")}`,
      });
      return;
    }

    const task = await prisma.task.findUnique({ where: { taskId: task_id } });
    if (!task) {
      res.status(404).json({ code: 404, message: "任务不存在" });
      return;
    }

    await prisma.task.update({
      where: { taskId: task_id },
      data: {
        status,
        statusInfo: JSON.stringify(status_info || {}),
      },
    });

    res.json({ code: 200, message: "状态已更新" });
  } catch (error) {
    console.error("Task status update error:", error);
    res.status(500).json({ code: 500, message: "服务器内部错误" });
  }
});

router.get("/task/status", async (req: Request, res: Response): Promise<void> => {
  try {
    const taskId = req.query.task_id as string;

    if (!taskId) {
      res.status(400).json({ code: 400, message: "task_id is required" });
      return;
    }

    const task = await prisma.task.findUnique({ where: { taskId } });

    if (!task) {
      res.status(404).json({ code: 404, message: "任务不存在" });
      return;
    }

    res.json({
      code: 200,
      message: "success",
      data: {
        task_payload: (() => {
          const parsed = parseJson<Record<string, unknown>>(task.taskParams, {});
          const payload = parsed.task_payload ?? parsed.taskPayload ?? parsed.payload;
          if (!payload || typeof payload !== "object" || Array.isArray(payload)) return {};
          return payload as Record<string, unknown>;
        })(),
        execution_name: (() => {
          const parsed = parseJson<Record<string, unknown>>(task.taskParams, {});
          const executionName = parsed.execution_name ?? parsed.executionName;
          return typeof executionName === "string" ? executionName : null;
        })(),
        task_id: task.taskId,
        task_name: task.taskName,
        task_type: task.taskType,
        task_params: parseJson<Record<string, unknown>>(task.taskParams, {}),
        status: task.status,
        status_info: parseJson<Record<string, unknown>>(task.statusInfo, {}),
        execution_log: task.executionLog,
        result_code: task.resultCode,
        target_client_id: task.targetClientId,
        claimed_by_client_id: task.claimedByClientId,
        claimed_at: task.claimedAt,
        started_at: task.startedAt,
        finished_at: task.finishedAt,
        created_at: task.createdAt,
        updated_at: task.updatedAt,
      },
    });
  } catch (error) {
    console.error("Task status error:", error);
    res.status(500).json({ code: 500, message: "服务器内部错误" });
  }
});

export default router;
