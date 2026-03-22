import { Router, Response } from "express";
import { PrismaClient } from "@prisma/client";
import { authMiddleware, AuthRequest } from "../middleware/auth";
import { beautifyToHtml } from "../services/ai";
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

// ── DeepRead Admin ──────────────────────────────────────

function generateDrId(prefix: string): string {
  return `${prefix}${Date.now()}${Math.floor(Math.random() * 1000).toString().padStart(3, "0")}`;
}

function generateInviteCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

// ── Spaces ──

router.get("/dr/spaces", async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const spaces = await prisma.drSpace.findMany({ orderBy: { createdAt: "desc" } });

    const spaceIds = spaces.map((s) => s.spaceId);
    const [memberCounts, channelCounts, articleCounts] = await Promise.all([
      prisma.drSpaceMember.groupBy({ by: ["spaceId"], where: { spaceId: { in: spaceIds } }, _count: { userId: true } }),
      prisma.drChannel.groupBy({ by: ["spaceId"], where: { spaceId: { in: spaceIds } }, _count: { id: true } }),
      prisma.drArticle.groupBy({ by: ["spaceId"], where: { spaceId: { in: spaceIds } }, _count: { id: true } }),
    ]);

    const memberMap = new Map(memberCounts.map((m) => [m.spaceId, m._count.userId]));
    const channelMap = new Map(channelCounts.map((c) => [c.spaceId, c._count.id]));
    const articleMap = new Map(articleCounts.map((a) => [a.spaceId, a._count.id]));

    res.json({
      code: 200,
      message: "success",
      data: spaces.map((s) => ({
        ...s,
        memberCount: memberMap.get(s.spaceId) ?? 0,
        channelCount: channelMap.get(s.spaceId) ?? 0,
        articleCount: articleMap.get(s.spaceId) ?? 0,
      })),
    });
  } catch (error) {
    console.error("Admin list spaces error:", error);
    res.status(500).json({ code: 500, message: "服务器内部错误" });
  }
});

router.post("/dr/spaces", async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { name, description } = req.body as { name?: string; description?: string };
    if (!name || !name.trim()) {
      res.status(400).json({ code: 400, message: "空间名称不能为空" });
      return;
    }

    const space = await prisma.drSpace.create({
      data: {
        spaceId: generateDrId("S"),
        name: name.trim(),
        description: description?.trim() || "",
        inviteCode: generateInviteCode(),
      },
    });

    res.json({ code: 200, message: "空间已创建", data: space });
  } catch (error) {
    console.error("Admin create space error:", error);
    res.status(500).json({ code: 500, message: "服务器内部错误" });
  }
});

router.put("/dr/spaces/:spaceId", async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const spaceId = req.params.spaceId as string;
    const { name, description } = req.body as { name?: string; description?: string };

    const existing = await prisma.drSpace.findUnique({ where: { spaceId } });
    if (!existing) {
      res.status(404).json({ code: 404, message: "空间不存在" });
      return;
    }

    const updateData: Record<string, unknown> = {};
    if (name !== undefined) updateData.name = name.trim();
    if (description !== undefined) updateData.description = description.trim();

    const updated = await prisma.drSpace.update({ where: { spaceId }, data: updateData });
    res.json({ code: 200, message: "空间已更新", data: updated });
  } catch (error) {
    console.error("Admin update space error:", error);
    res.status(500).json({ code: 500, message: "服务器内部错误" });
  }
});

router.delete("/dr/spaces/:spaceId", async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const spaceId = req.params.spaceId as string;
    const existing = await prisma.drSpace.findUnique({ where: { spaceId } });
    if (!existing) {
      res.status(404).json({ code: 404, message: "空间不存在" });
      return;
    }

    // Cascade delete members, channels, articles
    await prisma.drSpaceMember.deleteMany({ where: { spaceId } });
    await prisma.drArticle.deleteMany({ where: { spaceId } });
    await prisma.drChannel.deleteMany({ where: { spaceId } });
    await prisma.drSpace.delete({ where: { spaceId } });

    res.json({ code: 200, message: "空间已删除" });
  } catch (error) {
    console.error("Admin delete space error:", error);
    res.status(500).json({ code: 500, message: "服务器内部错误" });
  }
});

