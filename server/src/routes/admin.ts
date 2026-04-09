import { Router, Response } from "express";
import { PrismaClient } from "@prisma/client";
import { authMiddleware, AuthRequest } from "../middleware/auth";
import multer from "multer";
import path from "path";
import fs from "fs";
import crypto from "crypto";

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

    await prisma.drSpaceHomepageModuleResource.deleteMany({ where: { resourceId: channelId, resourceType: "channel" } });
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
    await prisma.drSpaceHomepageModuleResource.deleteMany({ where: { resourceId: articleId, resourceType: "article" } });
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

const VALID_LAYOUT_TYPES = ["large_horizontal", "small_horizontal", "large_vertical", "small_vertical", "plain_text"] as const;
type LayoutType = (typeof VALID_LAYOUT_TYPES)[number];
const VALID_MODULE_TYPES = ["standard", "title_desc", "load_list"] as const;
type ModuleType = (typeof VALID_MODULE_TYPES)[number];
const VALID_SOURCE_TYPES = ["channel", "collection"] as const;

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
    const collectionIds = resources.filter((r) => r.resourceType === "collection").map((r) => r.resourceId);

    const [channels, articles, collections] = await Promise.all([
      channelIds.length > 0 ? prisma.drChannel.findMany({ where: { channelId: { in: channelIds } } }) : [],
      articleIds.length > 0 ? prisma.drArticle.findMany({ where: { articleId: { in: articleIds } } }) : [],
      collectionIds.length > 0 ? prisma.drSpaceCollection.findMany({ where: { collectionId: { in: collectionIds } } }) : [],
    ]);

    const channelMap = new Map(channels.map((c) => [c.channelId, c]));
    const articleMap = new Map(articles.map((a) => [a.articleId, a]));
    const collectionMap = new Map(collections.map((c) => [c.collectionId, c]));

    const resourcesByModule = new Map<string, unknown[]>();
    for (const r of resources) {
      if (!resourcesByModule.has(r.moduleId)) resourcesByModule.set(r.moduleId, []);
      let detail: unknown = null;
      if (r.resourceType === "channel") detail = channelMap.get(r.resourceId) ?? null;
      else if (r.resourceType === "article") detail = articleMap.get(r.resourceId) ?? null;
      else if (r.resourceType === "collection") detail = collectionMap.get(r.resourceId) ?? null;
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
    const { title, subtitle, layoutType, moduleType, description, sourceType, sourceId } = req.body as {
      title?: string;
      subtitle?: string;
      layoutType?: string;
      moduleType?: string;
      description?: string;
      sourceType?: string;
      sourceId?: string;
    };

    if (!title || !title.trim()) {
      res.status(400).json({ code: 400, message: "模块标题不能为空" });
      return;
    }

    const resolvedModuleType = (moduleType || "standard") as ModuleType;
    if (!VALID_MODULE_TYPES.includes(resolvedModuleType)) {
      res.status(400).json({ code: 400, message: "无效的模块类型" });
      return;
    }

    if (resolvedModuleType === "load_list") {
      if (!sourceType || !VALID_SOURCE_TYPES.includes(sourceType as typeof VALID_SOURCE_TYPES[number])) {
        res.status(400).json({ code: 400, message: "load_list 模块需要指定有效的 sourceType（channel 或 collection）" });
        return;
      }
      if (!sourceId) {
        res.status(400).json({ code: 400, message: "load_list 模块需要指定 sourceId" });
        return;
      }
    }

    if (resolvedModuleType !== "title_desc" && layoutType && !VALID_LAYOUT_TYPES.includes(layoutType as LayoutType)) {
      res.status(400).json({ code: 400, message: "无效的布局类型" });
      return;
    }

    const space = await prisma.drSpace.findUnique({ where: { spaceId } });
    if (!space) {
      res.status(404).json({ code: 404, message: "空间不存在" });
      return;
    }

    let newSortOrder: number;
    if (resolvedModuleType === "load_list") {
      const maxOrder = await prisma.drSpaceHomepageModule.findFirst({
        where: { spaceId },
        orderBy: { sortOrder: "desc" },
        select: { sortOrder: true },
      });
      newSortOrder = (maxOrder?.sortOrder ?? -1) + 1;
    } else {
      const maxNonLoadList = await prisma.drSpaceHomepageModule.findFirst({
        where: { spaceId, moduleType: { not: "load_list" } },
        orderBy: { sortOrder: "desc" },
        select: { sortOrder: true },
      });
      newSortOrder = (maxNonLoadList?.sortOrder ?? -1) + 1;
      await prisma.drSpaceHomepageModule.updateMany({
        where: { spaceId, moduleType: "load_list" },
        data: { sortOrder: { increment: 1 } },
      });
    }

    const module = await prisma.drSpaceHomepageModule.create({
      data: {
        moduleId: generateDrId("HM"),
        spaceId,
        moduleType: resolvedModuleType,
        title: title.trim(),
        subtitle: subtitle?.trim() || "",
        description: description?.trim() || "",
        layoutType: resolvedModuleType !== "title_desc" ? ((layoutType as LayoutType) || "large_horizontal") : "",
        sourceType: resolvedModuleType === "load_list" ? (sourceType || "") : "",
        sourceId: resolvedModuleType === "load_list" ? (sourceId || "") : "",
        sortOrder: newSortOrder,
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
    const { title, subtitle, layoutType, description, sourceType, sourceId } = req.body as {
      title?: string;
      subtitle?: string;
      layoutType?: string;
      description?: string;
      sourceType?: string;
      sourceId?: string;
    };

    const existing = await prisma.drSpaceHomepageModule.findUnique({ where: { moduleId } });
    if (!existing) {
      res.status(404).json({ code: 404, message: "模块不存在" });
      return;
    }

    if (existing.moduleType === "load_list" && sourceType && !VALID_SOURCE_TYPES.includes(sourceType as typeof VALID_SOURCE_TYPES[number])) {
      res.status(400).json({ code: 400, message: "无效的 sourceType" });
      return;
    }

    if (existing.moduleType !== "title_desc" && layoutType && !VALID_LAYOUT_TYPES.includes(layoutType as LayoutType)) {
      res.status(400).json({ code: 400, message: "无效的布局类型" });
      return;
    }

    const updateData: Record<string, unknown> = {};
    if (title !== undefined) updateData.title = title.trim();
    if (subtitle !== undefined) updateData.subtitle = subtitle.trim();
    if (description !== undefined) updateData.description = description.trim();
    if (layoutType !== undefined) updateData.layoutType = layoutType;
    if (sourceType !== undefined) updateData.sourceType = sourceType;
    if (sourceId !== undefined) updateData.sourceId = sourceId;

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

    const existingModules = await prisma.drSpaceHomepageModule.findMany({
      where: { spaceId, moduleId: { in: moduleIds } },
      select: { moduleId: true, moduleType: true },
    });
    const typeMap = Object.fromEntries(existingModules.map((m) => [m.moduleId, m.moduleType]));
    let seenLoadList = false;
    for (const moduleId of moduleIds) {
      const type = typeMap[moduleId];
      if (type === "load_list") {
        seenLoadList = true;
      } else if (seenLoadList) {
        res.status(400).json({ code: 400, message: "加载列表模块必须排在所有其他模块之后" });
        return;
      }
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

    if (!resourceType || !["channel", "article", "collection"].includes(resourceType)) {
      res.status(400).json({ code: 400, message: "resourceType 必须是 channel、article 或 collection" });
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
    } else if (resourceType === "article") {
      const art = await prisma.drArticle.findUnique({ where: { articleId: resourceId } });
      if (!art) {
        res.status(404).json({ code: 404, message: "文章不存在" });
        return;
      }
    } else {
      const col = await prisma.drSpaceCollection.findUnique({ where: { collectionId: resourceId } });
      if (!col) {
        res.status(404).json({ code: 404, message: "集合不存在" });
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

// ── Space Collections ──────────────────────────────────────────

router.get("/dr/spaces/:spaceId/collections", async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const spaceId = req.params.spaceId as string;
    const space = await prisma.drSpace.findUnique({ where: { spaceId } });
    if (!space) {
      res.status(404).json({ code: 404, message: "空间不存在" });
      return;
    }

    const collections = await prisma.drSpaceCollection.findMany({
      where: { spaceId },
      orderBy: { sortOrder: "asc" },
    });

    const collectionIds = collections.map((c) => c.collectionId);
    const counts = await prisma.drSpaceCollectionArticle.groupBy({
      by: ["collectionId"],
      where: { collectionId: { in: collectionIds } },
      _count: { articleId: true },
    });
    const countMap = new Map(counts.map((c) => [c.collectionId, c._count.articleId]));

    res.json({
      code: 200,
      message: "success",
      data: collections.map((c) => ({ ...c, articleCount: countMap.get(c.collectionId) ?? 0 })),
    });
  } catch (error) {
    console.error("Admin list space collections error:", error);
    res.status(500).json({ code: 500, message: "服务器内部错误" });
  }
});

router.post("/dr/spaces/:spaceId/collections", async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const spaceId = req.params.spaceId as string;
    const { name, description, coverUrl } = req.body as { name?: string; description?: string; coverUrl?: string };

    if (!name || !name.trim()) {
      res.status(400).json({ code: 400, message: "集合名称不能为空" });
      return;
    }

    const space = await prisma.drSpace.findUnique({ where: { spaceId } });
    if (!space) {
      res.status(404).json({ code: 404, message: "空间不存在" });
      return;
    }

    const maxOrder = await prisma.drSpaceCollection.findFirst({
      where: { spaceId },
      orderBy: { sortOrder: "desc" },
      select: { sortOrder: true },
    });

    const collection = await prisma.drSpaceCollection.create({
      data: {
        collectionId: generateDrId("SC"),
        spaceId,
        name: name.trim(),
        description: description?.trim() || "",
        coverUrl: coverUrl?.trim() || "",
        sortOrder: (maxOrder?.sortOrder ?? -1) + 1,
      },
    });

    res.json({ code: 200, message: "集合已创建", data: collection });
  } catch (error) {
    console.error("Admin create space collection error:", error);
    res.status(500).json({ code: 500, message: "服务器内部错误" });
  }
});

router.put("/dr/collections/:collectionId", async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const collectionId = req.params.collectionId as string;
    const { name, description, coverUrl } = req.body as { name?: string; description?: string; coverUrl?: string };

    const existing = await prisma.drSpaceCollection.findUnique({ where: { collectionId } });
    if (!existing) {
      res.status(404).json({ code: 404, message: "集合不存在" });
      return;
    }

    const updateData: Record<string, unknown> = {};
    if (name !== undefined) updateData.name = name.trim();
    if (description !== undefined) updateData.description = description.trim();
    if (coverUrl !== undefined) updateData.coverUrl = coverUrl.trim();

    const updated = await prisma.drSpaceCollection.update({ where: { collectionId }, data: updateData });
    res.json({ code: 200, message: "集合已更新", data: updated });
  } catch (error) {
    console.error("Admin update space collection error:", error);
    res.status(500).json({ code: 500, message: "服务器内部错误" });
  }
});

router.delete("/dr/collections/:collectionId", async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const collectionId = req.params.collectionId as string;
    const existing = await prisma.drSpaceCollection.findUnique({ where: { collectionId } });
    if (!existing) {
      res.status(404).json({ code: 404, message: "集合不存在" });
      return;
    }

    await prisma.drSpaceCollectionArticle.deleteMany({ where: { collectionId } });
    await prisma.drSpaceHomepageModuleResource.deleteMany({ where: { resourceId: collectionId, resourceType: "collection" } });
    await prisma.drSpaceCollection.delete({ where: { collectionId } });
    res.json({ code: 200, message: "集合已删除" });
  } catch (error) {
    console.error("Admin delete space collection error:", error);
    res.status(500).json({ code: 500, message: "服务器内部错误" });
  }
});

