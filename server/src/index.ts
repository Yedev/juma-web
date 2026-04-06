import path from "path";
import express from "express";
import cors from "cors";
import { PrismaClient } from "@prisma/client";
import authRoutes from "./routes/auth";
import adminRoutes from "./routes/admin";
import appRoutes from "./routes/app";
import deepreadRoutes from "./routes/deepread";
import { createServer } from "http";
import { startExecutionEngine } from "./services/executionEngine";
import { createExecutorWsGateway } from "./ws/executorWsGateway";
import { startInviteCodeCleanupTask } from "./services/inviteCodeCleaner";

const app = express();
const PORT = parseInt(process.env.PORT || "3001", 10);
const prisma = new PrismaClient();

app.use(cors());
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ code: 200, message: "OK", timestamp: Date.now() });
});

app.use("/api/auth", authRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/v1/app", appRoutes);
app.use("/api/v1/dr", deepreadRoutes);
const uploadsDir = path.resolve(__dirname, "../uploads");
app.use("/uploads", express.static(uploadsDir));

const staticDir = path.resolve(__dirname, "../public");
app.use(express.static(staticDir));
app.get("*", (_req, res) => {
  res.sendFile(path.join(staticDir, "index.html"));
});

const server = createServer(app);
createExecutorWsGateway(server, prisma);
startExecutionEngine(prisma);

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  console.log(`Executor WS listening at ws://localhost:${PORT}/ws/executor`);
  startInviteCodeCleanupTask();
});

export default app;