router.get("/dr/spaces/:spaceId/members", async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const spaceId = req.params.spaceId as string;
    const members = await prisma.drSpaceMember.findMany({
      where: { spaceId },
      orderBy: { joinedAt: "desc" },
    });

    const userIds = members.map((m) => m.userId);
    const users = await prisma.drUser.findMany({ where: { id: { in: userIds } } });
    const userMap = new Map(users.map((u) => [u.id, u]));

    res.json({
      code: 200,
      message: "success",
      data: members.map((m) => ({
        userId: m.userId,
        role: m.role,
        joinedAt: m.joinedAt,
        phone: userMap.get(m.userId)?.phone ?? "",
        nickname: userMap.get(m.userId)?.nickname ?? "",
      })),
    });
  } catch (error) {
    console.error("Admin list space members error:", error);
    res.status(500).json({ code: 500, message: "服务器内部错误" });
  }
});

// ── Invite Codes ──

router.get("/dr/spaces/:spaceId/invite-codes", async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const spaceId = req.params.spaceId as string;
    const codes = await prisma.drInviteCode.findMany({
      where: { spaceId },
      orderBy: { createdAt: "desc" },
    });

    // For each code, fetch members who used it
    const codeIds = codes.map((c) => c.codeId);
    const members = await prisma.drSpaceMember.findMany({
      where: { spaceId, inviteCodeId: { in: codeIds } },
      orderBy: { joinedAt: "desc" },
    });
    const userIds = [...new Set(members.map((m) => m.userId))];
    const users = await prisma.drUser.findMany({ where: { id: { in: userIds } } });
    const userMap = new Map(users.map((u) => [u.id, u]));

    const membersByCode = new Map<string, { userId: number; phone: string; nickname: string; joinedAt: Date }[]>();
    for (const m of members) {
      if (!m.inviteCodeId) continue;
      if (!membersByCode.has(m.inviteCodeId)) membersByCode.set(m.inviteCodeId, []);
      membersByCode.get(m.inviteCodeId)!.push({
        userId: m.userId,
        phone: userMap.get(m.userId)?.phone ?? "",
        nickname: userMap.get(m.userId)?.nickname ?? "",
        joinedAt: m.joinedAt,
      });
    }

    res.json({
      code: 200,
      message: "success",
      data: codes.map((c) => ({
        ...c,
        users: membersByCode.get(c.codeId) ?? [],
      })),
    });
  } catch (error) {
    console.error("Admin list invite codes error:", error);
    res.status(500).json({ code: 500, message: "服务器内部错误" });
  }
});

router.post("/dr/spaces/:spaceId/invite-codes", async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const spaceId = req.params.spaceId as string;
    const { label, maxUses, expiresAt } = req.body as {
      label?: string;
      maxUses?: number | null;
      expiresAt?: string | null;
    };

    const space = await prisma.drSpace.findUnique({ where: { spaceId } });
    if (!space) {
      res.status(404).json({ code: 404, message: "空间不存在" });
      return;
    }

    // Generate unique code
    let code = generateInviteCode();
    let attempts = 0;
    while (attempts < 10) {
      const existing = await prisma.drInviteCode.findUnique({ where: { code } });
      if (!existing) break;
      code = generateInviteCode();
      attempts++;
    }

    const inviteCode = await prisma.drInviteCode.create({
      data: {
        codeId: generateDrId("IC"),
        spaceId,
        code,
        label: label?.trim() ?? "",
        maxUses: maxUses ?? null,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
      },
    });

    res.json({ code: 200, message: "邀请码已创建", data: inviteCode });
  } catch (error) {
    console.error("Admin create invite code error:", error);
    res.status(500).json({ code: 500, message: "服务器内部错误" });
  }
});

router.delete("/dr/invite-codes/:codeId", async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const codeId = req.params.codeId as string;
    const existing = await prisma.drInviteCode.findUnique({ where: { codeId } });
    if (!existing) {
      res.status(404).json({ code: 404, message: "邀请码不存在" });
      return;
    }
    await prisma.drInviteCode.delete({ where: { codeId } });
    res.json({ code: 200, message: "邀请码已删除" });
  } catch (error) {
    console.error("Admin delete invite code error:", error);
    res.status(500).json({ code: 500, message: "服务器内部错误" });
  }
});

