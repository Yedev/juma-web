import path from "path";
import express from "express";
import cors from "cors";
import authRoutes from "./routes/auth";
import adminRoutes from "./routes/admin";
import appRoutes from "./routes/app";
import analyticsRoutes from "./routes/analytics";
import deepreadRoutes from "./routes/deepread";

export function createApp() {
  const app = express();

  app.use(cors());
  app.use(express.json());

  app.get("/api/health", (_req, res) => {
    res.json({ code: 200, message: "OK", timestamp: Date.now() });
  });

  app.use("/api/auth", authRoutes);
  app.use("/api/admin", adminRoutes);
  app.use("/api/v1/app", appRoutes);
  app.use("/api/v1/analytics", analyticsRoutes);
  app.use("/api/v1/dr", deepreadRoutes);

  const uploadsDir = path.resolve(__dirname, "../uploads");
  app.use("/uploads", express.static(uploadsDir));

  const staticDir = path.resolve(__dirname, "../public");
  app.use(express.static(staticDir));
  app.get("*", (_req, res) => {
    res.sendFile(path.join(staticDir, "index.html"));
  });

  return app;
}

export default createApp();
