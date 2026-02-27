import { Router, Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import { signMiddleware } from "../middleware/sign";

const router = Router();
const prisma = new PrismaClient();

router.use(signMiddleware);

router.get("/config", async (_req: Request, res: Response): Promise<void> => {
  try {
    const config = await prisma.appConfig.findUnique({
      where: { configKey: "global_json" },
    });

    const data = config ? JSON.parse(config.configValue) : {};

    res.json({
      code: 200,
      message: "success",
      data,
    });
  } catch (error) {
    console.error("App get config error:", error);
    res.status(500).json({ code: 500, message: "服务器内部错误" });
  }
});

router.post("/task/execute", async (req: Request, res: Response): Promise<void> => {
  try {
    const { task_name, task_params } = req.body;

    if (!task_name) {
      res.status(400).json({ code: 400, message: "task_name is required" });
      return;
    }

    const taskId = `T${Date.now()}${Math.floor(Math.random() * 1000)
      .toString()
      .padStart(3, "0")}`;

    await prisma.task.create({
      data: {
        taskId,
        taskName: task_name,
        taskParams: JSON.stringify(task_params || {}),
        status: "pending",
      },
    });

    res.json({
      code: 200,
      message: "任务已受理",
      data: { task_id: taskId },
    });
  } catch (error) {
    console.error("Task execute error:", error);
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

    const task = await prisma.task.findUnique({
      where: { taskId },
    });

    if (!task) {
      res.status(404).json({ code: 404, message: "任务不存在" });
      return;
    }

    res.json({
      code: 200,
      message: "success",
      data: {
        task_id: task.taskId,
        status: task.status,
      },
    });
  } catch (error) {
    console.error("Task status error:", error);
    res.status(500).json({ code: 500, message: "服务器内部错误" });
  }
});

export default router;