// ── Channels ──

router.get("/dr/channels", async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const spaceId = req.query.space_id as string | undefined;
    const where: Record<string, unknown> = {};
    if (spaceId) where.spaceId = spaceId;

    const channels = await prisma.drChannel.findMany({
      where,
      orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
    });

    const channelIds = channels.map((c) => c.channelId);
    const articleCounts = await prisma.drArticle.groupBy({
      by: ["channelId"],
      where: { channelId: { in: channelIds } },
      _count: { id: true },
    });
    const countMap = new Map(articleCounts.map((a) => [a.channelId, a._count.id]));

    res.json({
      code: 200,
      message: "success",
      data: channels.map((c) => ({
        ...c,
        articleCount: countMap.get(c.channelId) ?? 0,
      })),
    });
  } catch (error) {
    console.error("Admin list channels error:", error);
    res.status(500).json({ code: 500, message: "服务器内部错误" });
  }
});

router.post("/dr/channels", async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { name, spaceId, sortOrder } = req.body as { name?: string; spaceId?: string; sortOrder?: number };

    if (!name?.trim() || !spaceId) {
      res.status(400).json({ code: 400, message: "频道名称和所属空间不能为空" });
      return;
    }

    const space = await prisma.drSpace.findUnique({ where: { spaceId } });
    if (!space) {
      res.status(404).json({ code: 404, message: "空间不存在" });
      return;
    }

    const channel = await prisma.drChannel.create({
      data: {
        channelId: generateDrId("CH"),
        spaceId,
        name: name.trim(),
        sortOrder: sortOrder ?? 0,
      },
    });

    res.json({ code: 200, message: "频道已创建", data: channel });
  } catch (error) {
    console.error("Admin create channel error:", error);
    res.status(500).json({ code: 500, message: "服务器内部错误" });
  }
});

router.put("/dr/channels/:channelId", async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const channelId = req.params.channelId as string;
    const { name, sortOrder } = req.body as { name?: string; sortOrder?: number };

    const existing = await prisma.drChannel.findUnique({ where: { channelId } });
    if (!existing) {
      res.status(404).json({ code: 404, message: "频道不存在" });
      return;
    }

    const updateData: Record<string, unknown> = {};
    if (name !== undefined) updateData.name = name.trim();
    if (sortOrder !== undefined) updateData.sortOrder = sortOrder;

    const updated = await prisma.drChannel.update({ where: { channelId }, data: updateData });
    res.json({ code: 200, message: "频道已更新", data: updated });
  } catch (error) {
    console.error("Admin update channel error:", error);
    res.status(500).json({ code: 500, message: "服务器内部错误" });
  }
});

router.delete("/dr/channels/:channelId", async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const channelId = req.params.channelId as string;
    const existing = await prisma.drChannel.findUnique({ where: { channelId } });
    if (!existing) {
      res.status(404).json({ code: 404, message: "频道不存在" });
      return;
    }

    await prisma.drChannel.delete({ where: { channelId } });
    res.json({ code: 200, message: "频道已删除" });
  } catch (error) {
    console.error("Admin delete channel error:", error);
    res.status(500).json({ code: 500, message: "服务器内部错误" });
  }
});

// ── Articles ──

