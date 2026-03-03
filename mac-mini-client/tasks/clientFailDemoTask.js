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

class ClientFailDemoTask extends ClientTaskBase {
  constructor() {
    super({
      taskName: "client.fail_demo",
      version: "1.0.0",
      description: "示例异常任务：用于验证客户端异常处理、日志上报与 error 状态回传",
    });
  }

  normalizePayload(payload) {
    const input = super.normalizePayload(payload);
    return {
      message: pickString(input, "message", "client.fail_demo 人工触发异常"),
      before_fail_ms: pickNumber(input, "before_fail_ms", 1200, 0, 60000),
      fail_at_step: pickNumber(input, "fail_at_step", 2, 1, 5),
      total_steps: pickNumber(input, "total_steps", 4, 1, 10),
    };
  }

  async run(payload, context) {
    const normalized = this.normalizePayload(payload);
    context.log(
      `[${this.taskName}] begin, message=${normalized.message}, fail_at_step=${normalized.fail_at_step}/${normalized.total_steps}`
    );

    for (let step = 1; step <= normalized.total_steps; step += 1) {
      context.log(`[${this.taskName}] step ${step}/${normalized.total_steps}`);
      if (normalized.before_fail_ms > 0) {
        await sleep(Math.floor(normalized.before_fail_ms / normalized.total_steps));
      }
      if (step === normalized.fail_at_step) {
        throw new Error(`${normalized.message} (step=${step})`);
      }
    }

    return { ok: true, unexpected: true };
  }
}

module.exports = {
  ClientFailDemoTask,
};
