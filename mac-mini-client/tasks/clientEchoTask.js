const { ClientTaskBase } = require("./base");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pickString(input, key, fallback, maxLen = 300) {
  const value = input[key];
  if (typeof value !== "string") return fallback;
  const normalized = value.trim();
  if (!normalized) return fallback;
  return normalized.slice(0, maxLen);
}

function pickNumber(input, key, fallback, min, max) {
  const value = input[key];
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

class ClientEchoTask extends ClientTaskBase {
  constructor() {
    super({
      taskName: "client.echo",
      version: "1.0.0",
      description: "客户端回显示例任务",
    });
  }

  normalizePayload(payload) {
    const input = super.normalizePayload(payload);
    return {
      message: pickString(input, "message", "hello from client task"),
      repeat: pickNumber(input, "repeat", 1, 1, 20),
      sleep_ms: pickNumber(input, "sleep_ms", 500, 0, 30000),
    };
  }

  async run(payload, context) {
    const normalized = this.normalizePayload(payload);
    context.log(
      `[${this.taskName}] start, execution_name=${context.executionName || "-"}, repeat=${normalized.repeat}`
    );
    for (let i = 1; i <= normalized.repeat; i += 1) {
      context.log(`[${this.taskName}] ${i}/${normalized.repeat}: ${normalized.message}`);
      if (normalized.sleep_ms > 0) await sleep(normalized.sleep_ms);
    }
    context.log(`[${this.taskName}] done`);
    return {
      ok: true,
      repeated: normalized.repeat,
      echoed_message: normalized.message,
    };
  }
}

module.exports = {
  ClientEchoTask,
};