router.get("/dr/articles", async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const spaceId = req.query.space_id as string | undefined;
    const channelId = req.query.channel_id as string | undefined;
    const page = parseInt(req.query.page as string) || 1;
    const pageSize = parseInt(req.query.page_size as string) || 20;

    const where: Record<string, unknown> = {};
    if (spaceId) where.spaceId = spaceId;
    if (channelId) where.channelId = channelId;

    const [articles, total] = await Promise.all([
      prisma.drArticle.findMany({
        where,
        select: {
          id: true,
          articleId: true,
          spaceId: true,
          channelId: true,
          title: true,
          summary: true,
          coverUrl: true,
          layoutType: true,
          author: true,
          readCount: true,
          publishedAt: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: { publishedAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.drArticle.count({ where }),
    ]);

    // Get bookmark counts
    const articleIds = articles.map((a) => a.articleId);
    const bookmarkCounts = await prisma.drBookmark.groupBy({
      by: ["articleId"],
      where: { articleId: { in: articleIds } },
      _count: { userId: true },
    });
    const bmMap = new Map(bookmarkCounts.map((b) => [b.articleId, b._count.userId]));

    res.json({
      code: 200,
      message: "success",
      data: {
        list: articles.map((a) => ({
          ...a,
          bookmarkCount: bmMap.get(a.articleId) ?? 0,
        })),
        total,
        page,
        pageSize,
      },
    });
  } catch (error) {
    console.error("Admin list articles error:", error);
    res.status(500).json({ code: 500, message: "服务器内部错误" });
  }
});

router.get("/dr/articles/:articleId", async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const articleId = req.params.articleId as string;
    const article = await prisma.drArticle.findUnique({ where: { articleId } });
    if (!article) {
      res.status(404).json({ code: 404, message: "文章不存在" });
      return;
    }
    res.json({ code: 200, message: "success", data: article });
  } catch (error) {
    console.error("Admin get article detail error:", error);
    res.status(500).json({ code: 500, message: "服务器内部错误" });
  }
});

router.post("/dr/articles", async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { title, summary, coverUrl, content, contentType, spaceId, channelId, author, layoutType } =
      req.body as {
        title?: string;
        summary?: string;
        coverUrl?: string;
        content?: string;
        contentType?: string;
        spaceId?: string;
        channelId?: string;
        author?: string;
        layoutType?: string;
      };

    if (!title?.trim() || !spaceId || !channelId) {
      res.status(400).json({ code: 400, message: "标题、空间和频道不能为空" });
      return;
    }

    const article = await prisma.drArticle.create({
      data: {
        articleId: generateDrId("A"),
        spaceId,
        channelId,
        title: title.trim(),
        summary: summary?.trim() || "",
        coverUrl: coverUrl?.trim() || "",
        layoutType: layoutType || "default",
        content: content || "",
        contentType: contentType || "html",
        author: author?.trim() || "",
      },
    });

    res.json({ code: 200, message: "文章已创建", data: article });
  } catch (error) {
    console.error("Admin create article error:", error);
    res.status(500).json({ code: 500, message: "服务器内部错误" });
  }
});

router.put("/dr/articles/:articleId", async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const articleId = req.params.articleId as string;
    const { title, summary, coverUrl, content, contentType, channelId, author, layoutType } =
      req.body as Record<string, string | undefined>;

    const existing = await prisma.drArticle.findUnique({ where: { articleId } });
    if (!existing) {
      res.status(404).json({ code: 404, message: "文章不存在" });
      return;
    }

    const updateData: Record<string, unknown> = {};
    if (title !== undefined) updateData.title = title.trim();
    if (summary !== undefined) updateData.summary = summary.trim();
    if (coverUrl !== undefined) updateData.coverUrl = coverUrl.trim();
    if (content !== undefined) updateData.content = content;
    if (contentType !== undefined) updateData.contentType = contentType;
    if (channelId !== undefined) updateData.channelId = channelId;
    if (author !== undefined) updateData.author = author.trim();
    if (layoutType !== undefined) updateData.layoutType = layoutType;

    const updated = await prisma.drArticle.update({ where: { articleId }, data: updateData });
    res.json({ code: 200, message: "文章已更新", data: updated });
  } catch (error) {
    console.error("Admin update article error:", error);
    res.status(500).json({ code: 500, message: "服务器内部错误" });
  }
});

router.delete("/dr/articles/:articleId", async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const articleId = req.params.articleId as string;
    const existing = await prisma.drArticle.findUnique({ where: { articleId } });
    if (!existing) {
      res.status(404).json({ code: 404, message: "文章不存在" });
      return;
    }

    // Cascade delete bookmarks, read status, highlights
    await prisma.drBookmark.deleteMany({ where: { articleId } });
    await prisma.drReadStatus.deleteMany({ where: { articleId } });
    await prisma.drHighlight.deleteMany({ where: { articleId } });
    await prisma.drCollectionArticle.deleteMany({ where: { articleId } });
    await prisma.drArticle.delete({ where: { articleId } });

    res.json({ code: 200, message: "文章已删除" });
  } catch (error) {
    console.error("Admin delete article error:", error);
    res.status(500).json({ code: 500, message: "服务器内部错误" });
  }
});

