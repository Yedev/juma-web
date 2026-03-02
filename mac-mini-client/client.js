#!/usr/bin/env node

/**
 * Mac Mini 执行客户端
 * - 适用于无公网 IP 机器：客户端主动向服务器注册、心跳、拉取任务
 * - 上报可提供的 services，执行 remote_mac 任务并回传运行状态/日志/结果
 */

const os = require("os");
const { spawn } = require("child_process");
const { randomUUID } = require("crypto");

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
const DEMO_SERVICE_DELAY_MS = parseInt(process.env.DEMO_SERVICE_DELAY_MS || "3000", 10);

let runningTask = null;
let pollIntervalMs = DEFAULT_POLL_INTERVAL_MS;
let heartbeatIntervalMs = DEFAULT_HEARTBEAT_INTERVAL_MS;

const SERVICE_REGISTRY = {
  "demo.mock3s": async (payload) => {
    await sleep(DEMO_SERVICE_DELAY_MS);
    return {
      ok: true,
      service: "demo.mock3s",
      handled_at: nowIso(),
      delay_ms: DEMO_SERVICE_DELAY_MS,
      received: payload || {},
    };
  },
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function nowIso() {
  return new Date().toISOString();
}

function buildCapabilities() {
  return {
    cpus: os.cpus().length,
    platform: process.platform,
    arch: process.arch,
    memory_total_mb: Math.floor(os.totalmem() / 1024 / 1024),
    memory_free_mb: Math.floor(os.freemem() / 1024 / 1024),
    loadavg: os.loadavg(),
    uptime_sec: Math.floor(os.uptime()),
    work_dir: WORK_DIR,
  };
}

function getServiceDefinitions() {
  return Object.keys(SERVICE_REGISTRY).map((name) => ({
    name,
    version: "1.0.0",
    description: name === "demo.mock3s" ? "示例服务：模拟处理3秒并返回JSON" : "",
  }));
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
    services: getServiceDefinitions(),
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
    services: getServiceDefinitions(),
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

async function executeScriptTask(task) {
  const { task_id: taskId, script, timeout_sec: timeoutSec, env = {}, cwd } = task;
  if (!taskId || !script) return;
  try {
    await updateTask(taskId, "running", {
      current_step: "开始执行",
      progress: 5,
      started_at: nowIso(),
      executor: "remote_mac",
      client_id: CLIENT_ID,
      mode: "script",
    });

    const startTime = Date.now();
    let logBuffer = "";
    let lastFlushTs = Date.now();
    let timedOut = false;

    const flushLogs = async (force = false) => {
      if (!logBuffer) return;
      const enoughBySize = Buffer.byteLength(logBuffer, "utf8") >= LOG_FLUSH_SIZE;
      const enoughByTime = Date.now() - lastFlushTs >= LOG_FLUSH_INTERVAL_MS;
      if (!force && !enoughBySize && !enoughByTime) return;
      const payload = logBuffer;
      logBuffer = "";
      lastFlushTs = Date.now();
      try {
        await updateTask(taskId, "running", {
          current_step: "执行脚本中",
          progress: 50,
          mode: "script",
        }, payload, null);
      } catch (error) {
        // 日志回传失败不影响主流程，但继续缓冲后续日志
        console.warn(`[${nowIso()}] flush log failed:`, error.message);
      }
    };

    const child = spawn("bash", ["-lc", script], {
      cwd: cwd || WORK_DIR,
      env: { ...process.env, ...env },
    });

    const timeoutMs = Math.max(1, Number(timeoutSec || 300)) * 1000;
    const timeoutTimer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      logBuffer += chunk.toString();
      void flushLogs(false);
    });
    child.stderr.on("data", (chunk) => {
      logBuffer += chunk.toString();
      void flushLogs(false);
    });

    const result = await new Promise((resolve) => {
      child.on("close", (code, signal) => {
        clearTimeout(timeoutTimer);
        resolve({ code, signal });
      });
    });

    await flushLogs(true);

    const durationMs = Date.now() - startTime;
    const success = !timedOut && result.code === 0;
    if (success) {
      await updateTask(taskId, "completed", {
        current_step: "执行完成",
        progress: 100,
        duration_ms: durationMs,
        finished_at: nowIso(),
        executor: "remote_mac",
        client_id: CLIENT_ID,
        mode: "script",
      }, "", result.code);
    } else {
      await updateTask(taskId, "error", {
        error: timedOut ? "执行超时" : `进程异常退出: code=${result.code}, signal=${result.signal}`,
        timeout: timedOut,
        duration_ms: durationMs,
        finished_at: nowIso(),
        executor: "remote_mac",
        client_id: CLIENT_ID,
        mode: "script",
      }, "", typeof result.code === "number" ? result.code : -1);
    }
  } catch (error) {
    const fallbackLog = error?.stack || String(error);
    await updateTask(taskId, "error", {
      error: error?.message || "脚本执行异常",
      finished_at: nowIso(),
      executor: "remote_mac",
      client_id: CLIENT_ID,
      mode: "script",
    }, fallbackLog, -1);
  }
}

async function executeServiceTask(task) {
  const { task_id: taskId, service_name: serviceName, service_payload: servicePayload } = task;
  if (!taskId || !serviceName) return;
  const handler = SERVICE_REGISTRY[serviceName];
  if (!handler) {
    await updateTask(taskId, "error", {
      error: `客户端不支持服务: ${serviceName}`,
      finished_at: nowIso(),
      executor: "remote_mac",
      client_id: CLIENT_ID,
      mode: "service",
      service_name: serviceName,
    }, "", -1);
    return;
  }

  const startTime = Date.now();
  try {
    await updateTask(taskId, "running", {
      current_step: `执行服务 ${serviceName}`,
      progress: 20,
      started_at: nowIso(),
      executor: "remote_mac",
      client_id: CLIENT_ID,
      mode: "service",
      service_name: serviceName,
    }, "", null);

    const output = await handler(servicePayload);
    const durationMs = Date.now() - startTime;
    const outputStr = JSON.stringify(output);
    await updateTask(taskId, "completed", {
      current_step: "服务处理完成",
      progress: 100,
      duration_ms: durationMs,
      finished_at: nowIso(),
      executor: "remote_mac",
      client_id: CLIENT_ID,
      mode: "service",
      service_name: serviceName,
      output_json: output,
    }, outputStr, 0);
  } catch (error) {
    const durationMs = Date.now() - startTime;
    const fallbackLog = error?.stack || String(error);
    await updateTask(taskId, "error", {
      error: error?.message || "服务执行异常",
      duration_ms: durationMs,
      finished_at: nowIso(),
      executor: "remote_mac",
      client_id: CLIENT_ID,
      mode: "service",
      service_name: serviceName,
    }, fallbackLog, -1);
  }
}

async function executeTask(task) {
  const { task_id: taskId, script, service_name: serviceName } = task;
  if (!taskId) return;

  runningTask = taskId;
  try {
    if (serviceName) {
      await executeServiceTask(task);
      return;
    }
    if (script) {
      await executeScriptTask(task);
      return;
    }
    await updateTask(taskId, "error", {
      error: "任务缺少 script 或 service_name",
      finished_at: nowIso(),
      executor: "remote_mac",
      client_id: CLIENT_ID,
    }, "", -1);
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
          console.log(`[${nowIso()}] claimed task ${task.task_id}`);
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
  console.log(`[${nowIso()}] mac-mini client starting`);
  console.log(
    `[${nowIso()}] server=${SERVER_URL} client_id=${CLIENT_ID} tags=${CLIENT_TAGS.join(",") || "(none)"}`
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

