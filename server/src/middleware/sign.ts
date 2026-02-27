import { Request, Response, NextFunction } from "express";
import md5 from "md5";

const APP_SECRET = process.env.APP_SECRET || "juma2026_secret";
const MAX_TIME_DIFF_MS = 5 * 60 * 1000;

export function signMiddleware(req: Request, res: Response, next: NextFunction): void {
  const timestamp = req.headers["x-timestamp"] as string | undefined;
  const sign = req.headers["x-sign"] as string | undefined;

  if (!timestamp) {
    res.status(403).json({ code: 403, message: "Forbidden: missing x-timestamp" });
    return;
  }

  const ts = parseInt(timestamp, 10);
  if (isNaN(ts)) {
    res.status(403).json({ code: 403, message: "Forbidden: invalid x-timestamp" });
    return;
  }

  const diff = Math.abs(Date.now() - ts);
  if (diff > MAX_TIME_DIFF_MS) {
    res.status(403).json({ code: 403, message: "Forbidden: timestamp expired (replay attack prevented)" });
    return;
  }

  if (!sign) {
    res.status(401).json({ code: 401, message: "Unauthorized: missing x-sign" });
    return;
  }

  const expectedSign = md5(APP_SECRET + timestamp);
  if (sign.toLowerCase() !== expectedSign.toLowerCase()) {
    res.status(401).json({ code: 401, message: "Unauthorized: invalid signature" });
    return;
  }

  next();
}

export { APP_SECRET };