router.get("/dr/collections/:collectionId/articles", async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const collectionId = req.params.collectionId as string;
    const existing = await prisma.drSpaceCollection.findUnique({ where: { collectionId } });
    if (!existing) {
      res.status(404).json({ code: 404, message: "集合不存在" });
      return;
    }

    const items = await prisma.drSpaceCollectionArticle.findMany({
      where: { collectionId },
      orderBy: { sortOrder: "asc" },
    });

    const articleIds = items.map((i) => i.articleId);
    const articles = articleIds.length > 0 ? await prisma.drArticle.findMany({ where: { articleId: { in: articleIds } } }) : [];
    const articleMap = new Map(articles.map((a) => [a.articleId, a]));

    res.json({
      code: 200,
      message: "success",
      data: items.map((i) => ({ ...i, article: articleMap.get(i.articleId) ?? null })),
    });
  } catch (error) {
    console.error("Admin list collection articles error:", error);
    res.status(500).json({ code: 500, message: "服务器内部错误" });
  }
});

router.post("/dr/collections/:collectionId/articles", async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const collectionId = req.params.collectionId as string;
    const { articleId } = req.body as { articleId?: string };

    if (!articleId || !articleId.trim()) {
      res.status(400).json({ code: 400, message: "articleId 不能为空" });
      return;
    }

    const collection = await prisma.drSpaceCollection.findUnique({ where: { collectionId } });
    if (!collection) {
      res.status(404).json({ code: 404, message: "集合不存在" });
      return;
    }

    const article = await prisma.drArticle.findUnique({ where: { articleId } });
    if (!article) {
      res.status(404).json({ code: 404, message: "文章不存在" });
      return;
    }

    const maxOrder = await prisma.drSpaceCollectionArticle.findFirst({
      where: { collectionId },
      orderBy: { sortOrder: "desc" },
      select: { sortOrder: true },
    });

    const item = await prisma.drSpaceCollectionArticle.upsert({
      where: { collectionId_articleId: { collectionId, articleId } },
      create: { collectionId, articleId, sortOrder: (maxOrder?.sortOrder ?? -1) + 1 },
      update: {},
    });

    res.json({ code: 200, message: "文章已加入集合", data: item });
  } catch (error) {
    console.error("Admin add article to collection error:", error);
    res.status(500).json({ code: 500, message: "服务器内部错误" });
  }
});

