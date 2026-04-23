import path from "path";
import express, { type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import { randomUUID } from "crypto";
import logger from "./lib/logger";
import authRoutes from "./routes/auth";
import adminRoutes from "./routes/admin";
import appRoutes from "./routes/app";
import analyticsRoutes from "./routes/analytics";
import deepreadRoutes from "./routes/deepread";

export function createApp() {
  const app = express();

  app.use(cors());
  app.use(express.json());

  app.use(
    pinoHttp({
      logger,
      genReqId: (req, res) => {
        const existing = (req.headers["x-request-id"] as string | undefined) || undefined;
        const id = existing || randomUUID();
        res.setHeader("x-request-id", id);
        return id;
      },
      customLogLevel: (_req, res, err) => {
        if (err || res.statusCode >= 500) return "error";
        if (res.statusCode >= 400) return "warn";
        return "info";
      },
      customSuccessMessage: (req, res) => `${req.method} ${req.url} -> ${res.statusCode}`,
      customErrorMessage: (req, res, err) => `${req.method} ${req.url} -> ${res.statusCode} ${err.message}`,
      serializers: {
        req(req) {
          return {
            id: req.id,
            method: req.method,
            url: req.url,
            remoteAddress: req.remoteAddress,
          };
        },
        res(res) {
          return { statusCode: res.statusCode };
        },
      },
      autoLogging: {
        ignore: (req) => req.url === "/api/health",
      },
    }),
  );

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

  app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
    const log = (req as Request & { log?: typeof logger }).log ?? logger;
    log.error({ err }, "unhandled error");
    if (res.headersSent) return;
    res.status(500).json({ code: 500, message: "服务器内部错误" });
  });

  return app;
}

export default createApp();
