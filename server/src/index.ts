import { PrismaClient } from "@prisma/client";
import { createServer } from "http";
import app from "./app";
import logger from "./lib/logger";
import { startExecutionEngine } from "./services/executionEngine";
import { createExecutorWsGateway } from "./ws/executorWsGateway";
import { startInviteCodeCleanupTask } from "./services/inviteCodeCleaner";
import { startAnalyticsEventCleanupTask } from "./services/analyticsEventCleaner";
import { startDbBackupTask } from "./services/dbBackupToOss";

const PORT = parseInt(process.env.PORT || "3001", 10);
const prisma = new PrismaClient();

const server = createServer(app);
createExecutorWsGateway(server, prisma);
startExecutionEngine(prisma);

server.listen(PORT, () => {
  logger.info({ port: PORT }, `server listening at http://localhost:${PORT}`);
  logger.info({ port: PORT }, `executor WS at ws://localhost:${PORT}/ws/executor`);
  startInviteCodeCleanupTask();
  startAnalyticsEventCleanupTask();
  startDbBackupTask();
});

process.on("unhandledRejection", (reason) => {
  logger.error({ err: reason }, "unhandledRejection");
});
process.on("uncaughtException", (err) => {
  logger.fatal({ err }, "uncaughtException");
});

export default app;