router.delete("/dr/collections/:collectionId/articles/:articleId", async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { collectionId, articleId } = req.params as { collectionId: string; articleId: string };

    const existing = await prisma.drSpaceCollectionArticle.findUnique({
      where: { collectionId_articleId: { collectionId, articleId } },
    });
    if (!existing) {
      res.status(404).json({ code: 404, message: "文章不在该集合中" });
      return;
    }

    await prisma.drSpaceCollectionArticle.delete({
      where: { collectionId_articleId: { collectionId, articleId } },
    });
    res.json({ code: 200, message: "文章已从集合移除" });
  } catch (error) {
    console.error("Admin remove article from collection error:", error);
    res.status(500).json({ code: 500, message: "服务器内部错误" });
  }
});

// ── AI 工具 ──────────────────────────────────────────────────


// ── 每日精选文章池 ──────────────────────────────────────────────────

// 获取空间的精选文章池列表
router.get("/dr/spaces/:spaceId/daily-picks", async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const spaceId = req.params.spaceId as string;
    const space = await prisma.drSpace.findUnique({ where: { spaceId } });
    if (!space) {
      res.status(404).json({ code: 404, message: "空间不存在" });
      return;
    }

    const picks = await prisma.drDailyPickArticle.findMany({
      where: { spaceId },
      orderBy: { sortOrder: "asc" },
    });

    const articleIds = picks.map((p) => p.articleId);
    const articles = articleIds.length > 0 ? await prisma.drArticle.findMany({ where: { articleId: { in: articleIds } } }) : [];
    const articleMap = new Map(articles.map((a) => [a.articleId, a]));

    // 获取每篇文章的编辑高亮数量
    const highlightCounts = await prisma.drEditorHighlight.groupBy({
      by: ["articleId"],
      where: { articleId: { in: articleIds } },
      _count: { id: true },
    });
    const hlCountMap = new Map(highlightCounts.map((h) => [h.articleId, h._count.id]));

    res.json({
      code: 200,
      message: "success",
      data: picks.map((p) => ({
        ...p,
        article: articleMap.get(p.articleId) ?? null,
        highlightCount: hlCountMap.get(p.articleId) ?? 0,
      })),
    });
  } catch (error) {
    console.error("Admin list daily picks error:", error);
    res.status(500).json({ code: 500, message: "服务器内部错误" });
  }
});

