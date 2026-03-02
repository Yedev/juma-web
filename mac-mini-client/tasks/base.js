class ClientTaskBase {
  constructor({ taskName, version = "1.0.0", description = "" }) {
    if (!taskName || typeof taskName !== "string") {
      throw new Error("taskName is required for ClientTaskBase");
    }
    if (!/^client\.[a-zA-Z0-9_-]+$/.test(taskName.trim())) {
      throw new Error(`invalid client task name: ${taskName}`);
    }
    this.taskName = taskName.trim();
    this.version = version;
    this.description = description;
  }

  normalizePayload(payload) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return {};
    return payload;
  }

  getDefinition() {
    return {
      name: this.taskName,
      version: this.version,
      description: this.description,
    };
  }

  // eslint-disable-next-line no-unused-vars
  async run(payload, context) {
    throw new Error(`task ${this.taskName} run() not implemented`);
  }
}

module.exports = {
  ClientTaskBase,
};

