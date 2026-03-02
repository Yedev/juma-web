#!/usr/bin/env node

/**
 * Mac Mini 执行客户端（Task 模式）
 * - 客户端主动向服务器注册/心跳/拉任务
 * - 仅支持 task_name + task_payload 执行，不支持脚本
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
const REQUEST_TIMEOUT_MS = parseInt(process.env.REQUEST_TIMEOUT_MS || "20000", 10);
const DEFAULT_POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS || "4000", 10);
const DEFAULT_HEARTBEAT_INTERVAL_MS = parseInt(process.env.HEARTBEAT_INTERVAL_MS || "10000", 10);
const LOG_FLUSH_INTERVAL_MS = parseInt(process.env.LOG_FLUSH_INTERVAL_MS || "2000", 10);
const LOG_FLUSH_SIZE = parseInt(process.env.LOG_FLUSH_SIZE || "2048", 10);

let runningTask = null;
let pollIntervalMs = DEFAULT_POLL_INTERVAL_MS;
let heartbeatIntervalMs = DEFAULT_HEARTBEAT_INTERVAL_MS;

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

async function apiPost(path, payload, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${SERVER_URL}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-executor-key": EXECUTOR_KEY,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = data?.message || `HTTP ${res.status}`;
      throw new Error(msg);
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

async function postWithRetry(path, payload, retries = 3) {
  let lastError = null;
  for (let i = 0; i < retries; i += 1) {
    try {
      return await apiPost(path, payload);
    } catch (error) {
      lastError = error;
      const wait = Math.min(5000, 300 * (i + 1));
      await sleep(wait);
    }
  }
  throw lastError || new Error("request failed");
}

async function register() {
  const data = await postWithRetry("/api/executor/register", {
    client_id: CLIENT_ID,
    name: CLIENT_NAME,
    platform: process.platform,
    app_version: APP_VERSION,
    tags: CLIENT_TAGS,
    capabilities: buildCapabilities(),
    tasks: getTaskDefinitions(),
  });
  const remotePoll = Number(data?.data?.poll_interval_ms);
  const remoteHeartbeat = Number(data?.data?.heartbeat_interval_ms);
  if (Number.isFinite(remotePoll) && remotePoll > 1000) pollIntervalMs = remotePoll;
  if (Number.isFinite(remoteHeartbeat) && remoteHeartbeat > 3000) heartbeatIntervalMs = remoteHeartbeat;
}

async function sendHeartbeat() {
  await postWithRetry("/api/executor/heartbeat", {
    client_id: CLIENT_ID,
    capabilities: buildCapabilities(),
    tasks: getTaskDefinitions(),
  });
}

async function fetchNextTask() {
  const data = await postWithRetry("/api/executor/next-task", {
    client_id: CLIENT_ID,
  });
  return data?.data || null;
}

async function updateTask(taskId, status, statusInfo = {}, appendLog = "", resultCode = null) {
  await postWithRetry("/api/executor/task-update", {
    client_id: CLIENT_ID,
    task_id: taskId,
    status,
    status_info: statusInfo,
    append_log: appendLog || undefined,
    result_code: resultCode,
  });
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
    await updateTask(
      taskId,
      "error",
      {
        error: `任务未注册: ${taskName}`,
        finished_at: nowIso(),
        executor: "client_task_runtime",
        client_id: CLIENT_ID,
        task_name: taskName,
        execution_name: executionName,
      },
      "",
      -1
    );
    return;
  }

  runningTask = taskId;
  try {
    await updateTask(taskId, "running", {
      current_step: `开始执行 ${taskName}`,
      progress: 5,
      started_at: nowIso(),
      executor: "client_task_runtime",
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
      try {
        await updateTask(
          taskId,
          "running",
          {
            current_step: `执行 ${taskName} 中`,
            progress: 60,
            executor: "client_task_runtime",
            client_id: CLIENT_ID,
            task_name: taskName,
            execution_name: executionName,
          },
          payload,
          null
        );
      } catch (error) {
        console.warn(`[${nowIso()}] flush log failed:`, error.message);
      }
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
    await updateTask(taskId, "completed", {
      current_step: "执行完成",
      progress: 100,
      duration_ms: durationMs,
      finished_at: nowIso(),
      executor: "client_task_runtime",
      client_id: CLIENT_ID,
      task_name: taskName,
      execution_name: executionName,
      output_json: output,
    });
  } catch (error) {
    const fallbackLog = error?.stack || String(error);
    await updateTask(
      taskId,
      "error",
      {
        error: error?.message || "任务执行异常",
        finished_at: nowIso(),
        executor: "client_task_runtime",
        client_id: CLIENT_ID,
        task_name: taskName,
        execution_name: executionName,
      },
      fallbackLog,
      -1
    );
  } finally {
    runningTask = null;
  }
}

async function heartbeatLoop() {
  while (true) {
    try {
      await sendHeartbeat();
    } catch (error) {
      console.warn(`[${nowIso()}] heartbeat failed:`, error.message);
    }
    await sleep(heartbeatIntervalMs);
  }
}

async function pollLoop() {
  while (true) {
    try {
      if (!runningTask) {
        const task = await fetchNextTask();
        if (task?.task_id) {
          console.log(`[${nowIso()}] claimed task ${task.task_id}, task_name=${task.task_name}`);
          await executeTask(task);
        }
      }
    } catch (error) {
      console.warn(`[${nowIso()}] poll failed:`, error.message);
    }
    await sleep(pollIntervalMs);
  }
}

async function main() {
  const taskDefs = getTaskDefinitions().map((item) => item.name).join(", ") || "(none)";
  console.log(`[${nowIso()}] mac-mini client starting`);
  console.log(
    `[${nowIso()}] server=${SERVER_URL} client_id=${CLIENT_ID} tags=${CLIENT_TAGS.join(",") || "(none)"} tasks=${taskDefs}`
  );

  while (true) {
    try {
      await register();
      console.log(`[${nowIso()}] registered, poll=${pollIntervalMs}ms, heartbeat=${heartbeatIntervalMs}ms`);
      break;
    } catch (error) {
      console.warn(`[${nowIso()}] register failed, retry in 3s:`, error.message);
      await sleep(3000);
    }
  }

  await Promise.all([heartbeatLoop(), pollLoop()]);
}

main().catch((error) => {
  console.error(`[${nowIso()}] fatal:`, error);
  process.exit(1);
});