// ── Users ──

router.get("/dr/users", async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const pageSize = parseInt(req.query.page_size as string) || 20;

    const [users, total] = await Promise.all([
      prisma.drUser.findMany({
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.drUser.count(),
    ]);

    const userIds = users.map((u) => u.id);
    const [spaceCounts, highlightCounts] = await Promise.all([
      prisma.drSpaceMember.groupBy({ by: ["userId"], where: { userId: { in: userIds } }, _count: { spaceId: true } }),
      prisma.drHighlight.groupBy({ by: ["userId"], where: { userId: { in: userIds } }, _count: { id: true } }),
    ]);

    const spaceMap = new Map(spaceCounts.map((s) => [s.userId, s._count.spaceId]));
    const hlMap = new Map(highlightCounts.map((h) => [h.userId, h._count.id]));

    res.json({
      code: 200,
      message: "success",
      data: {
        list: users.map((u) => ({
          ...u,
          spaceCount: spaceMap.get(u.id) ?? 0,
          highlightCount: hlMap.get(u.id) ?? 0,
        })),
        total,
        page,
        pageSize,
      },
    });
  } catch (error) {
    console.error("Admin list users error:", error);
    res.status(500).json({ code: 500, message: "服务器内部错误" });
  }
});

router.get("/dr/users/:userId", async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = parseInt(req.params.userId as string);
    if (isNaN(userId)) {
      res.status(400).json({ code: 400, message: "无效的用户ID" });
      return;
    }

    const user = await prisma.drUser.findUnique({ where: { id: userId } });
    if (!user) {
      res.status(404).json({ code: 404, message: "用户不存在" });
      return;
    }

    const memberships = await prisma.drSpaceMember.findMany({ where: { userId } });
    const spaceIds = memberships.map((m) => m.spaceId);
    const spaces = await prisma.drSpace.findMany({ where: { spaceId: { in: spaceIds } } });
    const spaceMap = new Map(spaces.map((s) => [s.spaceId, s]));

    res.json({
      code: 200,
      message: "success",
      data: {
        ...user,
        spaces: memberships.map((m) => ({
          spaceId: m.spaceId,
          spaceName: spaceMap.get(m.spaceId)?.name ?? "",
          role: m.role,
          joinedAt: m.joinedAt,
        })),
      },
    });
  } catch (error) {
    console.error("Admin get user error:", error);
    res.status(500).json({ code: 500, message: "服务器内部错误" });
  }
});

// ── Space Homepage Modules ──────────────────────────────────

const VALID_LAYOUT_TYPES = ["large_card", "horizontal_card", "vertical_card", "waterfall"] as const;
type LayoutType = (typeof VALID_LAYOUT_TYPES)[number];

router.get("/dr/spaces/:spaceId/homepage-modules", async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const spaceId = req.params.spaceId as string;
    const space = await prisma.drSpace.findUnique({ where: { spaceId } });
    if (!space) {
      res.status(404).json({ code: 404, message: "空间不存在" });
      return;
    }

    const modules = await prisma.drSpaceHomepageModule.findMany({
      where: { spaceId },
      orderBy: { sortOrder: "asc" },
    });

    const moduleIds = modules.map((m) => m.moduleId);
    const resources = await prisma.drSpaceHomepageModuleResource.findMany({
      where: { moduleId: { in: moduleIds } },
      orderBy: { sortOrder: "asc" },
    });

    // Fetch resource details
    const channelIds = resources.filter((r) => r.resourceType === "channel").map((r) => r.resourceId);
    const articleIds = resources.filter((r) => r.resourceType === "article").map((r) => r.resourceId);

    const [channels, articles] = await Promise.all([
      channelIds.length > 0 ? prisma.drChannel.findMany({ where: { channelId: { in: channelIds } } }) : [],
      articleIds.length > 0 ? prisma.drArticle.findMany({ where: { articleId: { in: articleIds } } }) : [],
    ]);

    const channelMap = new Map(channels.map((c) => [c.channelId, c]));
    const articleMap = new Map(articles.map((a) => [a.articleId, a]));

    const resourcesByModule = new Map<string, unknown[]>();
    for (const r of resources) {
      if (!resourcesByModule.has(r.moduleId)) resourcesByModule.set(r.moduleId, []);
      let detail: unknown = null;
      if (r.resourceType === "channel") detail = channelMap.get(r.resourceId) ?? null;
      else if (r.resourceType === "article") detail = articleMap.get(r.resourceId) ?? null;
      resourcesByModule.get(r.moduleId)!.push({ ...r, detail });
    }

    res.json({
      code: 200,
      message: "success",
      data: modules.map((m) => ({ ...m, resources: resourcesByModule.get(m.moduleId) ?? [] })),
    });
  } catch (error) {
    console.error("Admin list homepage modules error:", error);
    res.status(500).json({ code: 500, message: "服务器内部错误" });
  }
});