// 添加文章为当前每日精选（自动禁用该空间其他精选）
router.post("/dr/spaces/:spaceId/daily-picks", async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const spaceId = req.params.spaceId as string;
    const { articleId, reason } = req.body as { articleId?: string; reason?: string };

    if (!articleId || !articleId.trim()) {
      res.status(400).json({ code: 400, message: "articleId 不能为空" });
      return;
    }

    const space = await prisma.drSpace.findUnique({ where: { spaceId } });
    if (!space) {
      res.status(404).json({ code: 404, message: "空间不存在" });
      return;
    }

    const article = await prisma.drArticle.findUnique({ where: { articleId } });
    if (!article) {
      res.status(404).json({ code: 404, message: "文章不存在" });
      return;
    }

    // 禁用该空间所有现有精选，然后创建新的
    await prisma.drDailyPickArticle.updateMany({
      where: { spaceId, enabled: true },
      data: { enabled: false },
    });

    const maxOrder = await prisma.drDailyPickArticle.findFirst({
      where: { spaceId },
      orderBy: { sortOrder: "desc" },
      select: { sortOrder: true },
    });

    const pick = await prisma.drDailyPickArticle.create({
      data: {
        pickId: generateDrId("DP"),
        spaceId,
        articleId,
        reason: reason?.trim() || "",
        sortOrder: (maxOrder?.sortOrder ?? -1) + 1,
        enabled: true,
      },
    });

    res.json({ code: 200, message: "已设为当前每日精选", data: pick });
  } catch (error) {
    console.error("Admin add daily pick error:", error);
    res.status(500).json({ code: 500, message: "服务器内部错误" });
  }
});

// 从精选池移除文章
router.delete("/dr/daily-picks/:pickId", async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const pickId = req.params.pickId as string;
    const existing = await prisma.drDailyPickArticle.findUnique({ where: { pickId } });
    if (!existing) {
      res.status(404).json({ code: 404, message: "精选记录不存在" });
      return;
    }

    await prisma.drDailyPickArticle.delete({ where: { pickId } });
    res.json({ code: 200, message: "文章已从精选池移除" });
  } catch (error) {
    console.error("Admin delete daily pick error:", error);
    res.status(500).json({ code: 500, message: "服务器内部错误" });
  }
});

// 激活某条精选为当前（禁用同空间其他精选）
router.put("/dr/daily-picks/:pickId/activate", async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const pickId = req.params.pickId as string;
    const existing = await prisma.drDailyPickArticle.findUnique({ where: { pickId } });
    if (!existing) {
      res.status(404).json({ code: 404, message: "精选记录不存在" });
      return;
    }

    // 禁用同空间所有精选，再启用当前这条
    await prisma.drDailyPickArticle.updateMany({
      where: { spaceId: existing.spaceId, enabled: true },
      data: { enabled: false },
    });

    const updated = await prisma.drDailyPickArticle.update({
      where: { pickId },
      data: { enabled: true },
    });
    res.json({ code: 200, message: "已设为当前每日精选", data: updated });
  } catch (error) {
    console.error("Admin activate daily pick error:", error);
    res.status(500).json({ code: 500, message: "服务器内部错误" });
  }
});

