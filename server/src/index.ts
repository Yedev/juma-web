import { PrismaClient } from "@prisma/client";
import { createServer } from "http";
import app from "./app";
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
  console.log(`Server running at http://localhost:${PORT}`);
  console.log(`Executor WS listening at ws://localhost:${PORT}/ws/executor`);
  startInviteCodeCleanupTask();
  startAnalyticsEventCleanupTask();
  startDbBackupTask();
});

export default app;