router.post("/dr/spaces/:spaceId/homepage-modules", async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const spaceId = req.params.spaceId as string;
    const { title, subtitle, layoutType } = req.body as {
      title?: string;
      subtitle?: string;
      layoutType?: string;
    };

    if (!title || !title.trim()) {
      res.status(400).json({ code: 400, message: "模块标题不能为空" });
      return;
    }

    if (layoutType && !VALID_LAYOUT_TYPES.includes(layoutType as LayoutType)) {
      res.status(400).json({ code: 400, message: "无效的布局类型" });
      return;
    }

    const space = await prisma.drSpace.findUnique({ where: { spaceId } });
    if (!space) {
      res.status(404).json({ code: 404, message: "空间不存在" });
      return;
    }

    const maxOrder = await prisma.drSpaceHomepageModule.findFirst({
      where: { spaceId },
      orderBy: { sortOrder: "desc" },
      select: { sortOrder: true },
    });

    const module = await prisma.drSpaceHomepageModule.create({
      data: {
        moduleId: generateDrId("HM"),
        spaceId,
        title: title.trim(),
        subtitle: subtitle?.trim() || "",
        layoutType: (layoutType as LayoutType) || "large_card",
        sortOrder: (maxOrder?.sortOrder ?? -1) + 1,
      },
    });

    res.json({ code: 200, message: "模块已创建", data: module });
  } catch (error) {
    console.error("Admin create homepage module error:", error);
    res.status(500).json({ code: 500, message: "服务器内部错误" });
  }
});

router.put("/dr/homepage-modules/:moduleId", async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const moduleId = req.params.moduleId as string;
    const { title, subtitle, layoutType } = req.body as {
      title?: string;
      subtitle?: string;
      layoutType?: string;
    };

    const existing = await prisma.drSpaceHomepageModule.findUnique({ where: { moduleId } });
    if (!existing) {
      res.status(404).json({ code: 404, message: "模块不存在" });
      return;
    }

    if (layoutType && !VALID_LAYOUT_TYPES.includes(layoutType as LayoutType)) {
      res.status(400).json({ code: 400, message: "无效的布局类型" });
      return;
    }

    const updateData: Record<string, unknown> = {};
    if (title !== undefined) updateData.title = title.trim();
    if (subtitle !== undefined) updateData.subtitle = subtitle.trim();
    if (layoutType !== undefined) updateData.layoutType = layoutType;

    const updated = await prisma.drSpaceHomepageModule.update({ where: { moduleId }, data: updateData });
    res.json({ code: 200, message: "模块已更新", data: updated });
  } catch (error) {
    console.error("Admin update homepage module error:", error);
    res.status(500).json({ code: 500, message: "服务器内部错误" });
  }
});

router.delete("/dr/homepage-modules/:moduleId", async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const moduleId = req.params.moduleId as string;
    const existing = await prisma.drSpaceHomepageModule.findUnique({ where: { moduleId } });
    if (!existing) {
      res.status(404).json({ code: 404, message: "模块不存在" });
      return;
    }

    await prisma.drSpaceHomepageModuleResource.deleteMany({ where: { moduleId } });
    await prisma.drSpaceHomepageModule.delete({ where: { moduleId } });
    res.json({ code: 200, message: "模块已删除" });
  } catch (error) {
    console.error("Admin delete homepage module error:", error);
    res.status(500).json({ code: 500, message: "服务器内部错误" });
  }
});