// 更新精选文章 reason
router.put("/dr/daily-picks/:pickId", async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const pickId = req.params.pickId as string;
    const { reason } = req.body as { reason?: string };

    const existing = await prisma.drDailyPickArticle.findUnique({ where: { pickId } });
    if (!existing) {
      res.status(404).json({ code: 404, message: "精选记录不存在" });
      return;
    }

    const updated = await prisma.drDailyPickArticle.update({
      where: { pickId },
      data: { reason: reason?.trim() ?? existing.reason },
    });
    res.json({ code: 200, message: "已更新", data: updated });
  } catch (error) {
    console.error("Admin update daily pick error:", error);
    res.status(500).json({ code: 500, message: "服务器内部错误" });
  }
});

// ── 思维格栅配置 ────────────────────────────────────────────────

// 获取空间的思维格栅列表（当前 + 历史）
router.get("/dr/spaces/:spaceId/daily-pick-lattice", async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const spaceId = req.params.spaceId as string;
    const space = await prisma.drSpace.findUnique({ where: { spaceId } });
    if (!space) {
      res.status(404).json({ code: 404, message: "空间不存在" });
      return;
    }

    const lattices = await prisma.drDailyPickLattice.findMany({
      where: { spaceId },
      orderBy: { createdAt: "desc" },
    });

    const collectionIds = [...new Set(lattices.map((l) => l.collectionId))];
    const collections = collectionIds.length > 0
      ? await prisma.drSpaceCollection.findMany({ where: { collectionId: { in: collectionIds } } })
      : [];
    const collectionMap = new Map(collections.map((c) => [c.collectionId, c]));

    const articleCounts = collectionIds.length > 0
      ? await prisma.drSpaceCollectionArticle.groupBy({ by: ["collectionId"], where: { collectionId: { in: collectionIds } }, _count: { id: true } })
      : [];
    const countMap = new Map(articleCounts.map((ac) => [ac.collectionId, ac._count.id]));

    const data = lattices.map((l) => {
      const col = collectionMap.get(l.collectionId);
      return {
        ...l,
        collection: col ? { collectionId: col.collectionId, name: col.name, description: col.description, coverUrl: col.coverUrl } : null,
        articleCount: countMap.get(l.collectionId) ?? 0,
      };
    });

    res.json({ code: 200, message: "success", data });
  } catch (error) {
    console.error("Admin get daily pick lattice error:", error);
    res.status(500).json({ code: 500, message: "服务器内部错误" });
  }
});

// 新增思维格栅（自动禁用该空间其他格栅）
router.post("/dr/spaces/:spaceId/daily-pick-lattice", async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const spaceId = req.params.spaceId as string;
    const { collectionId, recommendation } = req.body as {
      collectionId?: string;
      recommendation?: string;
    };

    const space = await prisma.drSpace.findUnique({ where: { spaceId } });
    if (!space) {
      res.status(404).json({ code: 404, message: "空间不存在" });
      return;
    }

    if (!collectionId || !collectionId.trim()) {
      res.status(400).json({ code: 400, message: "collectionId 不能为空" });
      return;
    }

    const collection = await prisma.drSpaceCollection.findUnique({ where: { collectionId } });
    if (!collection || collection.spaceId !== spaceId) {
      res.status(404).json({ code: 404, message: "合集不存在或不属于该空间" });
      return;
    }

    // 禁用该空间所有现有格栅
    await prisma.drDailyPickLattice.updateMany({
      where: { spaceId, enabled: true },
      data: { enabled: false },
    });

    const lattice = await prisma.drDailyPickLattice.create({
      data: {
        latticeId: generateDrId("LT"),
        spaceId,
        collectionId,
        recommendation: recommendation?.trim() ?? "",
        enabled: true,
      },
    });

    res.json({ code: 200, message: "已设为当前思维格栅", data: lattice });
  } catch (error) {
    console.error("Admin create daily pick lattice error:", error);
    res.status(500).json({ code: 500, message: "服务器内部错误" });
  }
});

// 激活某条思维格栅为当前（禁用同空间其他格栅）
router.put("/dr/daily-pick-lattice/:latticeId/activate", async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const latticeId = req.params.latticeId as string;
    const existing = await prisma.drDailyPickLattice.findUnique({ where: { latticeId } });
    if (!existing) {
      res.status(404).json({ code: 404, message: "思维格栅配置不存在" });
      return;
    }

    await prisma.drDailyPickLattice.updateMany({
      where: { spaceId: existing.spaceId, enabled: true },
      data: { enabled: false },
    });

    const updated = await prisma.drDailyPickLattice.update({
      where: { latticeId },
      data: { enabled: true },
    });
    res.json({ code: 200, message: "已设为当前思维格栅", data: updated });
  } catch (error) {
    console.error("Admin activate daily pick lattice error:", error);
    res.status(500).json({ code: 500, message: "服务器内部错误" });
  }
});

