import { Request, Response, Router } from "express";
import jwt from "jsonwebtoken";
import { handleError } from "../lib/errors";
import { DR_JWT_SECRET } from "../middleware/drAuth";
import { signMiddleware } from "../middleware/sign";
import * as analyticsService from "../services/analytics/analyticsService";

const router = Router();

router.use(signMiddleware);

function resolveOptionalUserId(req: Request): { userId?: number } | { error: string; status: number } {
  const authHeader = req.headers.authorization;
  if (!authHeader) return {};
  if (!authHeader.startsWith("Bearer ")) return { error: "Authorization 格式错误", status: 401 };

  try {
    const token = authHeader.slice("Bearer ".length);
    const decoded = jwt.verify(token, DR_JWT_SECRET) as { userId?: number };
    return typeof decoded.userId === "number" ? { userId: decoded.userId } : {};
  } catch {
    return { error: "Token已过期或无效", status: 401 };
  }
}

function getRequestIp(req: Request): string {
  const forwardedFor = req.headers["x-forwarded-for"];
  if (typeof forwardedFor === "string") return forwardedFor.split(",")[0]?.trim() ?? "";
  if (Array.isArray(forwardedFor)) return forwardedFor[0]?.trim() ?? "";
  return req.socket.remoteAddress ?? "";
}

router.post("/events", async (req: Request, res: Response): Promise<void> => {
  try {
    const authResult = resolveOptionalUserId(req);
    if ("error" in authResult) {
      res.status(authResult.status).json({ code: authResult.status, message: authResult.error });
      return;
    }

    const result = await analyticsService.createEvents(req.body, {
      userId: authResult.userId,
      ip: getRequestIp(req),
      userAgent: req.headers["user-agent"],
    });
    if ("error" in result) {
      res.status(result.status).json({ code: result.status, message: result.error });
      return;
    }

    res.json({
      code: 200,
      message: "事件已接收",
      data: { count: result.count },
    });
  } catch (error) {
    handleError(res, "Create analytics events error", error);
  }
});

export default router;
