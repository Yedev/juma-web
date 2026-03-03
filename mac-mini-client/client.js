#!/usr/bin/env node

/**
 * Mac Mini 执行客户端（WebSocket Task 模式）
 * - 客户端通过 WebSocket 主动连接服务端
 * - 服务端主动推送 task.assign
 * - 客户端通过 task.update 回传状态，通过 task.log 回传执行日志
 */

const os = require("os");
const { randomUUID } = require("crypto");
const { getRegisteredTaskDefinitions, getRegisteredTask } = require("./tasks");

const SERVER_URL = (process.env.SERVER_URL || "http://localhost:3001").replace(/\/+$/, "");
const EXECUTOR_KEY = process.env.EXECUTOR_KEY || "juma_executor_2026";
const CLIENT_ID = process.env.CLIENT_ID || `macmini-${os.hostname()}-${randomUUID().slice(0, 8)}`;
const CLIENT_NAME = process.env.CLIENT_NAME || os.hostname();
const CLIENT_TAGS = (process.env.CLIENT_TAGS || "")
  .split(",")
  .map((x) => x.trim())
  .filter(Boolean);
const APP_VERSION = process.env.CLIENT_VERSION || "1.0.0";
const WORK_DIR = process.env.WORK_DIR || process.cwd();
const DEFAULT_HEARTBEAT_INTERVAL_MS = parseInt(process.env.HEARTBEAT_INTERVAL_MS || "10000", 10);
const LOG_FLUSH_INTERVAL_MS = parseInt(process.env.LOG_FLUSH_INTERVAL_MS || "2000", 10);
const LOG_FLUSH_SIZE = parseInt(process.env.LOG_FLUSH_SIZE || "2048", 10);
const RECONNECT_DELAY_MS = parseInt(process.env.RECONNECT_DELAY_MS || "3000", 10);

const HTTP_URL = new URL(SERVER_URL);
const WS_PROTOCOL = HTTP_URL.protocol === "https:" ? "wss:" : "ws:";
const WS_URL = `${WS_PROTOCOL}//${HTTP_URL.host}/ws/executor?key=${encodeURIComponent(EXECUTOR_KEY)}`;

let ws = null;
let heartbeatIntervalMs = DEFAULT_HEARTBEAT_INTERVAL_MS;
let heartbeatTimer = null;
let reconnectTimer = null;
let runningTaskId = null;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function nowIso() {
  return new Date().toISOString();
}

function buildCapabilities() {
  const tasks = getRegisteredTaskDefinitions();
  return {
    cpus: os.cpus().length,
    platform: process.platform,
    arch: process.arch,
    memory_total_mb: Math.floor(os.totalmem() / 1024 / 1024),
    memory_free_mb: Math.floor(os.freemem() / 1024 / 1024),
    loadavg: os.loadavg(),
    uptime_sec: Math.floor(os.uptime()),
    work_dir: WORK_DIR,
    task_count: tasks.length,
  };
}

function getTaskDefinitions() {
  return getRegisteredTaskDefinitions();
}

function sendWs(type, payload = {}) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return false;
  ws.send(
    JSON.stringify({
      type,
      payload,
      ts: Date.now(),
    })
  );
  return true;
}

function updateTask(taskId, status, statusInfo = {}, resultCode = null) {
  const ok = sendWs("task.update", {
    task_id: taskId,
    status,
    status_info: statusInfo,
    result_code: resultCode,
  });
  if (!ok) {
    console.warn(`[${nowIso()}] send task.update failed, task_id=${taskId}, status=${status}`);
  }
  return ok;
}

function appendTaskLog(taskId, appendLog) {
  if (!appendLog) return false;
  const ok = sendWs("task.log", {
    task_id: taskId,
    append_log: appendLog,
  });
  if (!ok) {
    console.warn(`[${nowIso()}] send task.log failed, task_id=${taskId}`);
  }
  return ok;
}

function toPayloadObject(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return {};
  return payload;
}