// 删除思维格栅配置
router.delete("/dr/daily-pick-lattice/:latticeId", async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const latticeId = req.params.latticeId as string;
    const existing = await prisma.drDailyPickLattice.findUnique({ where: { latticeId } });
    if (!existing) {
      res.status(404).json({ code: 404, message: "思维格栅配置不存在" });
      return;
    }

    await prisma.drDailyPickLattice.delete({ where: { latticeId } });
    res.json({ code: 200, message: "已删除" });
  } catch (error) {
    console.error("Admin delete daily pick lattice error:", error);
    res.status(500).json({ code: 500, message: "服务器内部错误" });
  }
});

// ── 编辑高亮 ──────────────────────────────────────────────────

// 获取文章的编辑高亮列表
router.get("/dr/articles/:articleId/editor-highlights", async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const articleId = req.params.articleId as string;
    const article = await prisma.drArticle.findUnique({ where: { articleId } });
    if (!article) {
      res.status(404).json({ code: 404, message: "文章不存在" });
      return;
    }

    const highlights = await prisma.drEditorHighlight.findMany({
      where: { articleId },
      orderBy: { sortOrder: "asc" },
    });

    res.json({ code: 200, message: "success", data: highlights });
  } catch (error) {
    console.error("Admin list editor highlights error:", error);
    res.status(500).json({ code: 500, message: "服务器内部错误" });
  }
});

// 创建编辑高亮
router.post("/dr/articles/:articleId/editor-highlights", async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const articleId = req.params.articleId as string;
    const { text, color, positionData, note, contextBefore, contextAfter } = req.body as {
      text?: string;
      color?: string;
      positionData?: string;
      note?: string;
      contextBefore?: string;
      contextAfter?: string;
    };

    if (!text || !text.trim()) {
      res.status(400).json({ code: 400, message: "高亮文本不能为空" });
      return;
    }

    const article = await prisma.drArticle.findUnique({ where: { articleId } });
    if (!article) {
      res.status(404).json({ code: 404, message: "文章不存在" });
      return;
    }

    const maxOrder = await prisma.drEditorHighlight.findFirst({
      where: { articleId },
      orderBy: { sortOrder: "desc" },
      select: { sortOrder: true },
    });

    const highlight = await prisma.drEditorHighlight.create({
      data: {
        highlightId: generateDrId("EH"),
        articleId,
        text: text.trim(),
        color: color || "#FFD700",
        positionData: positionData || "{}",
        note: note?.trim() || "",
        contextBefore: contextBefore?.trim() || "",
        contextAfter: contextAfter?.trim() || "",
        sortOrder: (maxOrder?.sortOrder ?? -1) + 1,
      },
    });

    res.json({ code: 200, message: "高亮已创建", data: highlight });
  } catch (error) {
    console.error("Admin create editor highlight error:", error);
    res.status(500).json({ code: 500, message: "服务器内部错误" });
  }
});

// 更新编辑高亮
router.put("/dr/editor-highlights/:highlightId", async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const highlightId = req.params.highlightId as string;
    const { text, color, positionData, note, sortOrder, contextBefore, contextAfter } = req.body as {
      text?: string;
      color?: string;
      positionData?: string;
      note?: string;
      sortOrder?: number;
      contextBefore?: string;
      contextAfter?: string;
    };

    const existing = await prisma.drEditorHighlight.findUnique({ where: { highlightId } });
    if (!existing) {
      res.status(404).json({ code: 404, message: "高亮不存在" });
      return;
    }

    const updateData: Record<string, unknown> = {};
    if (text !== undefined) updateData.text = text.trim();
    if (color !== undefined) updateData.color = color;
    if (positionData !== undefined) updateData.positionData = positionData;
    if (note !== undefined) updateData.note = note.trim();
    if (sortOrder !== undefined) updateData.sortOrder = sortOrder;
    if (contextBefore !== undefined) updateData.contextBefore = contextBefore.trim();
    if (contextAfter !== undefined) updateData.contextAfter = contextAfter.trim();

    const updated = await prisma.drEditorHighlight.update({ where: { highlightId }, data: updateData });
    res.json({ code: 200, message: "高亮已更新", data: updated });
  } catch (error) {
    console.error("Admin update editor highlight error:", error);
    res.status(500).json({ code: 500, message: "服务器内部错误" });
  }
});

