import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import logger from "../lib/logger";

const log = logger.child({ module: "drAuth" });

if (!process.env.DR_JWT_SECRET) {
  log.warn("DR_JWT_SECRET not set, using default (dev only)");
}
const DR_JWT_SECRET = process.env.DR_JWT_SECRET || "deepread_jwt_secret_2026";
const DR_JWT_EXPIRES_IN = "30d";

export interface DrAuthRequest extends Request {
  drUserId?: number;
  drPhone?: string;
  drRole?: string;
}

export function drAuthMiddleware(req: DrAuthRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ code: 401, message: "未登录，请先登录" });
    return;
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, DR_JWT_SECRET) as { userId: number; phone?: string; role: string };
    req.drUserId = decoded.userId;
    req.drPhone = decoded.phone;
    req.drRole = decoded.role;
    next();
  } catch (err) {
    const reqLog = (req as DrAuthRequest & { log?: typeof logger }).log ?? log;
    reqLog.debug({ err: (err as Error).message, url: req.url }, "JWT verify failed");
    res.status(401).json({ code: 401, message: "Token已过期或无效" });
  }
}

export function signDrToken(payload: { userId: number; phone?: string; role: string }): string {
  return jwt.sign(payload, DR_JWT_SECRET, { expiresIn: DR_JWT_EXPIRES_IN });
}

export { DR_JWT_SECRET };
