import crypto from "crypto";
import { IncomingMessage, Server as HttpServer } from "http";
import { Duplex } from "stream";
import { Prisma, PrismaClient, Task } from "@prisma/client";
import { inferTaskTypeFromName } from "../services/taskNaming";
import getRedis from "../lib/redis";
import logger from "../lib/logger";

const wsLog = logger.child({ module: "executorWS" });

const EXECUTOR_SHARED_KEY = process.env.EXECUTOR_SHARED_KEY || "juma_executor_2026";
const MAX_LOG_BYTES = parseInt(process.env.TASK_LOG_MAX_BYTES || "65536", 10);
const DEFAULT_HEARTBEAT_MS = parseInt(process.env.EXECUTOR_HEARTBEAT_INTERVAL_MS || "10000", 10);
const DISPATCH_INTERVAL_MS = parseInt(process.env.EXECUTOR_DISPATCH_INTERVAL_MS || "1500", 10);
const WS_PATH = "/ws/executor";
const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

type JsonObj = Record<string, unknown>;

interface TaskDef {
  name: string;
  version?: string;
  description?: string;
}

interface ExecutorSession {
  clientId: string;
  conn: WsConnection;
  tasks: Set<string>;
  tags: string[];
  maxConcurrency: number;
}

interface ParsedTaskEnvelope {
  taskPayload: JsonObj;
  requiredTags: string[];
  executionName?: string;
}

interface ClientHelloPayload {
  client_id?: unknown;
  name?: unknown;
  platform?: unknown;
  app_version?: unknown;
  tags?: unknown;
  capabilities?: unknown;
  tasks?: unknown;
}

interface TaskUpdatePayload {
  task_id?: unknown;
  status?: unknown;
  result_code?: unknown;
  status_info?: unknown;
}

interface TaskLogPayload {
  task_id?: unknown;
  append_log?: unknown;
}

interface WsEnvelope {
  type?: unknown;
  payload?: unknown;
}

class WsConnection {
  private buffer = Buffer.alloc(0);
  private closed = false;
  private messageHandlers: Array<(message: string) => void> = [];
  private closeHandlers: Array<() => void> = [];
  clientId?: string;

  constructor(private readonly socket: Duplex) {
    socket.on("data", (chunk) => this.handleData(chunk));
    socket.on("close", () => this.handleClose());
    socket.on("error", () => this.handleClose());
  }

  onMessage(handler: (message: string) => void): void {
    this.messageHandlers.push(handler);
  }

  onClose(handler: () => void): void {
    this.closeHandlers.push(handler);
  }

  sendJson(type: string, payload: JsonObj): void {
    this.sendText(JSON.stringify({ type, payload, ts: Date.now() }));
  }

  close(code = 1000, reason = ""): void {
    if (this.closed) return;
    const reasonBuffer = Buffer.from(reason, "utf8");
    const payload = Buffer.alloc(2 + reasonBuffer.length);
    payload.writeUInt16BE(code, 0);
    reasonBuffer.copy(payload, 2);
    this.sendFrame(0x8, payload);
    this.socket.end();
    this.closed = true;
  }

  private handleClose(): void {
    if (this.closed) return;
    this.closed = true;
    this.closeHandlers.forEach((handler) => handler());
  }