// 删除编辑高亮
router.delete("/dr/editor-highlights/:highlightId", async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const highlightId = req.params.highlightId as string;
    const existing = await prisma.drEditorHighlight.findUnique({ where: { highlightId } });
    if (!existing) {
      res.status(404).json({ code: 404, message: "高亮不存在" });
      return;
    }

    await prisma.drEditorHighlight.delete({ where: { highlightId } });
    res.json({ code: 200, message: "高亮已删除" });
  } catch (error) {
    console.error("Admin delete editor highlight error:", error);
    res.status(500).json({ code: 500, message: "服务器内部错误" });
  }
});

// ── Image Hosting ─────────────────────────────────────────

const UPLOADS_DIR = path.resolve(__dirname, "../../uploads/images");
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const hash = crypto.randomBytes(8).toString("hex");
    cb(null, `${Date.now()}_${hash}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (_req, file, cb) => {
    const allowed = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg"];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error("仅支持图片格式：jpg/png/gif/webp/svg"));
  },
});

router.post("/upload/image", upload.single("file"), (req: AuthRequest, res: Response): void => {
  if (!req.file) {
    res.status(400).json({ code: 400, message: "未收到文件" });
    return;
  }
  const url = `/uploads/images/${req.file.filename}`;
  res.json({ code: 200, message: "上传成功", data: { url, filename: req.file.filename, size: req.file.size } });
});

router.get("/upload/images", (_req: AuthRequest, res: Response): void => {
  try {
    const files = fs.readdirSync(UPLOADS_DIR)
      .filter((f) => /\.(jpg|jpeg|png|gif|webp|svg)$/i.test(f))
      .map((filename) => {
        const stat = fs.statSync(path.join(UPLOADS_DIR, filename));
        return { filename, url: `/uploads/images/${filename}`, size: stat.size, createdAt: stat.birthtimeMs };
      })
      .sort((a, b) => b.createdAt - a.createdAt);
    res.json({ code: 200, message: "success", data: files });
  } catch {
    res.status(500).json({ code: 500, message: "服务器内部错误" });
  }
});

// ── AI Provider / Model 管理 ─────────────────────────────────

router.get("/dr/ai-providers", async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const providers = await prisma.drAiProvider.findMany({
      include: { models: { orderBy: { id: "asc" } } },
      orderBy: { id: "asc" },
    });
    res.json({ code: 200, message: "success", data: providers });
  } catch (error) {
    console.error("Get AI providers error:", error);
    res.status(500).json({ code: 500, message: "服务器内部错误" });
  }
});

router.post("/dr/ai-providers", async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { name, baseUrl, apiKey, enabled } = req.body as {
      name?: string; baseUrl?: string; apiKey?: string; enabled?: boolean;
    };
    if (!name?.trim() || !baseUrl?.trim() || !apiKey?.trim()) {
      res.status(400).json({ code: 400, message: "name / baseUrl / apiKey 必填" });
      return;
    }
    const provider = await prisma.drAiProvider.create({
      data: { name: name.trim(), baseUrl: baseUrl.trim(), apiKey: apiKey.trim(), enabled: enabled ?? true },
    });
    res.json({ code: 200, message: "已创建", data: provider });
  } catch (error) {
    console.error("Create AI provider error:", error);
    res.status(500).json({ code: 500, message: "服务器内部错误" });
  }
});

router.put("/dr/ai-providers/:id", async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) { res.status(400).json({ code: 400, message: "无效 ID" }); return; }
    const { name, baseUrl, apiKey, enabled } = req.body as {
      name?: string; baseUrl?: string; apiKey?: string; enabled?: boolean;
    };
    const data: Record<string, unknown> = {};
    if (name !== undefined) data.name = name.trim();
    if (baseUrl !== undefined) data.baseUrl = baseUrl.trim();
    if (apiKey !== undefined) data.apiKey = apiKey.trim();
    if (enabled !== undefined) data.enabled = enabled;
    const provider = await prisma.drAiProvider.update({ where: { id }, data });
    res.json({ code: 200, message: "已更新", data: provider });
  } catch (error) {
    console.error("Update AI provider error:", error);
    res.status(500).json({ code: 500, message: "服务器内部错误" });
  }
});

router.delete("/dr/ai-providers/:id", async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) { res.status(400).json({ code: 400, message: "无效 ID" }); return; }
    await prisma.drAiProvider.delete({ where: { id } });
    res.json({ code: 200, message: "已删除" });
  } catch (error) {
    console.error("Delete AI provider error:", error);
    res.status(500).json({ code: 500, message: "服务器内部错误" });
  }
});

router.post("/dr/ai-providers/:providerId/models", async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const providerId = Number(req.params.providerId);
    if (isNaN(providerId)) { res.status(400).json({ code: 400, message: "无效 providerId" }); return; }
    const { model, enabled, costPerUse } = req.body as {
      model?: string; enabled?: boolean; costPerUse?: number;
    };
    if (!model?.trim()) { res.status(400).json({ code: 400, message: "model 必填" }); return; }
    const aiModel = await prisma.drAiModel.create({
      data: { providerId, model: model.trim(), enabled: enabled ?? true, costPerUse: costPerUse ?? 1 },
    });
    res.json({ code: 200, message: "已创建", data: aiModel });
  } catch (error) {
    console.error("Create AI model error:", error);
    res.status(500).json({ code: 500, message: "服务器内部错误" });
  }
});

router.put("/dr/ai-models/:id", async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) { res.status(400).json({ code: 400, message: "无效 ID" }); return; }
    const { model, enabled, costPerUse } = req.body as {
      model?: string; enabled?: boolean; costPerUse?: number;
    };
    const data: Record<string, unknown> = {};
    if (model !== undefined) data.model = model.trim();
    if (enabled !== undefined) data.enabled = enabled;
    if (costPerUse !== undefined) data.costPerUse = costPerUse;
    const aiModel = await prisma.drAiModel.update({ where: { id }, data });
    res.json({ code: 200, message: "已更新", data: aiModel });
  } catch (error) {
    console.error("Update AI model error:", error);
    res.status(500).json({ code: 500, message: "服务器内部错误" });
  }
});

router.delete("/dr/ai-models/:id", async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) { res.status(400).json({ code: 400, message: "无效 ID" }); return; }
    await prisma.drAiModel.delete({ where: { id } });
    res.json({ code: 200, message: "已删除" });
  } catch (error) {
    console.error("Delete AI model error:", error);
    res.status(500).json({ code: 500, message: "服务器内部错误" });
  }
});

router.delete("/upload/images/:filename", (req: AuthRequest, res: Response): void => {
  const filename = req.params.filename as string;
  if (filename.includes("/") || filename.includes("..")) {
    res.status(400).json({ code: 400, message: "非法文件名" });
    return;
  }
  const filepath = path.join(UPLOADS_DIR, filename);
  if (!fs.existsSync(filepath)) {
    res.status(404).json({ code: 404, message: "文件不存在" });
    return;
  }
  fs.unlinkSync(filepath);
  res.json({ code: 200, message: "已删除" });
});

// ── AI 配额管理 ──────────────────────────────────────────────

router.get("/dr/ai-quotas", async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const quotas = await prisma.drAiQuota.findMany({ orderBy: { id: "desc" } });
    const userIds = [...new Set(quotas.map((q) => q.userId))];
    const users = userIds.length
      ? await prisma.drUser.findMany({ where: { id: { in: userIds } }, select: { id: true, phone: true, nickname: true } })
      : [];
    const userMap = new Map(users.map((u) => [u.id, u]));
    const data = quotas.map((q) => ({ ...q, user: userMap.get(q.userId) ?? null }));
    res.json({ code: 200, message: "success", data });
  } catch (error) {
    console.error("Get AI quotas error:", error);
    res.status(500).json({ code: 500, message: "服务器内部错误" });
  }
});

router.post("/dr/ai-quotas", async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { userId, dailyLimit } = req.body as { userId?: number; dailyLimit?: number };
    if (!userId || dailyLimit == null || dailyLimit < 0) {
      res.status(400).json({ code: 400, message: "参数不完整" });
      return;
    }
    const quota = await prisma.drAiQuota.upsert({
      where: { userId },
      create: { userId, dailyLimit },
      update: { dailyLimit },
    });
    res.json({ code: 200, message: "已保存", data: quota });
  } catch (error) {
    console.error("Upsert AI quota error:", error);
    res.status(500).json({ code: 500, message: "服务器内部错误" });
  }
});

router.delete("/dr/ai-quotas/:id", async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) { res.status(400).json({ code: 400, message: "无效 ID" }); return; }
    await prisma.drAiQuota.delete({ where: { id } });
    res.json({ code: 200, message: "已删除" });
  } catch (error) {
    console.error("Delete AI quota error:", error);
    res.status(500).json({ code: 500, message: "服务器内部错误" });
  }
});

router.get("/dr/ai-usages", async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.query.userId ? Number(req.query.userId) : undefined;
    const date = req.query.date as string | undefined;
    const where: Record<string, unknown> = {};
    if (userId) where.userId = userId;
    if (date) where.date = date;
    const usages = await prisma.drAiUsage.findMany({ where, orderBy: { id: "desc" }, take: 200 });
    const userIds = [...new Set(usages.map((u) => u.userId))];
    const users = userIds.length
      ? await prisma.drUser.findMany({ where: { id: { in: userIds } }, select: { id: true, phone: true, nickname: true } })
      : [];
    const userMap = new Map(users.map((u) => [u.id, u]));
    const data = usages.map((u) => ({ ...u, user: userMap.get(u.userId) ?? null }));
    res.json({ code: 200, message: "success", data });
  } catch (error) {
    console.error("Get AI usages error:", error);
    res.status(500).json({ code: 500, message: "服务器内部错误" });
  }
});

export default router;
