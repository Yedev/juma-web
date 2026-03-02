const { ClientTaskRegistry } = require("./registry");
const { ClientEchoTask } = require("./clientEchoTask");
const { ClientMock3sTask } = require("./clientMock3sTask");

const registry = new ClientTaskRegistry();

function registerBuiltinTasks() {
  registry.register(new ClientEchoTask());
  registry.register(new ClientMock3sTask(process.env.DEMO_TASK_DELAY_MS || "3000"));
}

registerBuiltinTasks();

function getRegisteredTaskDefinitions() {
  return registry.listDefinitions();
}

function getRegisteredTask(taskName) {
  return registry.get(taskName);
}

module.exports = {
  getRegisteredTaskDefinitions,
  getRegisteredTask,
};