  private handleData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);

    while (true) {
      if (this.buffer.length < 2) return;
      const first = this.buffer[0];
      const second = this.buffer[1];
      const opcode = first & 0x0f;
      const masked = (second & 0x80) !== 0;
      let payloadLen = second & 0x7f;
      let offset = 2;

      if (payloadLen === 126) {
        if (this.buffer.length < offset + 2) return;
        payloadLen = this.buffer.readUInt16BE(offset);
        offset += 2;
      } else if (payloadLen === 127) {
        if (this.buffer.length < offset + 8) return;
        const high = this.buffer.readUInt32BE(offset);
        const low = this.buffer.readUInt32BE(offset + 4);
        payloadLen = high * 2 ** 32 + low;
        offset += 8;
      }

      if (!masked) {
        this.close(1002, "mask required");
        return;
      }
      if (this.buffer.length < offset + 4 + payloadLen) return;

      const mask = this.buffer.subarray(offset, offset + 4);
      offset += 4;
      const payload = this.buffer.subarray(offset, offset + payloadLen);
      for (let i = 0; i < payload.length; i += 1) {
        payload[i] ^= mask[i % 4];
      }

      this.buffer = this.buffer.subarray(offset + payloadLen);

      if (opcode === 0x1) {
        const text = payload.toString("utf8");
        this.messageHandlers.forEach((handler) => handler(text));
      } else if (opcode === 0x8) {
        this.close();
        return;
      } else if (opcode === 0x9) {
        this.sendFrame(0xA, payload);
      }
    }
  }

  private sendText(text: string): void {
    this.sendFrame(0x1, Buffer.from(text, "utf8"));
  }

  private sendFrame(opcode: number, payload: Buffer): void {
    if (this.closed) return;
    const finAndOpcode = 0x80 | opcode;
    let header: Buffer;
    if (payload.length < 126) {
      header = Buffer.from([finAndOpcode, payload.length]);
    } else if (payload.length < 65536) {
      header = Buffer.alloc(4);
      header[0] = finAndOpcode;
      header[1] = 126;
      header.writeUInt16BE(payload.length, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = finAndOpcode;
      header[1] = 127;
      header.writeUInt32BE(Math.floor(payload.length / 2 ** 32), 2);
      header.writeUInt32BE(payload.length >>> 0, 6);
    }
    this.socket.write(Buffer.concat([header, payload]));
  }
}

function parseJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function normalizeObject(value: unknown): JsonObj {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as JsonObj;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v) => typeof v === "string")
    .map((v) => (v as string).trim())
    .filter(Boolean);
}

function normalizeTasks(value: unknown): TaskDef[] {
  if (!Array.isArray(value)) return [];
  const dedupe = new Map<string, TaskDef>();
  value.forEach((item) => {
    if (typeof item === "string") {
      const name = item.trim();
      if (!name || inferTaskTypeFromName(name) !== "client_task") return;
      dedupe.set(name, { name });
      return;
    }
    if (!item || typeof item !== "object" || Array.isArray(item)) return;
    const obj = item as Record<string, unknown>;
    const name = typeof obj.name === "string" ? obj.name.trim() : "";
    if (!name || inferTaskTypeFromName(name) !== "client_task") return;
    const def: TaskDef = { name };
    if (typeof obj.version === "string" && obj.version.trim()) def.version = obj.version.trim();
    if (typeof obj.description === "string" && obj.description.trim()) def.description = obj.description.trim();
    dedupe.set(name, def);
  });
  return Array.from(dedupe.values());
}

function mergeCapabilities(base: JsonObj, latest: JsonObj, tasks: TaskDef[], maxConcurrency: number): JsonObj {
  return {
    ...base,
    ...latest,
    tasks,
    max_concurrency: maxConcurrency,
    task_protocol_version: "2.0-ws",
  };
}

