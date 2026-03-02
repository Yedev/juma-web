class ClientTaskRegistry {
  constructor() {
    this.taskMap = new Map();
  }

  register(taskInstance) {
    const taskName = taskInstance?.taskName;
    if (!taskName || typeof taskName !== "string") {
      throw new Error("task instance must provide taskName");
    }
    if (this.taskMap.has(taskName)) {
      throw new Error(`duplicated client task registration: ${taskName}`);
    }
    this.taskMap.set(taskName, taskInstance);
  }

  get(taskName) {
    return this.taskMap.get(taskName);
  }

  listDefinitions() {
    return Array.from(this.taskMap.values()).map((task) => task.getDefinition());
  }
}

module.exports = {
  ClientTaskRegistry,
};