router.put("/dr/spaces/:spaceId/homepage-modules/reorder", async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const spaceId = req.params.spaceId as string;
    const { moduleIds } = req.body as { moduleIds?: string[] };

    if (!Array.isArray(moduleIds)) {
      res.status(400).json({ code: 400, message: "moduleIds 必须是数组" });
      return;
    }

    await Promise.all(
      moduleIds.map((moduleId, index) =>
        prisma.drSpaceHomepageModule.updateMany({
          where: { moduleId, spaceId },
          data: { sortOrder: index },
        })
      )
    );

    res.json({ code: 200, message: "排序已更新" });
  } catch (error) {
    console.error("Admin reorder homepage modules error:", error);
    res.status(500).json({ code: 500, message: "服务器内部错误" });
  }
});

router.post("/dr/homepage-modules/:moduleId/resources", async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const moduleId = req.params.moduleId as string;
    const { resourceType, resourceId } = req.body as { resourceType?: string; resourceId?: string };

    if (!resourceType || !["channel", "article"].includes(resourceType)) {
      res.status(400).json({ code: 400, message: "resourceType 必须是 channel 或 article" });
      return;
    }
    if (!resourceId || !resourceId.trim()) {
      res.status(400).json({ code: 400, message: "resourceId 不能为空" });
      return;
    }

    const module = await prisma.drSpaceHomepageModule.findUnique({ where: { moduleId } });
    if (!module) {
      res.status(404).json({ code: 404, message: "模块不存在" });
      return;
    }

    // Validate resource exists
    if (resourceType === "channel") {
      const ch = await prisma.drChannel.findUnique({ where: { channelId: resourceId } });
      if (!ch) {
        res.status(404).json({ code: 404, message: "频道不存在" });
        return;
      }
    } else {
      const art = await prisma.drArticle.findUnique({ where: { articleId: resourceId } });
      if (!art) {
        res.status(404).json({ code: 404, message: "文章不存在" });
        return;
      }
    }

    const maxOrder = await prisma.drSpaceHomepageModuleResource.findFirst({
      where: { moduleId },
      orderBy: { sortOrder: "desc" },
      select: { sortOrder: true },
    });

    const resource = await prisma.drSpaceHomepageModuleResource.upsert({
      where: { moduleId_resourceId: { moduleId, resourceId } },
      create: {
        moduleId,
        resourceType,
        resourceId,
        sortOrder: (maxOrder?.sortOrder ?? -1) + 1,
      },
      update: { resourceType },
    });

    res.json({ code: 200, message: "资源已添加", data: resource });
  } catch (error) {
    console.error("Admin add module resource error:", error);
    res.status(500).json({ code: 500, message: "服务器内部错误" });
  }
});

router.delete("/dr/homepage-modules/:moduleId/resources/:resourceId", async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { moduleId, resourceId } = req.params as { moduleId: string; resourceId: string };

    const existing = await prisma.drSpaceHomepageModuleResource.findUnique({
      where: { moduleId_resourceId: { moduleId, resourceId } },
    });
    if (!existing) {
      res.status(404).json({ code: 404, message: "资源不存在" });
      return;
    }

    await prisma.drSpaceHomepageModuleResource.delete({
      where: { moduleId_resourceId: { moduleId, resourceId } },
    });
    res.json({ code: 200, message: "资源已移除" });
  } catch (error) {
    console.error("Admin remove module resource error:", error);
    res.status(500).json({ code: 500, message: "服务器内部错误" });
  }
});

// ── AI 工具 ──────────────────────────────────────────────────

// AI 格式美化：将原始文本内容格式化为适合手机阅读的 HTML
router.post("/ai/beautify", authMiddleware, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { content } = req.body as { content?: string };

    if (!content || !content.trim()) {
      res.status(400).json({ code: 400, message: "内容不能为空" });
      return;
    }

    if (content.length > 20000) {
      res.status(400).json({ code: 400, message: "内容过长，请控制在 20000 字以内" });
      return;
    }

    const html = await beautifyToHtml(content.trim());

    res.json({
      code: 200,
      message: "success",
      data: { html },
    });
  } catch (error) {
    console.error("AI beautify error:", error);
    res.status(500).json({ code: 500, message: "AI 服务暂不可用，请稍后重试" });
  }
});

export default router;