async function executeTask(task) {
  const { task_id: taskId, task_name: taskName, task_payload: rawPayload, execution_name: executionName } = task || {};
  if (!taskId || !taskName) return;

  const taskInstance = getRegisteredTask(taskName);
  if (!taskInstance) {
    updateTask(
      taskId,
      "error",
      {
        error: `任务未注册: ${taskName}`,
        finished_at: nowIso(),
        executor: "client_task_runtime_ws",
        client_id: CLIENT_ID,
        task_name: taskName,
        execution_name: executionName,
      },
      -1
    );
    return;
  }

  runningTaskId = taskId;
  try {
    updateTask(taskId, "running", {
      current_step: `开始执行 ${taskName}`,
      progress: 5,
      started_at: nowIso(),
      executor: "client_task_runtime_ws",
      client_id: CLIENT_ID,
      task_name: taskName,
      execution_name: executionName,
    });

    const startTime = Date.now();
    let logBuffer = "";
    let lastFlushTs = Date.now();

    const flushLogs = async (force = false) => {
      if (!logBuffer) return;
      const enoughBySize = Buffer.byteLength(logBuffer, "utf8") >= LOG_FLUSH_SIZE;
      const enoughByTime = Date.now() - lastFlushTs >= LOG_FLUSH_INTERVAL_MS;
      if (!force && !enoughBySize && !enoughByTime) return;
      const payload = logBuffer;
      logBuffer = "";
      lastFlushTs = Date.now();
      appendTaskLog(taskId, payload);
    };

    const context = {
      taskId,
      taskName,
      executionName,
      clientId: CLIENT_ID,
      log: (line) => {
        if (typeof line !== "string") return;
        logBuffer += `${line}\n`;
        void flushLogs(false);
      },
    };

    const payload = toPayloadObject(rawPayload);
    const output = await taskInstance.run(payload, context);
    await flushLogs(true);

    const durationMs = Date.now() - startTime;
    updateTask(taskId, "completed", {
      current_step: "执行完成",
      progress: 100,
      duration_ms: durationMs,
      finished_at: nowIso(),
      executor: "client_task_runtime_ws",
      client_id: CLIENT_ID,
      task_name: taskName,
      execution_name: executionName,
      output_json: output,
    });
  } catch (error) {
    const fallbackLog = error?.stack || String(error);
    appendTaskLog(taskId, fallbackLog);
    updateTask(
      taskId,
      "error",
      {
        error: error?.message || "任务执行异常",
        finished_at: nowIso(),
        executor: "client_task_runtime_ws",
        client_id: CLIENT_ID,
        task_name: taskName,
        execution_name: executionName,
      },
      -1
    );
  } finally {
    runningTaskId = null;
  }
}

function clearTimers() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, RECONNECT_DELAY_MS);
}

function startHeartbeat() {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  heartbeatTimer = setInterval(() => {
    sendWs("client.heartbeat", {
      client_id: CLIENT_ID,
      capabilities: buildCapabilities(),
      tasks: getTaskDefinitions(),
      running_task_id: runningTaskId || null,
    });
  }, heartbeatIntervalMs);
}

function handleMessage(raw) {
  let envelope = {};
  try {
    envelope = JSON.parse(String(raw));
  } catch {
    return;
  }

  const type = envelope?.type;
  const payload = envelope?.payload || {};

  if (type === "server.hello") {
    const remoteHeartbeat = Number(payload.heartbeat_interval_ms);
    if (Number.isFinite(remoteHeartbeat) && remoteHeartbeat > 3000) {
      heartbeatIntervalMs = remoteHeartbeat;
    }
    console.log(
      `[${nowIso()}] registered via ws, heartbeat=${heartbeatIntervalMs}ms, accepted_tasks=${(payload.accepted_tasks || [])
        .map((item) => item?.name)
        .filter(Boolean)
        .join(",") || "(none)"}`
    );
    startHeartbeat();
    return;
  }

  if (type === "task.assign") {
    if (runningTaskId) {
      console.warn(`[${nowIso()}] skip task ${payload.task_id}, another task is running`);
      return;
    }
    console.log(`[${nowIso()}] received task ${payload.task_id}, task_name=${payload.task_name}`);
    void executeTask(payload);
    return;
  }

  if (type === "server.error") {
    console.warn(`[${nowIso()}] server error: ${payload.message || "unknown"}`);
  }
}

function connect() {
  clearTimers();
  ws = new WebSocket(WS_URL);

  ws.addEventListener("open", () => {
    console.log(`[${nowIso()}] ws connected: ${WS_URL}`);
    sendWs("client.hello", {
      client_id: CLIENT_ID,
      name: CLIENT_NAME,
      platform: process.platform,
      app_version: APP_VERSION,
      tags: CLIENT_TAGS,
      capabilities: buildCapabilities(),
      tasks: getTaskDefinitions(),
    });
    startHeartbeat();
  });

  ws.addEventListener("message", (event) => {
    handleMessage(event.data);
  });

  ws.addEventListener("close", () => {
    console.warn(`[${nowIso()}] ws disconnected, reconnect in ${RECONNECT_DELAY_MS}ms`);
    clearTimers();
    scheduleReconnect();
  });

  ws.addEventListener("error", (error) => {
    console.warn(`[${nowIso()}] ws error:`, error?.message || "unknown");
  });
}

async function main() {
  const taskDefs = getTaskDefinitions().map((item) => item.name).join(", ") || "(none)";
  console.log(`[${nowIso()}] mac-mini ws client starting`);
  console.log(
    `[${nowIso()}] ws=${WS_URL} client_id=${CLIENT_ID} tags=${CLIENT_TAGS.join(",") || "(none)"} tasks=${taskDefs}`
  );

  connect();

  while (true) {
    await sleep(24 * 60 * 60 * 1000);
  }
}

main().catch((error) => {
  console.error(`[${nowIso()}] fatal:`, error);
  process.exit(1);
});