function parseTaskEnvelope(task: Task): ParsedTaskEnvelope {
  const params = parseJson<JsonObj>(task.taskParams, {});
  const taskPayload = normalizeObject(params.task_payload);
  const requiredTags = toStringArray(params.required_tags);
  const executionNameRaw = params.execution_name;
  const executionName =
    typeof executionNameRaw === "string" && executionNameRaw.trim() ? executionNameRaw.trim().slice(0, 120) : undefined;
  return { taskPayload, requiredTags, executionName };
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

function getClientIp(req: IncomingMessage): string {
  const xfwd = req.headers["x-forwarded-for"];
  if (Array.isArray(xfwd)) return xfwd[0];
  if (typeof xfwd === "string") return xfwd.split(",")[0].trim();
  return req.socket.remoteAddress || "unknown";
}

function parseMaxConcurrency(capabilities: JsonObj): number {
  const raw = capabilities.max_concurrency;
  if (typeof raw !== "number" || !Number.isFinite(raw)) return 1;
  return Math.max(1, Math.min(20, Math.floor(raw)));
}

function parseUrl(req: IncomingMessage): URL | null {
  if (!req.url) return null;
  try {
    return new URL(req.url, "http://localhost");
  } catch {
    return null;
  }
}

function validateExecutorKey(req: IncomingMessage): boolean {
  const key = req.headers["x-executor-key"];
  const incomingKey = Array.isArray(key) ? key[0] : key;
  if (incomingKey && incomingKey === EXECUTOR_SHARED_KEY) return true;

  const parsed = parseUrl(req);
  const queryKey = parsed?.searchParams.get("key") || "";
  return queryKey === EXECUTOR_SHARED_KEY;
}

function upgradeToWs(req: IncomingMessage, socket: Duplex): WsConnection | null {
  const key = req.headers["sec-websocket-key"];
  if (typeof key !== "string" || !key.trim()) return null;
  const accept = crypto.createHash("sha1").update(key + WS_GUID).digest("base64");
  socket.write(
    [
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Accept: ${accept}`,
      "",
      "",
    ].join("\r\n")
  );
  return new WsConnection(socket);
}

export function createExecutorWsGateway(server: HttpServer, prisma: PrismaClient): void {
  const sessions = new Map<string, ExecutorSession>();
  let dispatching = false;

  const dispatch = async (): Promise<void> => {
    if (dispatching) return;
    dispatching = true;
    try {
      if (sessions.size === 0) return;

      const onlineClientIds = Array.from(sessions.keys());
      const runningRows = await prisma.task.groupBy({
        by: ["claimedByClientId"],
        where: {
          taskType: "client_task",
          status: "running",
          claimedByClientId: { in: onlineClientIds },
        },
        _count: { _all: true },
      });
      const runningMap = new Map<string, number>();
      runningRows.forEach((row) => {
        if (row.claimedByClientId) runningMap.set(row.claimedByClientId, row._count._all);
      });

      const candidates = await prisma.task.findMany({
        where: { status: "queued", taskType: "client_task" },
        orderBy: { createdAt: "asc" },
        take: 100,
      });

      for (const task of candidates) {
        if (inferTaskTypeFromName(task.taskName) !== "client_task") {
          await prisma.task.update({
            where: { id: task.id },
            data: {
              status: "error",
              statusInfo: JSON.stringify({
                executor: "client_task_runtime_ws",
                error: "task_name 命名非法，客户端任务必须是 client.name",
              }),
              finishedAt: new Date(),
            },
          });
          continue;
        }

        const envelope = parseTaskEnvelope(task);
        let selected: ExecutorSession | null = null;
        for (const session of sessions.values()) {
          if (task.targetClientId && task.targetClientId !== session.clientId) continue;
          if (!session.tasks.has(task.taskName)) continue;
          if (envelope.requiredTags.length > 0) {
            const matched = envelope.requiredTags.every((tag) => session.tags.includes(tag));
            if (!matched) continue;
          }
          const running = runningMap.get(session.clientId) ?? 0;
          if (running >= session.maxConcurrency) continue;
          selected = session;
          break;
        }
        if (!selected) continue;

        const now = new Date();
        const claimed = await prisma.task.updateMany({
          where: { id: task.id, status: "queued" },
          data: {
            status: "running",
            claimedByClientId: selected.clientId,
            claimedAt: now,
            startedAt: now,
            statusInfo: JSON.stringify({
              executor: "client_task_runtime_ws",
              client_id: selected.clientId,
              started_at: now.toISOString(),
            }),
          },
        });
        if (claimed.count === 0) continue;

        await prisma.executorClient.update({
          where: { clientId: selected.clientId },
          data: { tasksClaimed: { increment: 1 } },
        });
        runningMap.set(selected.clientId, (runningMap.get(selected.clientId) ?? 0) + 1);

        selected.conn.sendJson("task.assign", {
          task_id: task.taskId,
          task_name: task.taskName,
          task_payload: envelope.taskPayload,
          execution_name: envelope.executionName ?? "",
        });
      }
    } catch (error) {
      wsLog.error({ err: error }, "dispatch error");
    } finally {
      dispatching = false;
    }
  };

  const handleHello = async (conn: WsConnection, req: IncomingMessage, payloadRaw: unknown): Promise<void> => {
    const payload = normalizeObject(payloadRaw) as ClientHelloPayload;
    const clientId = typeof payload.client_id === "string" ? payload.client_id.trim() : "";
    const name = typeof payload.name === "string" ? payload.name.trim() : "";
    const platform = typeof payload.platform === "string" && payload.platform.trim() ? payload.platform.trim() : "darwin";
    const appVersion =
      typeof payload.app_version === "string" && payload.app_version.trim() ? payload.app_version.trim() : "unknown";
    const tags = toStringArray(payload.tags);
    const capabilities = normalizeObject(payload.capabilities);
    const tasks = normalizeTasks(payload.tasks ?? capabilities.tasks);
    const maxConcurrency = parseMaxConcurrency(capabilities);

    if (!clientId || !name) {
      conn.sendJson("server.error", { code: 400, message: "client_id and name are required" });
      conn.close(1008, "missing required fields");
      return;
    }

    const now = new Date();
    const existing = await prisma.executorClient.findUnique({ where: { clientId } });
    await prisma.executorClient.upsert({
      where: { clientId },
      update: {
        name,
        platform,
        appVersion,
        tags: JSON.stringify(tags),
        capabilities: JSON.stringify(
          mergeCapabilities(existing ? parseJson<JsonObj>(existing.capabilities, {}) : {}, capabilities, tasks, maxConcurrency)
        ),
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
        capabilities: JSON.stringify(mergeCapabilities({}, capabilities, tasks, maxConcurrency)),
        status: "online",
        ip: getClientIp(req),
        lastHeartbeat: now,
      },
    });

    const old = sessions.get(clientId);
    if (old && old.conn !== conn) old.conn.close(1012, "replaced by new connection");

    conn.clientId = clientId;
    sessions.set(clientId, {
      clientId,
      conn,
      tags,
      tasks: new Set(tasks.map((item) => item.name)),
      maxConcurrency,
    });

    conn.sendJson("server.hello", {
      client_id: clientId,
      heartbeat_interval_ms: DEFAULT_HEARTBEAT_MS,
      accepted_tasks: tasks,
      max_concurrency: maxConcurrency,
      server_time: now.toISOString(),
    });

    await dispatch();
  };

  const handleTaskUpdate = async (conn: WsConnection, payloadRaw: unknown): Promise<void> => {
    const clientId = conn.clientId;
    if (!clientId) {
      conn.sendJson("server.error", { code: 401, message: "client not registered" });
      return;
    }

    const payload = normalizeObject(payloadRaw) as TaskUpdatePayload;
    const taskId = typeof payload.task_id === "string" ? payload.task_id.trim() : "";
    const status = typeof payload.status === "string" ? payload.status.trim() : "";
    const resultCode = typeof payload.result_code === "number" ? payload.result_code : null;
    const statusInfoRaw = normalizeObject(payload.status_info);

    if (!taskId || !status || !["running", "completed", "error"].includes(status)) {
      conn.sendJson("server.error", { code: 400, message: "invalid task.update payload" });
      return;
    }

    const task = await prisma.task.findUnique({ where: { taskId } });
    if (!task) {
      conn.sendJson("server.error", { code: 404, message: "task not found" });
      return;
    }

    if (task.taskType !== "client_task") {
      conn.sendJson("server.error", { code: 400, message: "task type mismatch" });
      return;
    }

    if (task.claimedByClientId && task.claimedByClientId !== clientId) {
      conn.sendJson("server.error", { code: 403, message: "task not claimed by this client" });
      return;
    }

    const now = new Date();
    const oldInfo = parseJson<JsonObj>(task.statusInfo, {});
    const mergedInfo: JsonObj = {
      ...oldInfo,
      ...statusInfoRaw,
      executor: "client_task_runtime_ws",
      client_id: clientId,
      reported_at: now.toISOString(),
    };

    const data: Prisma.TaskUpdateInput = { status, statusInfo: JSON.stringify(mergedInfo) };
    if (status === "running" && !task.startedAt) data.startedAt = now;
    if (status === "completed" || status === "error") {
      data.finishedAt = now;
      if (resultCode != null) data.resultCode = resultCode;
    }

    await prisma.task.update({ where: { taskId }, data });

    if (status === "completed") {
      await prisma.executorClient.update({ where: { clientId }, data: { tasksSuccess: { increment: 1 } } });
    } else if (status === "error") {
      await prisma.executorClient.update({ where: { clientId }, data: { tasksFailed: { increment: 1 } } });
    }

    await prisma.executorClient.update({
      where: { clientId },
      data: { status: "online", lastHeartbeat: now },
    });

    conn.sendJson("task.update.ack", { task_id: taskId, status });
    await dispatch();
  };


  const handleTaskLog = async (conn: WsConnection, payloadRaw: unknown): Promise<void> => {
    const clientId = conn.clientId;
    if (!clientId) {
      conn.sendJson("server.error", { code: 401, message: "client not registered" });
      return;
    }

    const payload = normalizeObject(payloadRaw) as TaskLogPayload;
    const taskId = typeof payload.task_id === "string" ? payload.task_id.trim() : "";
    const appendLog = typeof payload.append_log === "string" ? payload.append_log : "";

    if (!taskId || !appendLog.trim()) {
      conn.sendJson("server.error", { code: 400, message: "invalid task.log payload" });
      return;
    }

    const task = await prisma.task.findUnique({ where: { taskId } });
    if (!task) {
      conn.sendJson("server.error", { code: 404, message: "task not found" });
      return;
    }

    if (task.taskType !== "client_task") {
      conn.sendJson("server.error", { code: 400, message: "task type mismatch" });
      return;
    }

    if (task.claimedByClientId && task.claimedByClientId !== clientId) {
      conn.sendJson("server.error", { code: 403, message: "task not claimed by this client" });
      return;
    }

    await prisma.task.update({
      where: { taskId },
      data: {
        executionLog: trimLog(task.executionLog ? `${task.executionLog}\n${appendLog}` : appendLog),
      },
    });

    conn.sendJson("task.log.ack", { task_id: taskId });
  };

  server.on("upgrade", (req, socket) => {
    const parsedUrl = parseUrl(req);
    if (!parsedUrl || parsedUrl.pathname !== WS_PATH) {
      socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
      socket.destroy();
      return;
    }
    if (!validateExecutorKey(req)) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    const conn = upgradeToWs(req, socket);
    if (!conn) {
      socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
      socket.destroy();
      return;
    }

    conn.onMessage((text) => {
      const envelope = parseJson<WsEnvelope>(text, {});
      const type = typeof envelope.type === "string" ? envelope.type : "";

      void (async () => {
        if (type === "client.hello") {
          await handleHello(conn, req, envelope.payload);
          return;
        }
        if (type === "client.heartbeat") {
          if (conn.clientId) {
            await prisma.executorClient.update({
              where: { clientId: conn.clientId },
              data: { status: "online", lastHeartbeat: new Date() },
            });
            const redis = getRedis();
            if (redis) void redis.set(`executor:heartbeat:${conn.clientId}`, "1", "EX", 70).catch(() => {});
          }
          conn.sendJson("server.heartbeat.ack", { ok: true });
          return;
        }
        if (type === "task.update") {
          await handleTaskUpdate(conn, envelope.payload);
          return;
        }
        if (type === "task.log") {
          await handleTaskLog(conn, envelope.payload);
          return;
        }
        conn.sendJson("server.error", { code: 400, message: `unsupported type: ${type}` });
      })().catch((error: unknown) => {
        wsLog.error({ err: error, clientId: conn.clientId }, "message handler error");
        conn.sendJson("server.error", { code: 500, message: "服务器内部错误" });
      });
    });

    conn.onClose(() => {
      if (!conn.clientId) return;
      wsLog.info({ clientId: conn.clientId }, "executor disconnected");
      const active = sessions.get(conn.clientId);
      if (active && active.conn === conn) sessions.delete(conn.clientId);
      const redis = getRedis();
      if (redis) void redis.del(`executor:heartbeat:${conn.clientId}`).catch(() => {});
      void prisma.executorClient
        .update({ where: { clientId: conn.clientId }, data: { status: "offline" } })
        .catch((error: unknown) => {
          wsLog.error({ err: error, clientId: conn.clientId }, "close update failed");
        });
    });
  });

  setInterval(() => {
    void dispatch();
  }, DISPATCH_INTERVAL_MS);
}
