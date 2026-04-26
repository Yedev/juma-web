import { Response, NextFunction } from "express";
import { DrAuthRequest } from "./drAuth";

const RESTRICTED = new Set([
  "PUT /me/nickname",
  "POST /space/join",
  "POST /sync/export",
  "POST /sync/import",
]);

export function guestGuard(req: DrAuthRequest, res: Response, next: NextFunction): void {
  if (req.drRole !== "guest") {
    next();
    return;
  }

  const key = `${req.method} ${req.path}`;
  if (RESTRICTED.has(key)) {
    res.status(403).json({
      code: 403,
      message: "该功能需要登录后使用",
      data: { reason: "guest_restricted" },
    });
    return;
  }

  next();
}
