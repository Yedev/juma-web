const { ClientTaskBase } = require("./base");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function nowIso() {
  return new Date().toISOString();
}

class ClientMock3sTask extends ClientTaskBase {
  constructor(delayMs) {
    super({
      taskName: "client.mock3s",
      version: "1.0.0",
      description: "示例任务：模拟处理约3秒并返回JSON",
    });
    this.delayMs = Math.max(0, Number(delayMs) || 3000);
  }

  normalizePayload(payload) {
    const input = super.normalizePayload(payload);
    return { ...input };
  }

  async run(payload, context) {
    const normalized = this.normalizePayload(payload);
    context.log(`[${this.taskName}] processing for ${this.delayMs}ms`);
    await sleep(this.delayMs);
    const output = {
      ok: true,
      task_name: this.taskName,
      handled_at: nowIso(),
      delay_ms: this.delayMs,
      received: normalized,
    };
    context.log(`[${this.taskName}] done`);
    return output;
  }
}

module.exports = {
  ClientMock3sTask,
};

